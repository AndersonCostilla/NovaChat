// background.js — service worker (módulo ES)
// Responsabilidad: orquestar la captura.
//  1. Recibe la orden "iniciar" del popup (con la tabId activa).
//  2. Pide el streamId con chrome.tabCapture.getMediaStreamId().
//  3. Crea (si hace falta) el documento offscreen.
//  4. Le pasa el streamId para que capture y re-enrute el audio.
//
// IMPORTANTE: el service worker de MV3 se suspende a los ~30 s de inactividad y
// pierde todo lo que tenga en memoria. Por eso el estado de la captura vive en
// chrome.storage.session (ver CLAVE_ESTADO_SESION), nunca en variables globales.

import {
  MSG,
  TARGET,
  ESTADO,
  ERROR,
  CLAVE_ESTADO_SESION,
  ESTADO_SESION,
  CLAVE_IDIOMAS,
  CLAVE_SUBTITULOS,
  CLAVE_MODELO,
  CLAVE_TRADUCTOR,
  MAX_SUBTITULOS,
  ESTADO_MODELO_UI,
  MODULO
} from './messages.js';

const RUTA_OFFSCREEN = 'offscreen.html';

// Último error mostrado. Es puramente cosmético (si el SW muere, se pierde y
// no pasa nada): el estado real SIEMPRE se lee de chrome.storage.session.
let ultimoError = '';

/* ------------------------------------------------------------------ */
/* Estado persistente (chrome.storage.session)                         */
/* ------------------------------------------------------------------ */

// chrome.storage.session existe desde Chrome 102 y sólo necesita el permiso
// "storage", que ya está declarado en el manifest.
async function leerEstadoSesion() {
  const datos = await chrome.storage.session.get(CLAVE_ESTADO_SESION);
  const guardado = datos?.[CLAVE_ESTADO_SESION];
  return {
    status: guardado?.status === ESTADO_SESION.CAPTURANDO
      ? ESTADO_SESION.CAPTURANDO
      : ESTADO_SESION.INACTIVO,
    tabId: typeof guardado?.tabId === 'number' ? guardado.tabId : null
  };
}

async function escribirEstadoSesion(status, tabId) {
  await chrome.storage.session.set({
    [CLAVE_ESTADO_SESION]: { status, tabId: typeof tabId === 'number' ? tabId : null }
  });
}

const marcarCapturando = (tabId) => escribirEstadoSesion(ESTADO_SESION.CAPTURANDO, tabId);
const marcarInactivo = () => escribirEstadoSesion(ESTADO_SESION.INACTIVO, null);

/* ------------------------------------------------------------------ */
/* Subtítulos y estado del modelo (Fase 3)                             */
/* ------------------------------------------------------------------ */
// El service worker es el ÚNICO escritor de chrome.storage.session. En la
// prueba de Nivel 2 se comprobó que las escrituras hechas desde el documento
// offscreen no llegaban a storage (y se perdían en silencio), mientras que las
// del service worker sí. Centralizar aquí elimina el problema y además deja un
// único punto donde recortar el historial.

// Cola de escritura: evita que dos subtítulos casi simultáneos se pisen
// (leer-modificar-escribir no es atómico).
let cadenaEscritura = Promise.resolve();

function enSerie(tarea) {
  cadenaEscritura = cadenaEscritura.then(tarea, tarea);
  return cadenaEscritura;
}

async function agregarSubtitulo(subtitulo) {
  return enSerie(async () => {
    const datos = await chrome.storage.session.get(CLAVE_SUBTITULOS);
    const historial = Array.isArray(datos?.[CLAVE_SUBTITULOS]) ? datos[CLAVE_SUBTITULOS] : [];
    historial.push(subtitulo);
    while (historial.length > MAX_SUBTITULOS) historial.shift();
    await chrome.storage.session.set({ [CLAVE_SUBTITULOS]: historial });

    notificarPopup({ type: MSG.SUBTITLE, ...subtitulo });
    return { ok: true, total: historial.length };
  });
}

// Hay dos módulos de IA (transcripción y traducción) con estados separados:
// cada uno vive en su propia clave y el popup pinta dos indicadores.
function claveDeModulo(modulo) {
  return modulo === MODULO.TRADUCCION ? CLAVE_TRADUCTOR : CLAVE_MODELO;
}

async function fijarEstadoModelo(info, modulo = MODULO.TRANSCRIPCION) {
  const carga = {
    estado: info?.estado || ESTADO_MODELO_UI.INACTIVO,
    detalle: info?.detalle || '',
    modulo,
    t: Date.now()
  };
  await chrome.storage.session.set({ [claveDeModulo(modulo)]: carga });
  notificarPopup({ type: MSG.MODEL_STATUS, ...carga });
  return { ok: true };
}

async function leerPanel() {
  const datos = await chrome.storage.session.get([CLAVE_SUBTITULOS, CLAVE_MODELO, CLAVE_TRADUCTOR]);
  return {
    subtitulos: Array.isArray(datos?.[CLAVE_SUBTITULOS]) ? datos[CLAVE_SUBTITULOS] : [],
    modelo: datos?.[CLAVE_MODELO] || { estado: ESTADO_MODELO_UI.INACTIVO, detalle: '' },
    traductor: datos?.[CLAVE_TRADUCTOR] || { estado: ESTADO_MODELO_UI.INACTIVO, detalle: '' }
  };
}

/* ------------------------------------------------------------------ */
/* Preferencias de idioma (el offscreen no puede leer chrome.storage)  */
/* ------------------------------------------------------------------ */
// Un documento offscreen sólo tiene acceso a chrome.runtime; cualquier otra
// API de extensión llega como undefined. Por eso el service worker hace de
// intermediario también para las preferencias.

async function leerIdiomas() {
  const datos = await chrome.storage.local.get(CLAVE_IDIOMAS);
  const guardado = datos?.[CLAVE_IDIOMAS] || {};
  return { origen: guardado.origen || 'auto', destino: guardado.destino || 'es' };
}

// Si el usuario cambia el idioma en el popup, se lo contamos al offscreen para
// que lo aplique en caliente (afecta a la siguiente frase).
chrome.storage.onChanged.addListener((cambios, area) => {
  if (area !== 'local' || !cambios[CLAVE_IDIOMAS]) return;

  const nuevo = cambios[CLAVE_IDIOMAS].newValue || {};
  chrome.runtime
    .sendMessage({
      type: MSG.SETTINGS_CHANGED,
      target: TARGET.OFFSCREEN,
      idiomas: { origen: nuevo.origen || 'auto', destino: nuevo.destino || 'es' }
    })
    .catch(() => {
      /* no hay offscreen abierto: no es un error */
    });
});

/* ------------------------------------------------------------------ */
/* Utilidades                                                          */
/* ------------------------------------------------------------------ */

// Avisa al popup (si está abierto). Si no lo está, el envío falla y se ignora.
function notificarPopup(mensaje) {
  chrome.runtime.sendMessage({ ...mensaje, target: TARGET.POPUP }).catch(() => {
    /* El popup está cerrado: no es un error. */
  });
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

// Traduce errores técnicos a mensajes comprensibles. Los patrones son sólo una
// HEURÍSTICA: si ninguno encaja, devolvemos el mensaje crudo de Chrome (truncado),
// que es más útil para depurar que un texto genérico inventado.
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
  if (/NotFoundError|no audio|Invalid stream id/i.test(texto)) {
    return 'La pestaña no tiene audio disponible para capturar.';
  }

  // Por defecto: mensaje crudo de Chrome, truncado a 120 caracteres.
  return texto.length > 120 ? `${texto.slice(0, 117)}…` : texto;
}

/* ------------------------------------------------------------------ */
/* Flujo principal                                                     */
/* ------------------------------------------------------------------ */

async function iniciarCaptura(tabId) {
  let url = '';
  try {
    // ¿Hay ya una captura en marcha según el estado persistido?
    const sesion = await leerEstadoSesion();
    if (sesion.status === ESTADO_SESION.CAPTURANDO) {
      if (await existeOffscreen()) {
        // Captura real y viva: no pedimos otro streamId (Chrome fallaría).
        const mensaje = `Ya hay una captura activa (pestaña ${sesion.tabId ?? '?'}). Pulsa Detener para cortarla.`;
        ultimoError = mensaje;
        notificarPopup({ type: MSG.CAPTURE_ERROR, error: mensaje, code: ERROR.YA_EN_CAPTURA });
        return { ok: false, code: ERROR.YA_EN_CAPTURA, error: mensaje, tabId: sesion.tabId };
      }
      // Estado huérfano (el offscreen murió): lo limpiamos y seguimos.
      await marcarInactivo();
    }

    // La URL sólo sirve para dar un mensaje de error mejor. Si viene vacía
    // (sin activeTab todavía), NO inventamos un error: intentamos capturar.
    const pestania = await chrome.tabs.get(tabId).catch(() => null);
    url = pestania?.url || '';

    if (url) {
      if (/^(chrome|edge|about|devtools|chrome-extension):/i.test(url)) {
        throw new Error('Página interna del navegador no capturable.');
      }
      if (/chromewebstore\.google\.com|chrome\.google\.com\/webstore/i.test(url)) {
        throw new Error('La Chrome Web Store no es capturable.');
      }
    }

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

    ultimoError = '';
    await marcarCapturando(tabId);
    notificarPopup({ type: MSG.CAPTURE_STARTED, tabId });
    return { ok: true, tabId };
  } catch (error) {
    const mensaje = traducirError(error, url);
    ultimoError = mensaje;
    // Limpiamos para no dejar un offscreen huérfano ni estado falso.
    await cerrarOffscreen().catch(() => {});
    await marcarInactivo();
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
    ultimoError = '';
    await marcarInactivo();
    // El offscreen se está cerrando y ya no puede avisar de su propio estado.
    await fijarEstadoModelo({ estado: ESTADO_MODELO_UI.INACTIVO }, MODULO.TRANSCRIPCION).catch(() => {});
    await fijarEstadoModelo({ estado: ESTADO_MODELO_UI.INACTIVO }, MODULO.TRADUCCION).catch(() => {});
    notificarPopup({ type: MSG.CAPTURE_STOPPED });
    return { ok: true };
  } catch (error) {
    const mensaje = traducirError(error);
    ultimoError = mensaje;
    // Aunque falle el cierre, no dejamos el estado mintiendo.
    await marcarInactivo().catch(() => {});
    notificarPopup({ type: MSG.CAPTURE_ERROR, error: mensaje });
    return { ok: false, error: mensaje };
  }
}

// Estado para el popup, con AUTO-REPARACIÓN: si el estado dice CAPTURANDO pero
// el documento offscreen ya no existe, corregimos el estado persistido.
async function consultarEstado() {
  const sesion = await leerEstadoSesion();

  if (sesion.status === ESTADO_SESION.CAPTURANDO) {
    if (await existeOffscreen()) {
      return { estado: ESTADO.CAPTURANDO, tabId: sesion.tabId, error: '' };
    }
    await marcarInactivo(); // auto-reparación
    return { estado: ESTADO.INACTIVO, tabId: null, error: '' };
  }

  return { estado: ESTADO.INACTIVO, tabId: null, error: ultimoError };
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
      consultarEstado().then(responder);
      return true;

    // --- Fase 3: panel de subtítulos ---
    case MSG.SUBTITLE_ADD:
      agregarSubtitulo(mensaje.subtitulo)
        .then(responder)
        .catch((error) => responder({ ok: false, error: String(error?.message || error) }));
      return true;

    case MSG.MODEL_STATUS_SET:
      fijarEstadoModelo(mensaje.modelo, mensaje.modulo)
        .then(responder)
        .catch((error) => responder({ ok: false, error: String(error?.message || error) }));
      return true;

    case MSG.GET_SUBTITLES:
      leerPanel().then(responder);
      return true;

    case MSG.GET_SETTINGS:
      leerIdiomas()
        .then((idiomas) => responder({ ok: true, idiomas }))
        .catch((error) => responder({ ok: false, error: String(error?.message || error) }));
      return true;

    default:
      return false;
  }
});

// Si se cierra la pestaña capturada, limpiamos todo. El tabId se lee del estado
// persistido, no de memoria (el SW pudo haberse reiniciado entretanto).
chrome.tabs.onRemoved.addListener((tabId) => {
  leerEstadoSesion().then((sesion) => {
    if (sesion.status === ESTADO_SESION.CAPTURANDO && sesion.tabId === tabId) {
      detenerCaptura();
    }
  });
});
