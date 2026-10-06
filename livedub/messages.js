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

export const ESTADO_SESION = {
  CAPTURANDO: 'CAPTURANDO',
  INACTIVO: 'INACTIVO'
};

// Clave usada en chrome.storage.local para las preferencias de idioma.
export const CLAVE_IDIOMAS = 'livedub_idiomas';
