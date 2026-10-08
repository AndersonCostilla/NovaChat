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
