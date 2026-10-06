// offscreen.js
// Responsabilidades:
//  (Fase 1) capturar el audio de la pestaña y RE-ENRUTARLO para que el usuario
//           lo siga oyendo, midiendo su nivel para el medidor del popup.
//  (Fase 2) en PARALELO, pasar el mismo stream por un segundo contexto a 16 kHz
//           mono y segmentarlo en "frases" con un VAD por detección de silencios.
//
// Grafo de audio:
//
//   contextOriginal (frecuencia nativa, normalmente 48 kHz)  -> lo que SE OYE
//     MediaStreamSource -> gainOriginal -> destination
//                       \-> analyser                 (medición, nodo hoja)
//
//   contextProcessing (16 kHz, mono)                        -> lo que VERÁ la IA
//     MediaStreamSource -> AudioWorkletNode('vad-processor') -> sumideroMudo (gain 0)
//
// El analyser cuelga de la FUENTE, no de gainOriginal: así el medidor seguirá
// mostrando el nivel real aunque el ducking baje gainOriginal.

import { MSG, TARGET } from './messages.js';

const INTERVALO_NIVEL_MS = 100; // cada cuánto enviamos el nivel al popup

/* ---------------------- Constantes del VAD ------------------------ */
// Ajustables: dependen del material de audio.
const FRECUENCIA_PROCESO = 16000; // Hz, lo que esperan los modelos de voz
const VAD_THRESHOLD = 0.005; // umbral RMS por encima del cual consideramos voz
const MAX_SILENCE_CHUNKS = 3; // bloques de silencio seguidos para cerrar la frase
//                              (3 x 256 ms ≈ 750 ms)

/* ------------------- Referencias vivas de la captura --------------- */
let stream = null;

// Cadena original (lo que oye el usuario).
let contextOriginal = null;
let fuenteOriginal = null;
let gainOriginal = null;
let analyser = null;
let temporizadorNivel = null;
let bufferAnalisis = null;

// Cadena de procesado a 16 kHz (no se oye).
let contextProcessing = null;
let fuenteProcessing = null;
let workletNode = null;
let sumideroMudo = null;

/* ------------------------ Estado del VAD --------------------------- */
let isSpeaking = false;
let speechChunks = []; // array de Float32Array
let silenceCounter = 0;

function reiniciarVad() {
  isSpeaking = false;
  speechChunks = [];
  silenceCounter = 0;
}

/* ------------------------------------------------------------------ */
/* Captura                                                             */
/* ------------------------------------------------------------------ */

async function iniciar(streamId) {
  if (stream) {
    // Ya estábamos capturando: limpiamos antes de volver a empezar.
    await detener();
  }

  // Obtenemos el stream de la pestaña a partir del streamId del service worker.
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

  await montarCadenaOriginal();
  await montarCadenaProcesado();

  // Si el usuario cierra la pestaña o detiene el stream desde Chrome.
  stream.getAudioTracks().forEach((pista) => {
    pista.addEventListener('ended', () => detener());
  });

  arrancarMedidor();
}

// CRÍTICO (Fase 1): al capturar, el usuario dejaría de oír la pestaña.
// Reconectamos el audio a los altavoces a través de gainOriginal.
async function montarCadenaOriginal() {
  contextOriginal = new AudioContext();
  if (contextOriginal.state === 'suspended') await contextOriginal.resume();

  fuenteOriginal = contextOriginal.createMediaStreamSource(stream);

  gainOriginal = contextOriginal.createGain();
  gainOriginal.gain.value = 1; // volumen normal; el ducking llegará en otra fase

  analyser = contextOriginal.createAnalyser();
  analyser.fftSize = 2048;
  bufferAnalisis = new Float32Array(analyser.fftSize);

  fuenteOriginal.connect(gainOriginal);
  gainOriginal.connect(contextOriginal.destination);
  fuenteOriginal.connect(analyser); // nodo hoja: no va a destination
}

// Fase 2: segunda cadena, independiente, a 16 kHz. Nunca llega a los altavoces.
async function montarCadenaProcesado() {
  // El propio AudioContext hace el remuestreo de 48 kHz a 16 kHz.
  contextProcessing = new AudioContext({ sampleRate: FRECUENCIA_PROCESO });
  if (contextProcessing.state === 'suspended') await contextProcessing.resume();

  await contextProcessing.audioWorklet.addModule('vad-processor.js');

  fuenteProcessing = contextProcessing.createMediaStreamSource(stream);

  workletNode = new AudioWorkletNode(contextProcessing, 'vad-processor', {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    channelCount: 1,
    channelCountMode: 'explicit',
    channelInterpretation: 'speakers'
  });

  workletNode.port.onmessage = (evento) => {
    const datos = evento.data;
    if (datos?.event === 'chunk') procesarChunkVad(datos.buffer, datos.rms);
  };

  fuenteProcessing.connect(workletNode);

  // El worklet NO debe oírse. Pero Chrome sólo "tira" de los nodos que llegan
  // al destination, así que lo rematamos con una ganancia 0: el grafo se procesa
  // y por los altavoces no sale absolutamente nada de esta cadena.
  sumideroMudo = contextProcessing.createGain();
  sumideroMudo.gain.value = 0;
  workletNode.connect(sumideroMudo);
  sumideroMudo.connect(contextProcessing.destination);

  reiniciarVad();
}

/* ------------------------------------------------------------------ */
/* Máquina de estados del VAD                                          */
/* ------------------------------------------------------------------ */

function procesarChunkVad(buffer, rms) {
  if (!buffer) return;

  if (rms > VAD_THRESHOLD) {
    // Hay voz: acumulamos y reiniciamos la cuenta de silencio.
    isSpeaking = true;
    silenceCounter = 0;
    speechChunks.push(buffer);
    return;
  }

  // Silencio. Sólo nos importa si veníamos hablando.
  if (!isSpeaking) return;

  silenceCounter++;
  speechChunks.push(buffer); // guardamos el silencio como margen final (trailing)

  if (silenceCounter >= MAX_SILENCE_CHUNKS) {
    // ¡FRASE TERMINADA!
    isSpeaking = false;
    const frase = ensamblarChunks(speechChunks);
    speechChunks = [];
    silenceCounter = 0;
    onFraseDetectada(frase);
  }
}

// Une varios Float32Array en uno solo continuo.
function ensamblarChunks(chunks) {
  let total = 0;
  for (const c of chunks) total += c.length;

  const salida = new Float32Array(total);
  let desplazamiento = 0;
  for (const c of chunks) {
    salida.set(c, desplazamiento);
    desplazamiento += c.length;
  }
  return salida;
}

// Fase 2: de momento SÓLO registramos la frase por consola.
// (La transcripción llega en una fase posterior.)
function onFraseDetectada(float32Array) {
  console.log(
    '🗣️ Frase detectada:',
    float32Array.length / FRECUENCIA_PROCESO,
    'segundos',
    float32Array
  );
}

/* ------------------------------------------------------------------ */
/* Medidor de nivel (Fase 1, intacto)                                  */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/* Parada y limpieza (los DOS contextos)                               */
/* ------------------------------------------------------------------ */

// Parar tracks + cerrar AMBOS AudioContext. (El cierre del documento offscreen
// lo hace el background con chrome.offscreen.closeDocument().)
async function detener() {
  pararMedidor();

  if (stream) {
    stream.getTracks().forEach((pista) => pista.stop());
    stream = null;
  }

  // --- Cadena de procesado (16 kHz) ---
  try {
    if (workletNode) {
      workletNode.port.onmessage = null;
      workletNode.port.close();
      workletNode.disconnect();
    }
    fuenteProcessing?.disconnect();
    sumideroMudo?.disconnect();
  } catch (_) {
    /* Ya estaban desconectados. */
  }
  workletNode = null;
  fuenteProcessing = null;
  sumideroMudo = null;

  if (contextProcessing && contextProcessing.state !== 'closed') {
    await contextProcessing.close();
  }
  contextProcessing = null;

  // --- Cadena original (lo que se oye) ---
  try {
    fuenteOriginal?.disconnect();
    gainOriginal?.disconnect();
    analyser?.disconnect();
  } catch (_) {
    /* Ya estaban desconectados. */
  }
  fuenteOriginal = null;
  gainOriginal = null;
  analyser = null;
  bufferAnalisis = null;

  if (contextOriginal && contextOriginal.state !== 'closed') {
    await contextOriginal.close();
  }
  contextOriginal = null;

  reiniciarVad();
}

// Ajuste de volumen del audio original (0..1). Lo usará el ducking.
function fijarGanancia(valor) {
  const v = Math.min(1, Math.max(0, Number(valor)));
  if (!gainOriginal || !contextOriginal) return { ok: false, error: 'No hay captura activa.' };
  // Rampa corta para evitar chasquidos.
  gainOriginal.gain.setTargetAtTime(v, contextOriginal.currentTime, 0.02);
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
//   livedub.setGain(0.2)  /  livedub.setGain(1)  /  livedub.estado()
globalThis.livedub = {
  setGain: (v) => fijarGanancia(v),
  estado: () => ({
    capturando: Boolean(stream),
    ganancia: gainOriginal?.gain.value ?? null,
    contextOriginal: contextOriginal?.state ?? 'cerrado',
    contextProcessing: contextProcessing?.state ?? 'cerrado',
    frecuenciaProceso: contextProcessing?.sampleRate ?? null,
    vad: { isSpeaking, bloquesAcumulados: speechChunks.length, silenceCounter }
  }),
  // Permite afinar el umbral en caliente sin recargar la extensión.
  vadInfo: () => ({ VAD_THRESHOLD, MAX_SILENCE_CHUNKS })
};
