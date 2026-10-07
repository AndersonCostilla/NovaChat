// offscreen.js
// Responsabilidades:
//  (Fase 1) capturar el audio de la pestaña y RE-ENRUTARLO para que el usuario
//           lo siga oyendo, midiendo su nivel para el medidor del popup.
//  (Fase 2) en PARALELO, pasar el mismo stream por un segundo contexto a 16 kHz
//           mono y segmentarlo en "frases" con un VAD por detección de silencios.
//  (Fase 3) mandar cada frase al worker de transcripción local (Whisper WASM) y
//           publicar el texto resultante como subtítulo.
//  (Fase 4) si el texto está en inglés, traducirlo al español con un SEGUNDO
//           worker independiente y publicar original + traducción.
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

import { MSG, TARGET, CLAVE_IDIOMAS, ESTADO_MODELO_UI, MODULO } from './messages.js';
import { crearTranscriptor } from './transcriptor.js';
import { crearTraductor } from './traductor.js';
import { detectarIdioma, NOMBRE_IDIOMA } from './detector-idioma.js';

const INTERVALO_NIVEL_MS = 100; // cada cuánto enviamos el nivel al popup

/* ---------------------- Constantes del VAD ------------------------ */
// Ajustables: dependen del material de audio.
const FRECUENCIA_PROCESO = 16000; // Hz, lo que esperan los modelos de voz
let VAD_THRESHOLD = 0.005; // umbral RMS por encima del cual consideramos voz
//                            (ajustable en caliente: livedub.setVadThreshold)
const MAX_SILENCE_CHUNKS = 3; // bloques de silencio seguidos para cerrar la frase
//                              (3 x 256 ms ≈ 750 ms)

// Corte forzado: con habla continua sin pausas, el buffer crecía sin límite y
// Whisper alucinaba (repeticiones) al recibir más de un minuto de audio.
// 47 bloques x 256 ms ≈ 12 s, muy por debajo de la ventana de 30 s del modelo.
const MAX_FRASE_CHUNKS = 47;

let depurarVad = false; // livedub.vadDebug(true) imprime el RMS de cada bloque
let frasesDescartadas = 0; // frases que el VAD cortó pero nadie transcribió

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

// Transcripción (Fase 3) y traducción (Fase 4).
let transcriptor = null;
let traductor = null;
let idiomaOrigen = 'auto'; // se lee de chrome.storage.local (preferencias del popup)

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
  await montarTranscriptor();

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

  if (depurarVad) {
    console.log(
      `[VAD] rms=${rms.toFixed(5)} ${rms > VAD_THRESHOLD ? 'VOZ ' : 'sil '}` +
        `bloques=${speechChunks.length} silencio=${silenceCounter}`
    );
  }

  if (rms > VAD_THRESHOLD) {
    // Hay voz: acumulamos y reiniciamos la cuenta de silencio.
    isSpeaking = true;
    silenceCounter = 0;
    speechChunks.push(buffer);

    // Corte forzado si la frase se alarga demasiado (habla sin pausas).
    // Seguimos en isSpeaking: lo siguiente que venga abre otra frase.
    if (speechChunks.length >= MAX_FRASE_CHUNKS) {
      const frase = ensamblarChunks(speechChunks);
      speechChunks = [];
      silenceCounter = 0;
      console.log(
        `✂️ Corte forzado a los ${(frase.length / FRECUENCIA_PROCESO).toFixed(1)} s ` +
          '(habla continua sin pausas).'
      );
      onFraseDetectada(frase);
    }
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

// Fase 2 + 3: registramos la frase y la mandamos a transcribir.
function onFraseDetectada(float32Array) {
  const segundos = (float32Array.length / FRECUENCIA_PROCESO).toFixed(2);

  // Si el modelo no está disponible seguimos en modo "solo captura": el VAD
  // sigue trabajando y la extensión no se rompe, simplemente no hay subtítulo.
  const aceptada = transcriptor?.transcribir(float32Array, idiomaOrigen);

  if (aceptada) {
    console.log(`🗣️ Frase detectada: ${segundos} s → enviada a transcribir (#${aceptada})`);
    return;
  }

  // Dejar claro que la frase NO se está transcribiendo, en vez de aparentar
  // trabajo: era confuso durante las pruebas con el modelo ausente.
  frasesDescartadas++;
  const motivo = transcriptor
    ? `modelo en estado "${transcriptor.obtenerEstado()}"`
    : 'transcriptor no iniciado';
  console.log(
    `🗣️ Frase detectada: ${segundos} s → DESCARTADA (${motivo}). ` +
      `Total descartadas: ${frasesDescartadas}`
  );
}

/* ------------------------------------------------------------------ */
/* Transcripción local (Fase 3)                                        */
/* ------------------------------------------------------------------ */

async function montarTranscriptor() {
  // Idioma origen elegido por el usuario en el popup (sólo preferencia).
  try {
    const datos = await chrome.storage.local.get(CLAVE_IDIOMAS);
    idiomaOrigen = datos?.[CLAVE_IDIOMAS]?.origen || 'auto';
  } catch (_) {
    idiomaOrigen = 'auto';
  }

  transcriptor = crearTranscriptor({
    onEstado: (info) => publicarEstadoModelo(info),
    // Actividad = sólo para la UI: no cambia el estado interno del transcriptor.
    onActividad: (ocupado) =>
      publicarEstadoModelo({
        estado: ocupado ? ESTADO_MODELO_UI.TRANSCRIBIENDO : ESTADO_MODELO_UI.LISTO,
        detalle: ocupado ? 'Transcribiendo la última frase…' : 'Modelo listo'
      }),
    onResultado: (resultado) => traducirYPublicar(resultado),
    onError: (error) => console.warn('[LiveDub] Error transcribiendo una frase:', error)
  });

  // Rutas LOCALES (chrome-extension://). Nunca hay una URL remota aquí.
  transcriptor.iniciar({
    rutaModelos: chrome.runtime.getURL('models/'),
    rutaWasm: chrome.runtime.getURL('libs/transformers/'),
    modelo: 'whisper-tiny'
  });

  montarTraductor();
}

// Fase 4: worker de traducción, totalmente independiente del de Whisper.
function montarTraductor() {
  traductor = crearTraductor({
    onEstado: (info) => publicarEstadoModelo(info, MODULO.TRADUCCION),
    onActividad: (ocupado) =>
      publicarEstadoModelo(
        {
          estado: ocupado ? ESTADO_MODELO_UI.TRADUCIENDO : ESTADO_MODELO_UI.LISTO,
          detalle: ocupado ? 'Traduciendo la última frase…' : 'Traductor listo'
        },
        MODULO.TRADUCCION
      ),
    onError: (error) => console.warn('[LiveDub] Error traduciendo una frase:', error)
  });

  traductor.iniciar({
    rutaModelos: chrome.runtime.getURL('models/'),
    rutaWasm: chrome.runtime.getURL('libs/transformers/'),
    modelo: 'opus-mt-en-es'
  });
}

/* ------------------------------------------------------------------ */
/* Regla de idioma (Fase 4: sólo inglés → español)                     */
/* ------------------------------------------------------------------ */

// Decide si una transcripción se traduce. Devuelve { traducir, aviso }.
function decidirTraduccion(texto) {
  if (idiomaOrigen === 'en') {
    return { traducir: true, aviso: '' };
  }

  if (idiomaOrigen !== 'auto') {
    const nombre = NOMBRE_IDIOMA[idiomaOrigen] || idiomaOrigen;
    return {
      traducir: false,
      aviso: `Traducción no disponible para ${nombre} (por ahora sólo inglés → español).`
    };
  }

  // Idioma origen en «automático»: Whisper no nos dice qué idioma detectó, así
  // que usamos una heurística sobre el texto. Si no parece inglés, no se
  // traduce: mejor quedarse corto que inventar una traducción incorrecta.
  const pista = detectarIdioma(texto);
  if (pista.esIngles) return { traducir: true, aviso: '' };

  const nombre = NOMBRE_IDIOMA[pista.idioma] || pista.idioma;
  return {
    traducir: false,
    aviso: `El texto no parece inglés (${nombre}): traducción no disponible (por ahora sólo inglés → español).`
  };
}

// El offscreen YA NO escribe en chrome.storage.session: sus escrituras no
// cuajaban (bug detectado en la prueba de Nivel 2). Se lo pide al service
// worker, que es el único dueño del storage y quien reenvía al popup.
// Si el envío falla, se avisa por consola: nada de errores en silencio.
async function pedirAlServiceWorker(mensaje, queEs) {
  try {
    const respuesta = await chrome.runtime.sendMessage({ ...mensaje, target: TARGET.BACKGROUND });
    if (respuesta && respuesta.ok === false) {
      console.warn(`[LiveDub] El service worker no pudo guardar ${queEs}:`, respuesta.error);
    }
    return respuesta;
  } catch (error) {
    console.warn(`[LiveDub] No se pudo enviar ${queEs} al service worker:`, error?.message || error);
    return null;
  }
}

// Estado de un modelo (transcripción o traducción) -> SW -> storage + popup.
function publicarEstadoModelo(info, modulo = MODULO.TRANSCRIPCION) {
  return pedirAlServiceWorker(
    {
      type: MSG.MODEL_STATUS_SET,
      modulo,
      modelo: {
        estado: info?.estado ?? ESTADO_MODELO_UI.INACTIVO,
        detalle: info?.detalle ?? ''
      }
    },
    `el estado del módulo de ${modulo}`
  );
}

// Transcripción lista -> (si procede) traducción -> publicación única.
// Se publica una sola vez, con original y traducción juntos, para no tener que
// reinventar el canal de persistencia con actualizaciones parciales.
async function traducirYPublicar({ texto, idiomaDetectado, duracionMs }) {
  const decision = decidirTraduccion(texto);

  let traduccion = '';
  let duracionTraduccionMs = 0;
  let aviso = decision.aviso;

  if (decision.traducir) {
    const estadoTraductor = traductor?.obtenerEstado();
    const resultado = await (traductor?.traducir(texto) ??
      Promise.resolve({ traduccion: '', motivo: 'traductor no iniciado' }));

    traduccion = resultado.traduccion || '';
    duracionTraduccionMs = resultado.duracionMs || 0;

    if (!traduccion) {
      // Degradación independiente: sin traducción, pero el subtítulo se publica.
      aviso = `Traducción no disponible (${resultado.motivo || estadoTraductor || 'desconocido'}).`;
    }
  }

  return publicarSubtitulo({
    texto,
    traduccion,
    aviso,
    idiomaDetectado,
    duracionMs,
    duracionTraduccionMs
  });
}

// Subtítulo -> service worker -> historial en storage.session + popup.
function publicarSubtitulo({ texto, traduccion, aviso, idiomaDetectado, duracionMs, duracionTraduccionMs }) {
  return pedirAlServiceWorker(
    {
      type: MSG.SUBTITLE_ADD,
      subtitulo: {
        texto,
        traduccion: traduccion || '',
        aviso: aviso || '',
        idioma: idiomaDetectado,
        duracionMs,
        duracionTraduccionMs: duracionTraduccionMs || 0,
        totalMs: (duracionMs || 0) + (duracionTraduccionMs || 0),
        t: Date.now()
      }
    },
    'un subtítulo'
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

  // --- Transcripción (Fase 3) y traducción (Fase 4) ---
  transcriptor?.destruir();
  transcriptor = null;
  traductor?.destruir();
  traductor = null;

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
  frasesDescartadas = 0;
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
    vad: { isSpeaking, bloquesAcumulados: speechChunks.length, silenceCounter },
    modelo: transcriptor?.obtenerEstado() ?? 'inactivo',
    traductor: traductor?.obtenerEstado() ?? 'inactivo',
    frasesDescartadas,
    idiomaOrigen
  }),
  // Permite afinar el VAD en caliente, sin recargar la extensión.
  vadInfo: () => ({ VAD_THRESHOLD, MAX_SILENCE_CHUNKS, MAX_FRASE_CHUNKS }),
  setVadThreshold: (v) => {
    VAD_THRESHOLD = Math.max(0, Number(v) || 0);
    return VAD_THRESHOLD;
  },
  // livedub.vadDebug(true) imprime el RMS bloque a bloque: sirve para calibrar
  // el umbral con material real en lugar de a ojo.
  vadDebug: (activo = true) => {
    depurarVad = Boolean(activo);
    return depurarVad;
  }
};
