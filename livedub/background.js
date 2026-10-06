// background.js — service worker (módulo ES)
// Responsabilidad: orquestar la captura.
//  1. Recibe la orden "iniciar" del popup (con la tabId activa).
//  2. Pide el streamId con chrome.tabCapture.getMediaStreamId().
//  3. Crea (si hace falta) el documento offscreen.
//  4. Le pasa el streamId para que capture y re-enrute el audio.

import { MSG, TARGET, ESTADO } from './messages.js';

const RUTA_OFFSCREEN = 'offscreen.html';

// Estado en memoria del service worker. Ojo: el SW puede dormirse, por eso
// el popup siempre vuelve a preguntar el estado al abrirse (MSG.GET_STATE).
const estado = {
  valor: ESTADO.INACTIVO,
  tabId: null,
  mensajeError: ''
};

/* ------------------------------------------------------------------ */
/* Utilidades                                                          */
/* ------------------------------------------------------------------ */

// Avisa al popup (si está abierto). Si no lo está, el envío falla y se ignora.
function notificarPopup(mensaje) {
  chrome.runtime.sendMessage({ ...mensaje, target: TARGET.POPUP }).catch(() => {
    /* El popup está cerrado: no es un error. */
  });
}

function fijarEstado(valor, mensajeError = '') {
  estado.valor = valor;
  estado.mensajeError = mensajeError;
}

// Comprueba si ya existe el documento offscreen.
async function existeOffscreen() {
  const contextos = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT']
  });
  return contextos.length > 0;
}

// Crea el documento offscreen sólo si todavía no existe.
let creandoOffscreen = null; // evita condiciones de carrera (dos creaciones a la vez)

async function setupOffscreenDocument() {
  if (await existeOffscreen()) return;

  if (creandoOffscreen) {
    await creandoOffscreen;
    return;
  }

  creandoOffscreen = chrome.offscreen.createDocument({
    url: RUTA_OFFSCREEN,
    reasons: ['USER_MEDIA'],
    justification:
      'Capturar el audio de la pestaña y volver a reproducirlo para el usuario.'
  });

  try {
    await creandoOffscreen;
  } catch (error) {
    // Caso típico: "Only a single offscreen document may be created".
    // Si ya existe, lo damos por bueno; si no, propagamos el error.
    if (!(await existeOffscreen())) throw error;
  } finally {
    creandoOffscreen = null;
  }
}

async function cerrarOffscreen() {
  if (await existeOffscreen()) {
    await chrome.offscreen.closeDocument();
  }
}

// Traduce errores técnicos a mensajes comprensibles en español.
function traducirError(error, url = '') {
  const texto = String(error?.message || error || 'Error desconocido');

  if (/^(chrome|edge|about|devtools):/i.test(url)) {
    return 'No se pueden capturar páginas internas del navegador (chrome://).';
  }
  if (/chromewebstore\.google\.com|chrome\.google\.com\/webstore/i.test(url)) {
    return 'No se puede capturar la Chrome Web Store.';
  }
  if (/Cannot capture a tab with an active stream|already being captured/i.test(texto)) {
    return 'Esa pestaña ya se está capturando. Pulsa Detener antes de reiniciar.';
  }
  if (/Extension has not been invoked|user gesture|activeTab/i.test(texto)) {
    return 'Chrome necesita un gesto del usuario: vuelve a pulsar Iniciar sobre la pestaña.';
  }
  if (/NotAllowedError|Permission denied|cancel/i.test(texto)) {
    return 'Permiso denegado o cancelado por el usuario.';
  }
  if (/NotFoundError|no audio|Invalid stream id/i.test(texto)) {
    return 'La pestaña no tiene audio disponible para capturar.';
  }
  return texto;
}

/* ------------------------------------------------------------------ */
/* Flujo principal                                                     */
/* ------------------------------------------------------------------ */

async function iniciarCaptura(tabId) {
  let url = '';
  try {
    const pestania = await chrome.tabs.get(tabId);
    url = pestania?.url || '';

    if (/^(chrome|edge|about|devtools|chrome-extension):/i.test(url)) {
      throw new Error('Página interna del navegador no capturable.');
    }
    if (/chromewebstore\.google\.com|chrome\.google\.com\/webstore/i.test(url)) {
      throw new Error('La Chrome Web Store no es capturable.');
    }

    fijarEstado(ESTADO.INICIANDO);

    // 3. streamId: debe pedirse desde el service worker tras un gesto del usuario.
    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
    if (!streamId) throw new Error('No se obtuvo el identificador del stream.');

    // 4. Documento offscreen (el único contexto que puede usar getUserMedia aquí).
    await setupOffscreenDocument();

    // 5. Enviamos el streamId al offscreen y esperamos su respuesta.
    const respuesta = await chrome.runtime.sendMessage({
      type: MSG.OFFSCREEN_START,
      target: TARGET.OFFSCREEN,
      streamId
    });

    if (!respuesta?.ok) {
      throw new Error(respuesta?.error || 'El documento offscreen no pudo iniciar la captura.');
    }

    estado.tabId = tabId;
    fijarEstado(ESTADO.CAPTURANDO);
    notificarPopup({ type: MSG.CAPTURE_STARTED, tabId });
    return { ok: true };
  } catch (error) {
    const mensaje = traducirError(error, url);
    fijarEstado(ESTADO.ERROR, mensaje);
    // Limpiamos para no dejar un offscreen huérfano.
    await cerrarOffscreen().catch(() => {});
    notificarPopup({ type: MSG.CAPTURE_ERROR, error: mensaje });
    return { ok: false, error: mensaje };
  }
}

async function detenerCaptura() {
  try {
    if (await existeOffscreen()) {
      // Pedimos al offscreen que pare tracks y cierre el AudioContext.
      await chrome.runtime
        .sendMessage({ type: MSG.OFFSCREEN_STOP, target: TARGET.OFFSCREEN })
        .catch(() => {});
      await cerrarOffscreen();
    }
    estado.tabId = null;
    fijarEstado(ESTADO.INACTIVO);
    notificarPopup({ type: MSG.CAPTURE_STOPPED });
    return { ok: true };
  } catch (error) {
    const mensaje = traducirError(error);
    fijarEstado(ESTADO.ERROR, mensaje);
    notificarPopup({ type: MSG.CAPTURE_ERROR, error: mensaje });
    return { ok: false, error: mensaje };
  }
}

/* ------------------------------------------------------------------ */
/* Mensajería                                                          */
/* ------------------------------------------------------------------ */

chrome.runtime.onMessage.addListener((mensaje, _remitente, responder) => {
  // Sólo atendemos lo dirigido al background (o sin destinatario explícito).
  if (mensaje?.target && mensaje.target !== TARGET.BACKGROUND) return false;

  switch (mensaje?.type) {
    case MSG.START_CAPTURE:
      iniciarCaptura(mensaje.tabId).then(responder);
      return true; // respuesta asíncrona

    case MSG.STOP_CAPTURE:
      detenerCaptura().then(responder);
      return true;

    case MSG.GET_STATE:
      // Si el SW se reinició, el offscreen manda: comprobamos si sigue vivo.
      existeOffscreen().then((vivo) => {
        if (!vivo && estado.valor === ESTADO.CAPTURANDO) fijarEstado(ESTADO.INACTIVO);
        responder({
          estado: estado.valor,
          tabId: estado.tabId,
          error: estado.mensajeError
        });
      });
      return true;

    default:
      return false;
  }
});

// Si se cierra la pestaña capturada, limpiamos todo.
chrome.tabs.onRemoved.addListener((tabId) => {
  if (estado.tabId === tabId) detenerCaptura();
});
