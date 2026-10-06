// popup.js
// Responsabilidad: interfaz. Manda órdenes al service worker, muestra el estado,
// pinta el medidor de nivel y guarda las preferencias de idioma.

import { MSG, TARGET, ESTADO, CLAVE_IDIOMAS } from '../messages.js';

const elBoton = document.getElementById('botonPrincipal');
const elEstado = document.getElementById('estado');
const elBarra = document.getElementById('barraNivel');
const elOrigen = document.getElementById('idiomaOrigen');
const elDestino = document.getElementById('idiomaDestino');

let estadoActual = ESTADO.INACTIVO;

/* ------------------------------------------------------------------ */
/* Pintado de la interfaz                                              */
/* ------------------------------------------------------------------ */

function pintarEstado(estado, textoError = '') {
  estadoActual = estado;

  const etiquetas = {
    [ESTADO.INACTIVO]: 'Inactivo',
    [ESTADO.INICIANDO]: 'Iniciando…',
    [ESTADO.CAPTURANDO]: 'Capturando',
    [ESTADO.ERROR]: `Error: ${textoError}`
  };

  elEstado.textContent = etiquetas[estado] ?? 'Inactivo';
  elEstado.className = `estado estado--${estado}`;

  const capturando = estado === ESTADO.CAPTURANDO;
  elBoton.textContent = capturando ? 'Detener' : 'Iniciar';
  elBoton.className = `boton ${capturando ? 'boton--detener' : 'boton--iniciar'}`;
  elBoton.disabled = estado === ESTADO.INICIANDO;

  if (!capturando) pintarNivel(0);
}

// Nivel RMS (0..1) -> anchura de la barra. Escalamos porque el RMS típico es bajo.
function pintarNivel(rms) {
  const porcentaje = Math.min(100, Math.round(rms * 320));
  elBarra.style.width = `${porcentaje}%`;
}

/* ------------------------------------------------------------------ */
/* Acciones                                                            */
/* ------------------------------------------------------------------ */

async function pestaniaActiva() {
  const [pestania] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!pestania?.id) throw new Error('No se encontró la pestaña activa.');
  return pestania;
}

async function iniciar() {
  try {
    pintarEstado(ESTADO.INICIANDO);
    const pestania = await pestaniaActiva();

    const respuesta = await chrome.runtime.sendMessage({
      type: MSG.START_CAPTURE,
      target: TARGET.BACKGROUND,
      tabId: pestania.id
    });

    if (respuesta?.ok) pintarEstado(ESTADO.CAPTURANDO);
    else pintarEstado(ESTADO.ERROR, respuesta?.error || 'No se pudo iniciar la captura.');
  } catch (error) {
    pintarEstado(ESTADO.ERROR, String(error?.message || error));
  }
}

async function detener() {
  try {
    elBoton.disabled = true;
    const respuesta = await chrome.runtime.sendMessage({
      type: MSG.STOP_CAPTURE,
      target: TARGET.BACKGROUND
    });
    if (respuesta?.ok) pintarEstado(ESTADO.INACTIVO);
    else pintarEstado(ESTADO.ERROR, respuesta?.error || 'No se pudo detener la captura.');
  } catch (error) {
    pintarEstado(ESTADO.ERROR, String(error?.message || error));
  } finally {
    elBoton.disabled = false;
  }
}

elBoton.addEventListener('click', () => {
  if (estadoActual === ESTADO.CAPTURANDO) detener();
  else iniciar();
});

/* ------------------------------------------------------------------ */
/* Preferencias de idioma (sólo se guardan, aún no se usan)            */
/* ------------------------------------------------------------------ */

async function cargarIdiomas() {
  const datos = await chrome.storage.local.get(CLAVE_IDIOMAS);
  const guardado = datos[CLAVE_IDIOMAS] || { origen: 'auto', destino: 'es' };
  elOrigen.value = guardado.origen;
  elDestino.value = guardado.destino;
}

async function guardarIdiomas() {
  await chrome.storage.local.set({
    [CLAVE_IDIOMAS]: { origen: elOrigen.value, destino: elDestino.value }
  });
}

elOrigen.addEventListener('change', guardarIdiomas);
elDestino.addEventListener('change', guardarIdiomas);

/* ------------------------------------------------------------------ */
/* Mensajes entrantes                                                  */
/* ------------------------------------------------------------------ */

chrome.runtime.onMessage.addListener((mensaje) => {
  if (mensaje?.target && mensaje.target !== TARGET.POPUP) return;

  switch (mensaje.type) {
    case MSG.AUDIO_LEVEL:
      if (estadoActual === ESTADO.CAPTURANDO) pintarNivel(mensaje.nivel);
      break;
    case MSG.CAPTURE_STARTED:
      pintarEstado(ESTADO.CAPTURANDO);
      break;
    case MSG.CAPTURE_STOPPED:
      pintarEstado(ESTADO.INACTIVO);
      break;
    case MSG.CAPTURE_ERROR:
      pintarEstado(ESTADO.ERROR, mensaje.error);
      break;
  }
});

/* ------------------------------------------------------------------ */
/* Arranque                                                            */
/* ------------------------------------------------------------------ */

(async function inicializar() {
  await cargarIdiomas();
  try {
    const estado = await chrome.runtime.sendMessage({
      type: MSG.GET_STATE,
      target: TARGET.BACKGROUND
    });
    pintarEstado(estado?.estado || ESTADO.INACTIVO, estado?.error || '');
  } catch (_) {
    pintarEstado(ESTADO.INACTIVO);
  }
})();
