// offscreen.js
// Responsabilidad: capturar el audio de la pestaña y RE-ENRUTARLO para que el
// usuario lo siga oyendo, además de medir su nivel (RMS) para el medidor del popup.
//
// Grafo de audio (Fase 1):
//   MediaStreamSource -> gainOriginal -> destination   (lo que oye el usuario)
//                     \-> analyser                      (medición, nodo hoja)
// El analyser cuelga de la FUENTE, no de gainOriginal: así el medidor seguirá
// mostrando el nivel real aunque el ducking baje gainOriginal.

import { MSG, TARGET } from './messages.js';

const INTERVALO_NIVEL_MS = 100; // cada cuánto enviamos el nivel al popup

// Referencias vivas de la captura actual.
let stream = null;
let audioContext = null;
let fuente = null;
let gainOriginal = null;
let analyser = null;
let temporizadorNivel = null;
let bufferAnalisis = null;

/* ------------------------------------------------------------------ */
/* Captura                                                             */
/* ------------------------------------------------------------------ */

async function iniciar(streamId) {
  if (stream) {
    // Ya estábamos capturando: limpiamos antes de volver a empezar.
    await detener();
  }

  // 6. Obtenemos el stream de la pestaña a partir del streamId del service worker.
  stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: 'tab',
        chromeMediaSourceId: streamId
      }
    },
    video: false
  });

  if (stream.getAudioTracks().length === 0) {
    throw new Error('La pestaña no tiene pista de audio.');
  }

  // 7. CRÍTICO: al capturar, el usuario dejaría de oír la pestaña.
  //    Reconectamos el audio a los altavoces a través de gainOriginal.
  audioContext = new AudioContext();
  if (audioContext.state === 'suspended') await audioContext.resume();

  fuente = audioContext.createMediaStreamSource(stream);

  gainOriginal = audioContext.createGain();
  gainOriginal.gain.value = 1; // volumen normal; el ducking llegará en otra fase

  analyser = audioContext.createAnalyser();
  analyser.fftSize = 2048;
  bufferAnalisis = new Float32Array(analyser.fftSize);

  fuente.connect(gainOriginal);
  gainOriginal.connect(audioContext.destination);
  fuente.connect(analyser); // nodo hoja: no va a destination (no suena dos veces)

  // Si el usuario cierra la pestaña o detiene el stream desde Chrome.
  stream.getAudioTracks().forEach((pista) => {
    pista.addEventListener('ended', () => detener());
  });

  arrancarMedidor();
}

function arrancarMedidor() {
  pararMedidor();
  temporizadorNivel = setInterval(() => {
    if (!analyser) return;
    analyser.getFloatTimeDomainData(bufferAnalisis);

    // Nivel RMS (0..1 aproximado).
    let suma = 0;
    for (let i = 0; i < bufferAnalisis.length; i++) {
      suma += bufferAnalisis[i] * bufferAnalisis[i];
    }
    const rms = Math.sqrt(suma / bufferAnalisis.length);

    chrome.runtime
      .sendMessage({ type: MSG.AUDIO_LEVEL, target: TARGET.POPUP, nivel: rms })
      .catch(() => {
        /* Popup cerrado: no pasa nada. */
      });
  }, INTERVALO_NIVEL_MS);
}

function pararMedidor() {
  if (temporizadorNivel !== null) {
    clearInterval(temporizadorNivel);
    temporizadorNivel = null;
  }
}

// 9. Parar tracks + cerrar AudioContext. (El cierre del documento offscreen
//    lo hace el background con chrome.offscreen.closeDocument().)
async function detener() {
  pararMedidor();

  if (stream) {
    stream.getTracks().forEach((pista) => pista.stop());
    stream = null;
  }

  try {
    fuente?.disconnect();
    gainOriginal?.disconnect();
    analyser?.disconnect();
  } catch (_) {
    /* Ya estaban desconectados. */
  }
  fuente = null;
  gainOriginal = null;
  analyser = null;
  bufferAnalisis = null;

  if (audioContext && audioContext.state !== 'closed') {
    await audioContext.close();
  }
  audioContext = null;
}

// 8. Ajuste de volumen del audio original (0..1). Lo usará el ducking.
function fijarGanancia(valor) {
  const v = Math.min(1, Math.max(0, Number(valor)));
  if (!gainOriginal || !audioContext) return { ok: false, error: 'No hay captura activa.' };
  // Rampa corta para evitar chasquidos.
  gainOriginal.gain.setTargetAtTime(v, audioContext.currentTime, 0.02);
  return { ok: true, value: v };
}

/* ------------------------------------------------------------------ */
/* Mensajería                                                          */
/* ------------------------------------------------------------------ */

chrome.runtime.onMessage.addListener((mensaje, _remitente, responder) => {
  if (mensaje?.target && mensaje.target !== TARGET.OFFSCREEN) return false;

  switch (mensaje?.type) {
    case MSG.OFFSCREEN_START:
      iniciar(mensaje.streamId)
        .then(() => responder({ ok: true }))
        .catch(async (error) => {
          await detener().catch(() => {});
          responder({ ok: false, error: String(error?.message || error) });
        });
      return true;

    case MSG.OFFSCREEN_STOP:
      detener()
        .then(() => responder({ ok: true }))
        .catch((error) => responder({ ok: false, error: String(error?.message || error) }));
      return true;

    case MSG.SET_GAIN:
      responder(fijarGanancia(mensaje.value));
      return false;

    default:
      return false;
  }
});

// Ayuda para depurar desde la consola del documento offscreen:
//   livedub.setGain(0.2)  /  livedub.setGain(1)
globalThis.livedub = {
  setGain: (v) => fijarGanancia(v),
  estado: () => ({
    capturando: Boolean(stream),
    ganancia: gainOriginal?.gain.value ?? null,
    audioContext: audioContext?.state ?? 'cerrado'
  })
};
