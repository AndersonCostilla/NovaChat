// popup.js
// Responsabilidad: interfaz. Manda órdenes al service worker, muestra el estado,
// pinta el medidor de nivel y guarda las preferencias de idioma.

import { MSG, TARGET, ESTADO, ERROR, CLAVE_IDIOMAS } from '../messages.js';

const elBoton = document.getElementById('botonPrincipal');
const elEstado = document.getElementById('estado');
const elBarra = document.getElementById('barraNivel');
const elOrigen = document.getElementById('idiomaOrigen');
const elDestino = document.getElementById('idiomaDestino');

let estadoActual = ESTADO.INACTIVO;

/* ------------------------------------------------------------------ */
/* Pintado de la interfaz                                              */
/* ------------------------------------------------------------------ */

// `permitirDetener` fuerza el botón "Detener" aunque estemos en error: es el caso
// de YA_EN_CAPTURA, donde hay una captura viva que el usuario debe poder cortar.
function pintarEstado(estado, textoError = '', permitirDetener = false) {
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
  const modoDetener = capturando || permitirDetener;
  elBoton.textContent = modoDetener ? 'Detener' : 'Iniciar';
  elBoton.className = `boton ${modoDetener ? 'boton--detener' : 'boton--iniciar'}`;
  elBoton.disabled = estado === ESTADO.INICIANDO;

  if (!capturando) pintarNivel(0);
}

// Nivel RMS (0..1) -> anchura de la barra en escala logarítmica dBFS,
// que es como percibe el volumen el oído: 0 % = -60 dBFS (silencio), 100 % = 0 dBFS.
function pintarNivel(rms) {
  const db = 20 * Math.log10(Math.max(rms, 1e-6));
  const pct = Math.min(100, Math.max(0, ((db + 60) / 60) * 100)); // piso: -60 dBFS
  elBarra.style.width = `${pct}%`;
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

    if (respuesta?.ok) {
      pintarEstado(ESTADO.CAPTURANDO);
    } else {
      const yaEnCaptura = respuesta?.code === ERROR.YA_EN_CAPTURA;
      pintarEstado(ESTADO.ERROR, respuesta?.error || 'No se pudo iniciar la captura.', yaEnCaptura);
    }
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
  // Nos fiamos del texto del botón: cubre también el caso YA_EN_CAPTURA,
  // donde el estado es ERROR pero sí hay algo vivo que detener.
  if (elBoton.textContent === 'Detener') detener();
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
      pintarEstado(ESTADO.ERROR, mensaje.error, mensaje.code === ERROR.YA_EN_CAPTURA);
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
