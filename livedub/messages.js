// messages.js
// Única fuente de verdad para los tipos de mensaje que se intercambian entre
// el popup, el service worker y el documento offscreen.
// Regla del proyecto: nunca usar strings sueltos para los tipos de mensaje.

export const MSG = {
  // popup -> background
  START_CAPTURE: 'START_CAPTURE',
  STOP_CAPTURE: 'STOP_CAPTURE',
  GET_STATE: 'GET_STATE',

  // background -> offscreen
  OFFSCREEN_START: 'OFFSCREEN_START',
  OFFSCREEN_STOP: 'OFFSCREEN_STOP',

  // cualquiera -> offscreen (ajuste de volumen del audio original, 0..1)
  SET_GAIN: 'SET_GAIN',

  // offscreen -> background (Fase 3). El service worker es el ÚNICO que escribe
  // en chrome.storage.session: desde el offscreen esas escrituras no cuajaban.
  SUBTITLE_ADD: 'SUBTITLE_ADD',           // persistir una transcripción
  MODEL_STATUS_SET: 'MODEL_STATUS_SET',   // persistir el estado del modelo

  // popup -> background
  GET_SUBTITLES: 'GET_SUBTITLES',         // historial + estado del modelo al abrir

  // popup -> background -> offscreen: activar o desactivar el doblaje por voz.
  SET_DOBLAJE: 'SET_DOBLAJE',

  // offscreen -> background: el offscreen NO puede usar chrome.storage,
  // así que pide las preferencias por mensaje.
  GET_SETTINGS: 'GET_SETTINGS',

  // background -> offscreen: aviso de que el usuario cambió una preferencia.
  SETTINGS_CHANGED: 'SETTINGS_CHANGED',

  // background -> popup
  SUBTITLE: 'SUBTITLE',         // nueva transcripción lista
  MODEL_STATUS: 'MODEL_STATUS', // estado del modelo local

  // offscreen/background -> popup
  CAPTURE_STARTED: 'CAPTURE_STARTED',
  CAPTURE_STOPPED: 'CAPTURE_STOPPED',
  CAPTURE_ERROR: 'CAPTURE_ERROR',
  AUDIO_LEVEL: 'AUDIO_LEVEL'
};

// Destinatarios lógicos: permiten filtrar los mensajes, porque todos los
// contextos de la extensión reciben lo que se envía con chrome.runtime.sendMessage.
export const TARGET = {
  BACKGROUND: 'background',
  OFFSCREEN: 'offscreen',
  POPUP: 'popup'
};

// Estados posibles de la captura (se reflejan en la UI del popup).
export const ESTADO = {
  INACTIVO: 'inactivo',
  INICIANDO: 'iniciando',
  CAPTURANDO: 'capturando',
  ERROR: 'error'
};

// Códigos de error que el popup puede distinguir programáticamente.
export const ERROR = {
  YA_EN_CAPTURA: 'YA_EN_CAPTURA'
};

// Estado persistido por el service worker en chrome.storage.session.
// Es la ÚNICA fuente de verdad: el SW de MV3 se suspende y pierde la memoria.
export const CLAVE_ESTADO_SESION = 'livedub.estado';

// Estados del modelo tal y como los pinta el popup.
export const ESTADO_MODELO_UI = {
  INACTIVO: 'inactivo',
  CARGANDO: 'cargando',
  LISTO: 'listo',
  TRANSCRIBIENDO: 'transcribiendo',
  TRADUCIENDO: 'traduciendo',
  SINTETIZANDO: 'sintetizando', // Fase 5: generando la voz
  HABLANDO: 'hablando', // Fase 5: reproduciendo el doblaje
  // Fase 5.1: el modelo carga y funciona, pero este equipo no genera voz
  // a tiempo. No es un error: es un veredicto medido.
  INSUFICIENTE: 'insuficiente',
  ERROR: 'error'
};

// Los tres módulos de IA son independientes: si uno falla, los otros siguen.
export const MODULO = {
  TRANSCRIPCION: 'transcripcion',
  TRADUCCION: 'traduccion',
  SINTESIS: 'sintesis'
};

export const ESTADO_SESION = {
  CAPTURANDO: 'CAPTURANDO',
  INACTIVO: 'INACTIVO'
};

// Búfer de subtítulos y estado del modelo en chrome.storage.session, para que
// el popup pueda cerrarse y reabrirse sin perder lo transcrito.
export const CLAVE_SUBTITULOS = 'livedub.subtitulos';
export const CLAVE_MODELO = 'livedub.modelo'; // estado del modelo de transcripción
export const CLAVE_TRADUCTOR = 'livedub.traductor'; // estado del modelo de traducción
export const CLAVE_SINTETIZADOR = 'livedub.sintetizador'; // estado del modelo de voz
export const MAX_SUBTITULOS = 20; // cuántas frases guardamos como historial

// Clave usada en chrome.storage.local para las preferencias de idioma.
export const CLAVE_IDIOMAS = 'livedub_idiomas';

// Fase 5. Preferencias del doblaje por voz, en chrome.storage.local.
export const CLAVE_DOBLAJE = 'livedub_doblaje';

// Volumen al que baja el audio ORIGINAL mientras habla el doblaje, y tiempo de
// la rampa. 0.18 = 18 %: se sigue oyendo de fondo sin pisar a la voz.
export const DUCKING = {
  NIVEL: 0.18,
  RAMPA_S: 0.25 // rampa suave, nada de cortes bruscos
};

/* ------------------------------------------------------------------ */
/* Fase 5.1 — Ajustes de rendimiento de la voz                         */
/* ------------------------------------------------------------------ */
//
// Todos los números de abajo salieron de una medición real en un Intel
// i5-12400 (ver docs/RENDIMIENTO-VOZ.md). Están aquí, juntos y en el único
// archivo de constantes del proyecto, para poder tocarlos sin bucear en el
// código.
export const VOZ = {
  // ─── Motor ONNX ───────────────────────────────────────────────────
  // true  = onnx/model_quantized.onnx (38 MB, int8)
  // false = onnx/model.onnx           (114 MB, float32)
  //
  // MEDIDO EL 7-OCT-2026 EN UN i5-12400, NO SUPUESTO:
  //
  //   int8    (quantized) → ~3.550 ms por segundo de audio
  //   float32 (completo)  → ~4.057 ms por segundo de audio
  //
  // Se probó float32 porque en VITS la cuantización int8 PUEDE salir lenta
  // (decodificador convolucional + conversiones que ONNX Runtime inserta en
  // las capas que no soporta en int8). La hipótesis era razonable y resultó
  // FALSA en este equipo: float32 fue un 14 % peor, además de pesar 3 veces
  // más. Se vuelve a int8.
  //
  // El interruptor se conserva porque la relación puede invertirse en otro
  // equipo o con otra versión de onnxruntime. Para compararlo: cambia esta
  // línea, recarga la extensión y mira livedub.rendimiento().
  USAR_CUANTIZADO: true,

  ARCHIVO_CUANTIZADO: 'onnx/model_quantized.onnx',
  ARCHIVO_COMPLETO: 'onnx/model.onnx',

  // ─── Velocidad de reproducción ────────────────────────────────────
  // El español traducido necesita ~20-25 % más sílabas que el inglés y
  // MMS-TTS habla pausado: el doblaje sale MÁS LARGO que el fragmento que
  // sustituye, así que se retrasa aunque la síntesis fuese instantánea.
  // Acelerar la reproducción lo compensa sin gastar ni un ciclo de CPU.
  //
  // AVISO: esto es acelerar la cinta, así que el tono sube un poco (1.20 ≈
  // tres semitonos). Ajustable en caliente con livedub.setVelocidadVoz(1.1).
  VELOCIDAD: 1.2,
  VELOCIDAD_MIN: 0.8,
  VELOCIDAD_MAX: 1.6,

  // Silencio insertado entre oraciones de una misma frase. Estaba en 120 ms,
  // que sumaba medio segundo en frases de cinco oraciones; 40 ms basta para
  // que no suene atropellado.
  PAUSA_ENTRE_ORACIONES_S: 0.04,

  // ─── Banco de medición y veredicto ────────────────────────────────
  // Cuántos milisegundos cuesta generar un segundo de voz. Por debajo de
  // 1000 el equipo sintetiza más rápido de lo que dura el audio.
  MS_POR_SEGUNDO_OBJETIVO: 1000,
  // Margen: hay que ir holgadamente por debajo, porque la síntesis comparte
  // un único hilo con Whisper y el traductor.
  MS_POR_SEGUNDO_LIMITE: 850,
  // Mediciones necesarias antes de emitir un veredicto sobre el equipo.
  MUESTRAS_PARA_VEREDICTO: 3,
  // Estimación inicial, sólo hasta tener medidas propias (caracteres/segundo
  // de voz que produce MMS-TTS en español).
  CARACTERES_POR_SEGUNDO: 14,
  // Techo de espera por frase antes de ni siquiera intentarla.
  PRESUPUESTO_MS: 15000
};

// Resuelve qué archivo .onnx toca según el interruptor de arriba.
export function archivoOnnxVoz(usarCuantizado = VOZ.USAR_CUANTIZADO) {
  return usarCuantizado ? VOZ.ARCHIVO_CUANTIZADO : VOZ.ARCHIVO_COMPLETO;
}
