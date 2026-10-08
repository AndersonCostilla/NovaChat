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
  CLAVE_TRADUCTOR,
  CLAVE_SINTETIZADOR,
  MAX_SUBTITULOS,
  MODULO
} from '../messages.js';

const elBoton = document.getElementById('botonPrincipal');
const elEstado = document.getElementById('estado');
const elBarra = document.getElementById('barraNivel');
const elOrigen = document.getElementById('idiomaOrigen');
const elDestino = document.getElementById('idiomaDestino');
const elListaSubtitulos = document.getElementById('listaSubtitulos');
const elEstadoModelo = document.getElementById('estadoModelo');
const elEstadoTraductor = document.getElementById('estadoTraductor');
const elEstadoVoz = document.getElementById('estadoVoz');
const elDoblaje = document.getElementById('doblajeVoz');

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

    // Cabecera: hora · idioma · tiempos (transcripción + traducción).
    const meta = document.createElement('span');
    meta.className = 'subtitulo__meta';
    const idioma = s.idioma && s.idioma !== 'auto' ? ` · ${s.idioma}` : '';
    const tTranscripcion = s.duracionMs ? ` · ${(s.duracionMs / 1000).toFixed(1)} s` : '';
    const tTraduccion = s.duracionTraduccionMs
      ? ` + ${(s.duracionTraduccionMs / 1000).toFixed(1)} s`
      : '';
    const tTotal = s.totalMs && s.duracionTraduccionMs
      ? ` = ${(s.totalMs / 1000).toFixed(1)} s`
      : '';
    meta.textContent = `${horaDe(s.t)}${idioma}${tTranscripcion}${tTraduccion}${tTotal}`;
    li.appendChild(meta);

    // Línea del texto original.
    li.appendChild(
      lineaSubtitulo('EN', 'subtitulo__etiqueta--en', s.texto, 'subtitulo__original')
    );

    // Línea de la traducción, sólo si existe.
    if (s.traduccion) {
      li.appendChild(
        lineaSubtitulo('ES', 'subtitulo__etiqueta--es', s.traduccion, 'subtitulo__traduccion')
      );
    }

    // Aviso (idioma no soportado, traductor caído...). Nunca falla en silencio.
    if (s.aviso) {
      const aviso = document.createElement('span');
      aviso.className = 'subtitulo__aviso';
      aviso.textContent = `⚠ ${s.aviso}`;
      li.appendChild(aviso);
    }

    elListaSubtitulos.appendChild(li);
  }

  // Siempre mirando lo último transcrito.
  elListaSubtitulos.scrollTop = elListaSubtitulos.scrollHeight;
}

// Una línea «ETIQUETA  texto» del panel de subtítulos.
function lineaSubtitulo(etiqueta, claseEtiqueta, texto, claseTexto) {
  const linea = document.createElement('div');
  linea.className = 'subtitulo__linea';

  const marca = document.createElement('span');
  marca.className = `subtitulo__etiqueta ${claseEtiqueta}`;
  marca.textContent = etiqueta;

  const cuerpo = document.createElement('span');
  cuerpo.className = claseTexto;
  cuerpo.textContent = texto; // textContent: nada de HTML inyectado

  linea.append(marca, cuerpo);
  return linea;
}

function agregarSubtitulo(subtitulo) {
  subtitulos.push(subtitulo);
  while (subtitulos.length > MAX_SUBTITULOS) subtitulos.shift();
  pintarSubtitulos();
}

// Dos indicadores independientes: transcripción y traducción.
const ETIQUETAS_MODELO = {
  [MODULO.TRANSCRIPCION]: {
    inactivo: 'Modelo inactivo',
    cargando: 'Cargando modelo local…',
    listo: 'Modelo listo',
    transcribiendo: 'Transcribiendo…',
    error: 'Modelo no disponible'
  },
  [MODULO.TRADUCCION]: {
    inactivo: 'Traductor inactivo',
    cargando: 'Cargando traductor…',
    listo: 'Traductor listo',
    traduciendo: 'Traduciendo…',
    error: 'Traductor no disponible'
  },
  [MODULO.SINTESIS]: {
    inactivo: 'Voz inactiva',
    cargando: 'Cargando voz…',
    listo: 'Voz lista',
    sintetizando: 'Generando voz…',
    hablando: 'Hablando…',
    error: 'Voz no disponible'
  }
};

// Cada módulo pinta en SU insignia. Un mapa explícito evita el encadenado de
// ternarios, que ya iba a tres niveles.
const INSIGNIA_POR_MODULO = {
  [MODULO.TRANSCRIPCION]: elEstadoModelo,
  [MODULO.TRADUCCION]: elEstadoTraductor,
  [MODULO.SINTESIS]: elEstadoVoz
};

function pintarEstadoModelo(info, modulo = MODULO.TRANSCRIPCION) {
  const elemento = INSIGNIA_POR_MODULO[modulo] ?? elEstadoModelo;
  const estado = info?.estado || 'inactivo';
  const etiquetas = ETIQUETAS_MODELO[modulo] ?? ETIQUETAS_MODELO[MODULO.TRANSCRIPCION];

  const texto =
    estado === 'cargando' && info?.detalle ? info.detalle : etiquetas[estado] ?? etiquetas.inactivo;

  elemento.textContent = texto;
  elemento.className = `modelo modelo--${estado}`;
  // El detalle completo (causa del error, por ejemplo) al pasar el ratón.
  elemento.title = info?.detalle || '';
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
      pintarEstadoModelo(panel.modelo, MODULO.TRANSCRIPCION);
      pintarEstadoModelo(panel.traductor, MODULO.TRADUCCION);
      pintarEstadoModelo(panel.sintetizador, MODULO.SINTESIS);
      return;
    }
  } catch (error) {
    // El plan B es legítimo (el service worker puede estar arrancando), pero
    // callarse el motivo fue justo lo que escondió dos bugs en fases
    // anteriores: un catch puede decidir no actuar, nunca no informar.
    console.warn(
      '[LiveDub] GET_SUBTITLES falló, leyendo el historial directo de storage:',
      error?.message || error
    );
  }

  try {
    const datos = await chrome.storage.session.get([CLAVE_SUBTITULOS, CLAVE_MODELO, CLAVE_TRADUCTOR, CLAVE_SINTETIZADOR]);
    subtitulos = Array.isArray(datos?.[CLAVE_SUBTITULOS]) ? datos[CLAVE_SUBTITULOS] : [];
    pintarSubtitulos();
    pintarEstadoModelo(datos?.[CLAVE_MODELO], MODULO.TRANSCRIPCION);
    pintarEstadoModelo(datos?.[CLAVE_TRADUCTOR], MODULO.TRADUCCION);
  } catch (error) {
    console.warn('[LiveDub] No se pudo leer el historial de storage.session:', error?.message || error);
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
        traduccion: mensaje.traduccion,
        aviso: mensaje.aviso,
        idioma: mensaje.idioma,
        duracionMs: mensaje.duracionMs,
        duracionTraduccionMs: mensaje.duracionTraduccionMs,
        totalMs: mensaje.totalMs,
        t: mensaje.t || Date.now()
      });
      break;

    case MSG.MODEL_STATUS:
      pintarEstadoModelo(
        { estado: mensaje.estado, detalle: mensaje.detalle },
        mensaje.modulo || MODULO.TRANSCRIPCION
      );
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
  await cargarInterruptorDoblaje();
  await cargarHistorial();
  try {
    const estado = await chrome.runtime.sendMessage({
      type: MSG.GET_STATE,
      target: TARGET.BACKGROUND
    });
    pintarEstado(estado?.estado || ESTADO.INACTIVO, estado?.error || '');
  } catch (error) {
    // Ojo: si esto salta, el popup pinta "Inactivo" aunque la captura esté
    // corriendo. Sin este aviso parecería un bug de estado y no de mensajería.
    console.warn('[LiveDub] GET_STATE falló, asumiendo INACTIVO:', error?.message || error);
    pintarEstado(ESTADO.INACTIVO);
  }
})();
