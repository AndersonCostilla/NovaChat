// popup.js
// Responsabilidad: interfaz. Manda órdenes al service worker, muestra el estado,
// pinta el medidor de nivel y guarda las preferencias de idioma.

import {
  MSG,
  TARGET,
  ESTADO,
  ERROR,
  CLAVE_IDIOMAS,
  CLAVE_SUBTITULOS,
  CLAVE_MODELO,
  MAX_SUBTITULOS
} from '../messages.js';

const elBoton = document.getElementById('botonPrincipal');
const elEstado = document.getElementById('estado');
const elBarra = document.getElementById('barraNivel');
const elOrigen = document.getElementById('idiomaOrigen');
const elDestino = document.getElementById('idiomaDestino');
const elListaSubtitulos = document.getElementById('listaSubtitulos');
const elEstadoModelo = document.getElementById('estadoModelo');

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
/* Subtítulos en vivo (Fase 3)                                         */
/* ------------------------------------------------------------------ */

// Historial que se pinta; se rellena desde storage.session al abrir el popup.
let subtitulos = [];

function horaDe(t) {
  return new Date(t).toLocaleTimeString('es', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

function pintarSubtitulos() {
  elListaSubtitulos.replaceChildren();

  if (subtitulos.length === 0) {
    const vacio = document.createElement('li');
    vacio.className = 'subtitulos__vacio';
    vacio.textContent = 'Aún no hay transcripciones.';
    elListaSubtitulos.appendChild(vacio);
    return;
  }

  for (const s of subtitulos) {
    const li = document.createElement('li');

    const meta = document.createElement('span');
    meta.className = 'subtitulo__meta';
    const idioma = s.idioma && s.idioma !== 'auto' ? ` · ${s.idioma}` : '';
    const tardanza = s.duracionMs ? ` · ${(s.duracionMs / 1000).toFixed(1)} s` : '';
    meta.textContent = `${horaDe(s.t)}${idioma}${tardanza}`;

    const texto = document.createElement('span');
    texto.textContent = s.texto; // textContent: nada de HTML inyectado

    li.append(meta, texto);
    elListaSubtitulos.appendChild(li);
  }

  // Siempre mirando lo último transcrito.
  elListaSubtitulos.scrollTop = elListaSubtitulos.scrollHeight;
}

function agregarSubtitulo(subtitulo) {
  subtitulos.push(subtitulo);
  while (subtitulos.length > MAX_SUBTITULOS) subtitulos.shift();
  pintarSubtitulos();
}

function pintarEstadoModelo(info) {
  const estado = info?.estado || 'inactivo';
  const etiquetas = {
    inactivo: 'Modelo inactivo',
    cargando: info?.detalle || 'Cargando modelo local…',
    listo: 'Modelo listo',
    transcribiendo: 'Transcribiendo…',
    error: 'Modelo no disponible'
  };
  elEstadoModelo.textContent = etiquetas[estado] ?? 'Modelo inactivo';
  elEstadoModelo.className = `modelo modelo--${estado}`;
  // El detalle completo del error se ve al pasar el ratón por encima.
  elEstadoModelo.title = info?.detalle || '';
}

// Al abrir el popup recuperamos el historial. Fuente principal: el service
// worker (único dueño de storage.session). Si no contesta, leemos el storage
// directamente como plan B.
async function cargarHistorial() {
  try {
    const panel = await chrome.runtime.sendMessage({
      type: MSG.GET_SUBTITLES,
      target: TARGET.BACKGROUND
    });

    if (panel && Array.isArray(panel.subtitulos)) {
      subtitulos = panel.subtitulos;
      pintarSubtitulos();
      pintarEstadoModelo(panel.modelo);
      return;
    }
  } catch (_) {
    /* el service worker puede estar arrancando: probamos el plan B */
  }

  try {
    const datos = await chrome.storage.session.get([CLAVE_SUBTITULOS, CLAVE_MODELO]);
    subtitulos = Array.isArray(datos?.[CLAVE_SUBTITULOS]) ? datos[CLAVE_SUBTITULOS] : [];
    pintarSubtitulos();
    pintarEstadoModelo(datos?.[CLAVE_MODELO]);
  } catch (_) {
    pintarSubtitulos();
  }
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
    case MSG.SUBTITLE:
      agregarSubtitulo({
        texto: mensaje.texto,
        idioma: mensaje.idioma,
        duracionMs: mensaje.duracionMs,
        t: mensaje.t || Date.now()
      });
      break;

    case MSG.MODEL_STATUS:
      pintarEstadoModelo({ estado: mensaje.estado, detalle: mensaje.detalle });
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
  await cargarHistorial();
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
