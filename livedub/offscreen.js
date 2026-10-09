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

import { MSG, TARGET, ESTADO_MODELO_UI, MODULO, MOTOR_VOZ, VOZ_SISTEMA } from './messages.js';
import { crearTranscriptor } from './transcriptor.js';
import { crearTraductor } from './traductor.js';
import { crearMotorVoz } from './motor-voz.js';
import { fijarVelocidadDoblaje, obtenerVelocidadDoblaje } from './reproductor-doblaje.js';
import { detectarIdioma, NOMBRE_IDIOMA } from './detector-idioma.js';
import { crearCronometro, MOTIVO_CIERRE } from './cronometro.js';
import { recortar, recortarLote, OBJETIVO_POR_DEFECTO } from './recortador.js';
import { trocearEnOraciones } from './segmentador.js';
import { analizarTrozos, sanearTrozos, TROZOS_MAXIMOS } from './detector-alucinacion.js';

const INTERVALO_NIVEL_MS = 100; // cada cuánto enviamos el nivel al popup

/* ------------------- Recorte de traducciones --------------------- */
// Opción A: acortar el español para bajar la ocupación por debajo del 100 %.
//
// ARRANCA APAGADO A PROPÓSITO. Es un cambio que afecta a lo que el
// espectador oye, así que no se activa solo: hay que verlo primero con
// livedub.recorteEjemplos() y encenderlo a mano con livedub.recorte(true).
// Reversible en caliente, sin recargar nada y sin tocar el resto de la
// tubería: con el recorte apagado, el texto pasa tal cual.
let recorteActivo = false;
let recorteObjetivo = OBJETIVO_POR_DEFECTO;

/* ---------------- Tope de alucinaciones (la #57) ------------------ */
//
// ENCENDIDO POR DEFECTO desde el 8-oct-2026 por la noche, autorizado por
// Anderson con esta evidencia: el detector acertó en dos casos reales (la
// #57, "Es interesante." x111, y la #23, 8 trozos y 92 s de voz) y no marcó
// ninguna frase legítima. Se apaga con livedub.toparAlucinaciones(false).
let toparAlucinacionesActivo = true;

// Registro de lo que el tope ha recortado, para poder revisarlo A MANO
// después de una tanda. Sin esto, "cortó 6 veces" es un número en el que no
// hay ninguna razón para confiar: hay que poder leer los textos.
const cortes = [];
const MAX_CORTES_GUARDADOS = 50;

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
// Fachada del doblaje: decide si habla la voz del sistema o MMS-TTS y se
// encarga del ducking. Ver motor-voz.js.
let motorVoz = null;
// null = elección automática (voz del sistema, y reserva si no hay ninguna
// instalada). Se puede forzar desde la consola con livedub.setMotorVoz().
let motorVozPedido = null;

// Mide dónde se va el tiempo de cada frase. No altera nada: sólo anota.
// Se consulta con livedub.latencia().
const cronometro = crearCronometro();

// Cuándo llegó el primer bloque CON VOZ de la frase que se está formando.
// Es el origen del reloj: sin esto no se puede distinguir el desfase medido
// desde el inicio de la frase del medido desde su final.
let tInicioHabla = null;
// Fase 5: el doblaje por voz se activa desde el popup. Por defecto apagado:
// añade latencia y carga de CPU, y el usuario debe poder usar sólo subtítulos.
let doblajeActivo = false;

// Fase 5.1. Duración (en segundos) de los últimos fragmentos de audio ORIGINAL
// detectados por el VAD. Sirve para calcular la EXPANSIÓN: cuánto más largo es
// el doblaje que el trozo de vídeo al que sustituye.
//
// APROXIMACIÓN DELIBERADA: se lleva como cola corta en vez de pasar el dato por
// dentro del transcriptor, porque la regla del proyecto es no tocar la lógica
// de transcripción. Si el transcriptor descarta una frase por ir saturado, este
// emparejamiento puede desfasarse una posición. Es un dato de diagnóstico
// agregado, no entra en ninguna decisión de corrección.
const duracionesOrigen = [];
const MAX_DURACIONES_ORIGEN = 3;
// Preferencia del popup. OJO: el documento offscreen SÓLO tiene acceso a
// chrome.runtime; chrome.storage es undefined aquí. Por eso se pide por
// mensaje al service worker y él avisa de los cambios (SETTINGS_CHANGED).
let idiomaOrigen = 'auto';

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
    // El primer bloque con voz marca el arranque del reloj de esta frase.
    if (!speechChunks.length) tInicioHabla = Date.now();
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
      onFraseDetectada(frase, MOTIVO_CIERRE.TOPE);
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
    onFraseDetectada(frase, MOTIVO_CIERRE.SILENCIO);
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
function onFraseDetectada(float32Array, motivoCierre = MOTIVO_CIERRE.SILENCIO) {
  const segundos = (float32Array.length / FRECUENCIA_PROCESO).toFixed(2);
  // Se congela el arranque de ESTA frase antes de reiniciarlo para la
  // siguiente: con el corte por tope, la frase siguiente empieza de inmediato.
  const arranque = tInicioHabla ?? Date.now();
  tInicioHabla = null;

  duracionesOrigen.push(Number(segundos));
  while (duracionesOrigen.length > MAX_DURACIONES_ORIGEN) duracionesOrigen.shift();

  // Si el modelo no está disponible seguimos en modo "solo captura": el VAD
  // sigue trabajando y la extensión no se rompe, simplemente no hay subtítulo.
  const aceptada = transcriptor?.transcribir(float32Array, idiomaOrigen);

  if (aceptada) {
    cronometro.abrir(aceptada, {
      tInicioHabla: arranque,
      segundosAudio: Number(segundos),
      motivoCierre
    });
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
  // Idioma origen elegido por el usuario en el popup.
  await leerIdiomaOrigen();

  transcriptor = crearTranscriptor({
    onEstado: (info) => publicarEstadoModelo(info),
    // Actividad = sólo para la UI: no cambia el estado interno del transcriptor.
    onActividad: (ocupado) =>
      publicarEstadoModelo({
        estado: ocupado ? ESTADO_MODELO_UI.TRANSCRIBIENDO : ESTADO_MODELO_UI.LISTO,
        detalle: ocupado ? 'Transcribiendo la última frase…' : 'Modelo listo'
      }),
    onResultado: (resultado) => traducirYPublicar(resultado),
    onDescartada: (info) =>
      registrarPerdida({
        id: info.id,
        segundos: info.segundos,
        etapa: info.etapa,
        detalle: 'Whisper no daba abasto y la cola se desbordó'
      }),
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
    // El worker avisa del tamaño del lote justo antes de entrar en generate().
    // Se anota en el cronómetro para que la columna "trozos MT" explique las
    // traducciones lentas en vez de dejarlas como un número suelto.
    onTrabajo: ({ id, trozos, maxTokens }) => cronometro.anotarLote(id, { trozos, maxTokens }),
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

  montarDoblaje();
}

// Fase 5: voz en español + ducking.
//
// El motor por defecto es la voz instalada en Windows (speechSynthesis desde
// este mismo documento offscreen). Comprobado en Chrome real el 8-oct-2026:
// habla, ve las voces locales y avisa cuando termina. MMS-TTS queda como
// reserva automática para equipos sin voz española instalada.
function montarDoblaje() {
  motorVoz = crearMotorVoz({
    // Se consulta en cada uso porque la cadena de audio se crea y se destruye
    // con cada Iniciar / Detener.
    obtenerCadena: () =>
      contextOriginal && gainOriginal ? { contexto: contextOriginal, ganancia: gainOriginal } : null,

    onEstado: (info) => publicarEstadoModelo(info, MODULO.SINTESIS),

    onHablando: (hablando) => {
      publicarEstadoModelo(
        hablando
          ? { estado: ESTADO_MODELO_UI.HABLANDO, detalle: 'Reproduciendo el doblaje…' }
          : { estado: ESTADO_MODELO_UI.LISTO, detalle: 'Voz lista' },
        MODULO.SINTESIS
      );
    },

    onError: (error) => console.warn('[LiveDub] Problema con la voz:', error),

    rutas: {
      rutaModelos: chrome.runtime.getURL('models/'),
      rutaWasm: chrome.runtime.getURL('libs/transformers/'),
      modelo: 'mms-tts-spa'
    },

    motorPedido: motorVozPedido
  });

  motorVoz.silenciar(!doblajeActivo);

  // Carga perezosa: con la voz del sistema arrancar es instantáneo y gratis,
  // pero con la reserva son 38 MB de modelo. Sólo si el doblaje está activo.
  if (doblajeActivo) arrancarMotorVoz();
}

function arrancarMotorVoz() {
  motorVoz?.iniciar().catch((error) => {
    console.error('[LiveDub] No se pudo iniciar el motor de voz:', error);
    publicarEstadoModelo(
      { estado: ESTADO_MODELO_UI.ERROR, detalle: 'No se pudo iniciar la voz.' },
      MODULO.SINTESIS
    );
  });
}

// El popup enciende o apaga el doblaje en caliente.
function aplicarDoblaje(activo) {
  const nuevo = Boolean(activo);
  if (nuevo === doblajeActivo) return;
  doblajeActivo = nuevo;
  console.log(`[LiveDub] Doblaje por voz ${doblajeActivo ? 'ACTIVADO' : 'desactivado'}.`);

  motorVoz?.silenciar(!doblajeActivo);

  if (doblajeActivo) {
    // Carga perezosa: la primera vez que se enciende.
    if (motorVoz && motorVoz.motorActivo() === null) arrancarMotorVoz();
  } else {
    publicarEstadoModelo(
      { estado: ESTADO_MODELO_UI.INACTIVO, detalle: 'Doblaje desactivado' },
      MODULO.SINTESIS
    );
  }
}

/* ------------------------------------------------------------------ */
/* Regla de idioma (Fase 4: sólo inglés → español)                     */
/* ------------------------------------------------------------------ */

// Se lo preguntamos al service worker: aquí no hay chrome.storage.
async function leerIdiomaOrigen() {
  const respuesta = await pedirAlServiceWorker(
    { type: MSG.GET_SETTINGS },
    'las preferencias de idioma'
  );
  idiomaOrigen = respuesta?.idiomas?.origen || 'auto';
  doblajeActivo = Boolean(respuesta?.doblaje);
  return idiomaOrigen;
}

// El service worker avisa cuando el usuario cambia el idioma en el popup: se
// aplica a la SIGUIENTE frase, sin necesidad de Detener e Iniciar.
function aplicarIdiomas(idiomas) {
  const nuevo = idiomas?.origen || 'auto';
  if (nuevo === idiomaOrigen) return;
  idiomaOrigen = nuevo;
  console.log(`[LiveDub] Idioma origen cambiado a "${idiomaOrigen}" (afecta a la próxima frase).`);
}

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
async function traducirYPublicar({ id, texto, idiomaDetectado, duracionMs }) {
  // Whisper ha terminado con esta frase.
  cronometro.marcar(id, 'tFinAsr', { texto, caracteres: texto?.length ?? 0 });

  // ¿Esto es habla o es una alucinación de Whisper? Se mira ANTES de
  // traducir: así, cuando el tope esté activo, nos ahorramos también los
  // segundos de traducción, no sólo los de voz.
  //
  // La frase #57 del 8-oct-2026: "Es interesante." x111 sobre 12,03 s de
  // audio. Se tradujo entera y se habló entera — 102,95 s de voz, ocupación
  // del 856 % — y bloqueó la cola de voz el tiempo suficiente para llevarse
  // por delante 14 frases legítimas seguidas (ids 58 a 68).
  const trozosOriginales = trocearEnOraciones(texto);

  // LA DURACIÓN DEL AUDIO, NO LO QUE TARDÓ WHISPER.
  //
  // Error del 8-oct-2026 que invalidó cuatro de los cinco cortes de la
  // tanda de 64 frases: aquí se pasaba `duracionMs`, que es el tiempo de
  // PROCESO del transcriptor (mediana 4,31 s), como si fuera la duración
  // del audio (hasta 12,03 s). El criterio de proporción dividía por un
  // número unas tres veces más pequeño de lo debido, así que una frase
  // normal a 1,11x aparentaba más de 3x y saltaba el aviso.
  //
  // El dato bueno entra por el VAD y lo guarda el cronómetro. Hay que
  // pedirlo. Si por lo que sea no está, NO se inventa: se pasa null y los
  // criterios que dependen de la duración no se evalúan.
  const segundosAudio = cronometro.segundosAudioDe(id);
  const diagnostico = analizarTrozos(trozosOriginales, { segundosAudio });
  cronometro.anotarAlucinacion(id, diagnostico);

  if (diagnostico.esSospechosa) {
    console.warn(
      `[LiveDub] ⚠ frase #${id} SOSPECHOSA DE ALUCINACIÓN: ${diagnostico.motivos.join(' ')} ` +
        (toparAlucinacionesActivo
          ? 'Se va a recortar (tope activado).'
          : 'NO se recorta: el tope está apagado. Actívalo con livedub.toparAlucinaciones(true).')
    );

    if (toparAlucinacionesActivo) {
      const saneado = sanearTrozos(trozosOriginales, { segundosAudio });
      const antes = texto;
      const despues = saneado.trozos.join(' ');

      // SE MIDE EN CARACTERES, NO EN ORACIONES.
      //
      // La tanda de 64 frases enseñó por qué: cuatro cortes aparecían como
      // "3 → 3", "1 → 1"… y aun así contaban como pérdida. Conservar el
      // número de oraciones NO significa conservar el contenido: la
      // desduplicación interna quita palabras DENTRO de una oración y el
      // recuento de oraciones no se entera. El carácter sí.
      const quitadosCaracteres = antes.length - despues.length;
      const quitadasOraciones = trozosOriginales.length - saneado.trozos.length;
      const huboCambio = quitadosCaracteres > 0 || quitadasOraciones > 0;

      texto = despues;

      cortes.push({
        '#': id,
        'audio (s)': segundosAudio,
        qué: huboCambio
          ? saneado.seCorto
            ? 'texto recortado parcialmente'
            : 'alucinación eliminada'
          : 'sospechosa CONSERVADA ÍNTEGRA',
        motivos: diagnostico.motivos.join(' '),
        oraciones: `${trozosOriginales.length} → ${saneado.trozos.length}`,
        // La columna que faltaba. Sin ella, "3 → 3" parecía decir "no se
        // tocó nada" cuando podía haberse quitado media oración.
        caracteres: `${antes.length} → ${despues.length}`,
        'caracteres quitados': quitadosCaracteres,
        'voz estimada antes (s)': diagnostico.segundosHablaEstimados,
        'voz estimada después (s)': Number(((despues.length * 1.11) / 17.2).toFixed(1)),
        '¿pudo perder algo real?': !huboCambio
          ? 'no (no se tocó nada)'
          : saneado.seCorto
            ? 'SÍ — revisar'
            : 'no (sólo repeticiones)',
        ANTES: antes,
        DESPUES: despues
      });
      while (cortes.length > MAX_CORTES_GUARDADOS) cortes.shift();

      // SÓLO SE CUENTA COMO PÉRDIDA SI DE VERDAD SE QUITÓ ALGO.
      //
      // Error de contabilidad del 8-oct: bastaba con que la frase fuera
      // SOSPECHOSA para apuntarle una pérdida, aunque el saneado no le
      // tocara ni un carácter. Eso infló el recuento con cuatro frases
      // (#31, #33, #51, #59) que salieron enteras por el altavoz.
      if (huboCambio) {
        registrarPerdida({
          id,
          segundos: null,
          etapa: saneado.seCorto ? 'alucinación (cortada por tope)' : 'alucinación (repeticiones)',
          detalle:
            `${quitadosCaracteres} caracteres y ${quitadasOraciones} oraciones de ` +
            `${trozosOriginales.length} descartadas ` +
            `(${saneado.quitadosPorRepeticion} oraciones por repetición, ` +
            `${saneado.quitadosPorRepeticionInterna} palabras por repetición interna, ` +
            `${saneado.quitadosPorTope} por tope de cantidad, ` +
            `${saneado.quitadosPorDuracion} por tope de duración).`,
          cerrarFrase: false
        });
      } else {
        console.log(
          `[LiveDub] frase #${id}: sospechosa, pero el saneado no le ha quitado nada. ` +
            'Sale entera. NO cuenta como pérdida.'
        );
      }
    }
  }

  const decision = decidirTraduccion(texto);
  // Se anota si siquiera se INTENTÓ traducir. Sin esto, "0 ms de traducción"
  // es ambiguo: puede significar que el traductor falló al instante o que ni
  // se le llamó, y son dos problemas distintos.
  cronometro.marcar(id, 'tDecision', {
    seIntentoTraducir: decision.traducir,
    motivoNoTraducir: decision.traducir ? null : decision.aviso
  });

  let traduccion = '';
  let duracionTraduccionMs = 0;
  let aviso = decision.aviso;
  // Motivo CRUDO del traductor ('tiempo agotado', 'descartada por cola llena',
  // …). Se guarda aparte del aviso de UI porque es el que va al contador de
  // pérdidas, y ahí interesa la causa exacta, no el texto bonito.
  let motivoTraduccion = null;

  if (decision.traducir) {
    const estadoTraductor = traductor?.obtenerEstado();
    const resultado = await (traductor?.traducir(texto) ??
      Promise.resolve({ traduccion: '', motivo: 'traductor no iniciado' }));

    traduccion = resultado.traduccion || '';
    duracionTraduccionMs = resultado.duracionMs || 0;
    cronometro.anotarGrupos(id, resultado.grupos);

    // PARCIAL: el worker agotó su presupuesto y devolvió lo que llevaba.
    // Suena lo traducido, pero el resto de la frase no se dobla, así que se
    // avisa y se cuenta. La regla del proyecto es que no hay continuidad a
    // base de omitir contenido en silencio.
    if (resultado.parcial && traduccion) {
      const faltan = (resultado.trozos ?? 0) - (resultado.trozosTraducidos ?? 0);
      aviso = `Frase doblada a medias: faltan ${faltan} de ${resultado.trozos} oraciones.`;
      registrarPerdida({
        id,
        segundos:
          typeof duracionMs === 'number' && resultado.trozos
            ? Number(((duracionMs / 1000) * (faltan / resultado.trozos)).toFixed(2))
            : null,
        etapa: 'traducción (parcial)',
        detalle: `${resultado.trozosTraducidos} de ${resultado.trozos} oraciones traducidas`,
        // La parte traducida SÍ se dobla: la frase sigue viva y midiéndose.
        cerrarFrase: false
      });
    }

    if (!traduccion) {
      motivoTraduccion = resultado.motivo || resultado.error || estadoTraductor || 'desconocido';
      // Degradación independiente: sin traducción, pero el subtítulo se publica.
      aviso = `Traducción no disponible (${resultado.motivo || estadoTraductor || 'desconocido'}).`;
    }
  }

  // La traducción ha terminado (o no hacía falta).
  cronometro.marcar(id, 'tFinMt', { traduccion });

  // Fase 5: el doblaje se lanza SIN esperar (no bloquea la publicación del
  // subtítulo). El texto aparece en pantalla cuanto antes y la voz llega
  // después; es justo el desfase que documentamos.
  // RECORTE (opción A). Se aplica después de traducir y antes de hablar.
  // El subtítulo enseña el MISMO texto que se pronuncia: si la voz dice una
  // cosa y el subtítulo otra, el espectador no sabe a cuál creer.
  //
  // EL ESTADO DEL INTERRUPTOR SE ANOTA SIEMPRE, encendido o apagado, y antes
  // de hacer nada con él. Ya hubo dos tandas que se perdieron porque no
  // constaba si el recorte estaba activo: la medición no puede depender de
  // que alguien recuerde qué comando escribió y en qué orden.
  cronometro.anotarRecorte(id, { activo: recorteActivo, reduccion: null });

  if (recorteActivo && traduccion) {
    const recorte = recortar(traduccion, { objetivo: recorteObjetivo });
    if (recorte.texto && recorte.texto !== traduccion) {
      cronometro.anotarRecorte(id, {
        activo: true,
        reduccion: recorte.reduccion,
        sinRecortar: traduccion,
        hablada: recorte.texto
      });
      traduccion = recorte.texto;
    } else {
      // Encendido pero sin nada que recortar en esta frase: 0 %, no "no se
      // aplicó". Son cosas distintas y la tabla tiene que distinguirlas.
      cronometro.anotarRecorte(id, { activo: true, reduccion: 0 });
    }
  }

  if (doblajeActivo && traduccion) {
    doblar(traduccion, duracionesOrigen.shift() ?? null, id);
  } else if (!doblajeActivo) {
    // El usuario apagó el doblaje. NO es pérdida: es una decisión suya, y
    // meterla en el contador inflaría el porcentaje con algo que no es un fallo.
    cronometro.abandonar(id, 'doblaje apagado');
  } else {
    // PÉRDIDA REAL (corregido el 8-oct-2026).
    //
    // Hasta ahora esto era un abandonar(): la frase salía en la tabla con su
    // motivo, pero NO entraba en perdidas(), que sólo contaba los descartes de
    // la cola de voz. El recuento daba 4 cuando en realidad eran 6, y el
    // porcentaje salía bajo por omisión.
    //
    // Para el espectador no hay ninguna diferencia entre "la cola de voz la
    // tiró" y "el traductor agotó los 30 s": en los dos casos ese tramo del
    // vídeo pasa sin doblar. Si cuenta como pérdida una, cuentan las dos.
    //
    // Se separan por etapa para poder atacarlas por separado, no para
    // disimular ninguna.
    registrarPerdida({
      id,
      segundos: typeof duracionMs === 'number' ? Number((duracionMs / 1000).toFixed(2)) : null,
      etapa: decision.traducir ? 'traducción' : 'detector de idioma',
      detalle: decision.traducir
        ? motivoTraduccion || 'motivo desconocido'
        : decision.aviso || 'no se intentó traducir'
    });
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

/**
 * PÉRDIDA DE CONTENIDO. Un sitio único por el que pasa todo lo que el
 * usuario no va a llegar a oír doblado.
 *
 * Esto NO es un retraso: es audio del vídeo que se tira. La regla del
 * proyecto es que nunca haya fallo silencioso, así que además de contarlo
 * se avisa al popup. Antes, el descarte de la cola de Whisper no dejaba
 * rastro en ningún sitio.
 */
function registrarPerdida({ id = null, segundos = null, etapa, detalle = '', cerrarFrase = true }) {
  cronometro.anotarPerdida({ id, segundos, etapa, detalle, cerrarFrase });
  const total = cronometro.perdidas();

  console.warn(
    `[LiveDub] ⚠ CONTENIDO PERDIDO en ${etapa}` +
      (segundos ? ` (${segundos} s de vídeo)` : '') +
      `. Van ${total} en esta sesión. Detalle con livedub.perdidas()`
  );

  publicarEstadoModelo(
    {
      estado: ESTADO_MODELO_UI.ERROR,
      detalle:
        `Se han perdido ${total} frase(s) sin doblar: el doblaje no da abasto. ` +
        'Mira livedub.perdidas() en la consola.'
    },
    MODULO.SINTESIS
  );
}

// Pide la voz al motor activo. El ducking lo hace el propio motor.
async function doblar(textoEspanol, segundosOrigen = null, idFrase = null) {
  const resultado = await (motorVoz?.doblar(textoEspanol, {
    segundosOrigen,
    // Se avisa en cuanto EMPIEZA a sonar, no cuando termina: el desfase que
    // percibe el usuario es cuándo oye la voz, no cuándo deja de oírla.
    onEmpiezaAHablar: () => cronometro.marcar(idFrase, 'tInicioVoz')
  }) ?? Promise.resolve({ hablado: false, motivo: 'voz no iniciada' }));

  // Nunca en silencio: si no hay voz, se dice por qué.
  if (!resultado.hablado) {
    console.warn(`[LiveDub] Sin doblaje para esta frase (${resultado.motivo || 'motivo desconocido'}).`);
    // Un descarte por cola llena es PÉRDIDA DE CONTENIDO, no un simple
    // "no sonó": esa frase ya no se va a recuperar nunca.
    if (resultado.descartada) {
      registrarPerdida({
        id: idFrase,
        segundos: segundosOrigen,
        etapa: 'cola de voz',
        detalle: 'el doblaje iba tan retrasado que se tiró la frase más antigua'
      });
    } else {
      cronometro.abandonar(idFrase, resultado.motivo || 'no sonó');
    }
    return;
  }

  cronometro.marcar(idFrase, 'tFinVoz');
  cronometro.cerrar(idFrase);
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

  // Fase 5: cortar el doblaje ANTES de desmontar la cadena de audio, para no
  // dejar el volumen original agachado.
  motorVoz?.parar();
  motorVoz?.destruir();
  motorVoz = null;

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

    case MSG.SETTINGS_CHANGED:
      aplicarIdiomas(mensaje.idiomas);
      if (mensaje.doblaje !== undefined) aplicarDoblaje(mensaje.doblaje);
      return false;

    case MSG.SET_DOBLAJE:
      aplicarDoblaje(mensaje.activo);
      responder({ ok: true, activo: doblajeActivo });
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
    sintetizador: motorVoz?.obtenerEstado() ?? 'inactivo',
    motorVoz: motorVoz?.motorActivo() ?? 'ninguno',
    doblajeActivo,
    doblandoAhora: motorVoz?.estaHablando() ?? false,
    frasesDescartadas,
    idiomaOrigen
  }),
  // Diagnóstico del doblaje: dice en una línea legible si el interruptor
  // llegó, si el worker existe y en qué estado está. Uso: livedub.doblaje()
  doblaje: () => {
    if (!motorVoz) {
      console.log('[LiveDub] No hay motor de voz: inicia la captura.');
      return null;
    }
    const info = {
      'interruptor recibido por el offscreen': doblajeActivo ? 'SÍ (activado)' : 'no (desactivado)',
      ...motorVoz.informe()
    };
    console.table(info);
    return info;
  },

  // Qué voces del sistema ve la extensión y cuáles descarta por ser de red.
  // Uso: livedub.voces()
  voces: () => {
    const vs = motorVoz?.vozSistema();
    if (!vs) {
      console.log(
        '[LiveDub] El motor de la voz del sistema no está activo ' +
          '(o se cayó a la reserva MMS-TTS). Inicia la captura y activa el doblaje.'
      );
      return [];
    }
    const lista = vs.inventario().map((v) => ({
      nombre: v.nombre,
      idioma: v.idioma,
      '¿se puede usar?': v.local ? 'SÍ (local)' : 'no — es de red, enviaría el texto fuera'
    }));
    console.table(lista);
    return lista;
  },

  // Fuerza un motor concreto para comparar. Uso:
  //   livedub.setMotorVoz('mms')      → motor de reserva
  //   livedub.setMotorVoz('sistema')  → voz de Windows
  // Hay que apagar y encender el doblaje (o Detener/Iniciar) para que aplique.
  setMotorVoz: (cual) => {
    const valido = [MOTOR_VOZ.SISTEMA, MOTOR_VOZ.MMS];
    if (!valido.includes(cual)) {
      console.warn(`[LiveDub] Motor no reconocido. Usa uno de: ${valido.join(', ')}`);
      return motorVozPedido;
    }
    motorVozPedido = cual;
    console.log(
      `[LiveDub] Motor de voz pedido: ${cual}. ` +
        'Apaga y enciende el interruptor de doblaje para que tome efecto.'
    );
    return motorVozPedido;
  },
  motorVoz: () => motorVoz?.motorActivo() ?? 'ninguno',

  // Fase 5.1. Informe de rendimiento de la voz: la tabla que antes había que
  // reconstruir a mano a partir de decenas de líneas de log. Uso:
  //   livedub.rendimiento()
  rendimiento: () => {
    if (!motorVoz) {
      console.log('[LiveDub] No hay motor de voz: inicia la captura y activa el doblaje.');
      return null;
    }

    // Con la voz del sistema no hay "coste de síntesis" que medir: la genera
    // Windows fuera de nuestro proceso. Lo que sí interesa es a qué ritmo
    // habla y cuánto esperan las frases en la cola.
    const vs = motorVoz.vozSistema();
    if (vs) {
      const r = vs.rendimiento();
      if (!r.muestras) {
        console.log('[LiveDub] Todavía no se ha doblado ninguna frase.');
        return r;
      }
      console.table({
        'motor en uso': 'voz del sistema (speechSynthesis)',
        'voz': r.voz,
        'frases medidas': r.muestras,
        'caracteres por segundo': r.caracteresPorSegundo,
        'espera en cola (mediana)': `${r.esperaEnColaMs} ms`,
        'coste de CPU de la síntesis': 'ninguno: lo hace Windows'
      });
      return r;
    }

    const sintetizador = motorVoz.sintetizador();
    if (!sintetizador) {
      console.log('[LiveDub] El motor de reserva no está activo.');
      return null;
    }
    const info = sintetizador.rendimiento();
    console.table({
      'motor en uso': info.motor,
      'velocidad de reproducción': `x${info.velocidadReproduccion}`,
      'frases medidas': info.muestras,
      'ms por segundo de audio': info.msPorSegundoAudio ?? '(sin datos)',
      'veces tiempo real': info.vecesTiempoReal ?? '(sin datos)',
      'el doblaje dura x veces el original': info.expansionMedia ?? '(sin datos)',
      'descartadas sin intentarlas': info.descartadasSinIntentar,
      'descartadas por retraso': info.descartadasPorTiempo,
      veredicto: info.veredicto
    });
    console.log(sintetizador.explicacionRendimiento());
    return info;
  },

  // Detalle frase a frase, por si hace falta pegar los números crudos.
  rendimientoDetalle: () => {
    const filas = motorVoz?.sintetizador()?.detalleRendimiento() ?? [];
    console.table(filas);
    return filas;
  },

  // Cambia la velocidad del doblaje en caliente para juzgarla de oído.
  setVelocidadVoz: (v) => {
    const nueva = fijarVelocidadDoblaje(v);
    console.log(`[LiveDub] Velocidad del doblaje: x${nueva} (afecta a la próxima frase).`);
    return nueva;
  },
  velocidadVoz: () => obtenerVelocidadDoblaje(),

  // Borra las mediciones y reactiva el doblaje si se había apagado solo.
  reintentarVoz: () => motorVoz?.sintetizador()?.reintentar() ?? null,

  // ─── PASO 0: ¿de dónde salen los segundos de desfase? ───────────────
  // Tabla frase a frase con las marcas de tiempo reales. Uso:
  //   livedub.latencia()
  latencia: () => {
    const filas = cronometro.filas();
    if (!filas.length) {
      console.log(
        '[LiveDub] Todavía no hay frases medidas. Deja correr el vídeo un par ' +
          'de minutos con el doblaje ACTIVADO y vuelve a ejecutarlo.'
      );
      return null;
    }
    console.table(filas);
    console.log('\n── RESUMEN ──');
    console.table(cronometro.resumen());
    console.log('\n' + cronometro.explicacion());
    return { filas, resumen: cronometro.resumen() };
  },

  // Texto plano para pegar en el chat sin perder el formato de la tabla.
  latenciaTexto: () => {
    const filas = cronometro.filas();
    if (!filas.length) return 'Sin datos todavía.';
    const cols = Object.keys(filas[0]);
    const lineas = [cols.join(' | '), cols.map(() => '---').join(' | ')];
    for (const f of filas) lineas.push(cols.map((c) => String(f[c] ?? '')).join(' | '));
    const texto = lineas.join('\n') + '\n\n' + cronometro.explicacion();
    console.log(texto);
    return texto;
  },

  // Qué contenido se ha perdido y dónde. Uso: livedub.perdidas()
  /**
   * ¿Se degrada el sistema con el tiempo? Parte la sesión en tres tercios y
   * compara. Uso: livedub.deriva()
   */
  deriva: () => {
    const d = cronometro.deriva();
    console.log(d['¿se degrada con el tiempo?'] ?? d['¿se puede responder?']);
    if (d.tramos) console.table(d.tramos);
    return d;
  },

  /**
   * Separa el coste de Whisper en parte fija (encoder) y parte proporcional
   * al texto (decoder), ajustando una recta sobre las frases de la sesión.
   * Uso: livedub.costeWhisper()
   */
  costeWhisper: () => {
    const r = cronometro.costeWhisper();
    console.table(r);
    return r;
  },

  perdidas: () => {
    const r = cronometro.resumenPerdidas();
    if (!r['frases perdidas']) {
      console.log('[LiveDub] ✔ No se ha perdido ninguna frase en esta sesión.');
      return r;
    }
    console.warn(
      `[LiveDub] ⚠ ${r['frases perdidas']} frases perdidas ` +
        `(~${r['segundos de vídeo sin doblar']} s de vídeo sin doblar).`
    );
    console.table(r['por etapa']);
    console.log(`Eso es el ${r['porcentaje del total']} de las frases procesadas.`);
    console.table(r.detalle);

    // VERIFICACIÓN CRUZADA: ¿cuadra el contador con los huecos de la
    // numeración? Si no cuadra, el propio contador no es de fiar y hay que
    // decirlo antes de sacar conclusiones de él.
    const cruce = cronometro.verificacionCruzada();
    console.log('\n── ¿Es fiable este recuento? ──');
    console.table(cruce);
    if (!/^SÍ/.test(cruce['¿cuadra el contador?'])) {
      console.error(
        '[LiveDub] ⚠ El contador NO cuadra: hay frases que desaparecieron por una ' +
          'vía que no está instrumentada. Las cifras de arriba son un MÍNIMO, no el total.'
      );
    }
    return { ...r, verificacionCruzada: cruce };
  },

  /**
   * Tope de alucinaciones. Sin argumento, sólo informa.
   * Uso: livedub.toparAlucinaciones()  ·  livedub.toparAlucinaciones(true)
   */
  toparAlucinaciones: (encendido) => {
    if (encendido === undefined) {
      return {
        activo: toparAlucinacionesActivo,
        'tope de oraciones por frase': TROZOS_MAXIMOS,
        'qué hace': 'quita repeticiones seguidas de más de 3 y corta a 15 oraciones',
        'cómo encenderlo': 'livedub.toparAlucinaciones(true)'
      };
    }
    toparAlucinacionesActivo = Boolean(encendido);
    console.log(
      `[LiveDub] tope de alucinaciones ${toparAlucinacionesActivo ? 'ENCENDIDO' : 'APAGADO'}.`
    );
    return toparAlucinacionesActivo;
  },

  /**
   * TANDA DE CONFIRMACIÓN (docs/TANDA-CONFIRMACION.md).
   *
   * Un solo comando que saca los cuatro informes EN EL ORDEN CORRECTO, que
   * no es un detalle: los cortes se miran ANTES que cualquier porcentaje,
   * porque una tanda con muchos cortes puede enseñar una pérdida alta y aun
   * así ser mejor que antes si lo perdido era basura.
   *
   * Uso: livedub.informeTanda()
   */
  informeTanda: () => {
    const sep = (t) => console.log(`\n${'═'.repeat(62)}\n  ${t}\n${'═'.repeat(62)}`);

    sep('1 · CORTES DEL DETECTOR — esto primero, antes que ningún %');
    const losCortes = globalThis.livedub.cortes();
    const revisar = losCortes.filter((c) => c.qué === 'texto recortado parcialmente');
    if (revisar.length) {
      console.warn(
        `[LiveDub] ⚠ ${revisar.length} corte(s) PUDIERON tirar algo real. ` +
          'Hay que LEERLOS, no basta con contarlos:'
      );
      for (const c of revisar) {
        console.log(`\n--- #${c['#']} (${c.motivos}) ---\nANTES:   ${c.ANTES}\nDESPUÉS: ${c.DESPUES}`);
      }
      console.warn(
        'Si en alguno de esos ANTES hay habla de verdad, es un FALSO POSITIVO: ' +
          'livedub.toparAlucinaciones(false) y avisa. No se deja encendido a ver si cuela.'
      );
    } else if (losCortes.length) {
      console.log(
        '[LiveDub] ✔ ninguna frase se recortó parcialmente: lo que se quitó eran ' +
          'repeticiones idénticas, y las sospechosas sin cambios salieron enteras.'
      );
    }

    sep('2 · ¿EVENTOS CATASTRÓFICOS? — el criterio de "resuelto"');
    const eventos = cronometro.eventosCatastroficos();
    console.log(eventos['¿tanda limpia?']);
    if (eventos.sucesos.length) console.table(eventos.sucesos);

    sep('3 · PÉRDIDAS');
    const perdidas = globalThis.livedub.perdidas();

    sep('4 · ¿SE DEGRADA CON EL TIEMPO? — se espera x1,0-1,1');
    const laDeriva = globalThis.livedub.deriva();

    sep('5 · TABLA POR FRASE');
    globalThis.livedub.latenciaTexto();

    sep('VEREDICTO PROVISIONAL (la lectura a mano manda sobre esto)');
    const limpia = /^SÍ/.test(eventos['¿tanda limpia?']);
    if (!eventos['frases en la tanda']) {
      console.warn('No hay frases: la tanda no mide nada.');
    } else if (revisar.length) {
      console.warn(
        `PENDIENTE DE TU LECTURA. ${revisar.length} corte(s) marcados "SÍ — revisar" ` +
          'arriba. Hasta que los leas, esta tanda no valida la activación del detector.'
      );
    } else if (limpia) {
      console.log(
        '✔ Tanda limpia y sin cortes dudosos. Si la segunda tanda sale igual, ' +
          'queda validada la activación del detector y resuelto el bloqueo del traductor.'
      );
    } else {
      console.warn('✘ Hubo eventos catastróficos: esta tanda NO valida nada. Pega la tabla del punto 2.');
    }

    return { cortes: losCortes, eventos, perdidas, deriva: laDeriva };
  },

  /**
   * Los textos que el tope de alucinaciones ha recortado, con el antes y el
   * después enteros. Para revisarlos A MANO, que es la única forma de saber
   * si eran alucinaciones de verdad. Uso: livedub.cortes()
   */
  cortes: () => {
    if (!cortes.length) {
      console.log('[LiveDub] el detector no ha intervenido en ninguna frase de esta sesión.');
      return [];
    }
    console.table(cortes.map(({ ANTES, DESPUES, ...resto }) => resto));

    // CUATRO CATEGORÍAS SEPARADAS, no un número único.
    //
    // "5 cortes" mezclaba cosas que no se parecen en nada: una alucinación
    // de 90 oraciones eliminada y una frase sospechosa que salió entera. Y
    // el porcentaje de pérdida las sumaba todas, lo que hacía que el
    // sistema pareciera peor de lo que es Y escondía lo que importa.
    const eliminadas = cortes.filter((c) => c.qué === 'alucinación eliminada');
    const recortadas = cortes.filter((c) => c.qué === 'texto recortado parcialmente');
    const intactas = cortes.filter((c) => c.qué === 'sospechosa CONSERVADA ÍNTEGRA');
    const sumar = (lista) => lista.reduce((n, c) => n + c['caracteres quitados'], 0);

    console.log('\n── Qué se ha quitado, por tipo ──');
    console.table([
      {
        tipo: '1 · alucinación eliminada (repeticiones idénticas)',
        frases: eliminadas.length,
        'caracteres quitados': sumar(eliminadas),
        '¿puede ser contenido real?': 'NO — lo quitado es idéntico a lo que queda'
      },
      {
        tipo: '2 · texto recortado parcialmente (tope de cantidad o duración)',
        frases: recortadas.length,
        'caracteres quitados': sumar(recortadas),
        '¿puede ser contenido real?': 'SÍ — hay que leerlo'
      },
      {
        tipo: '3 · sospechosa conservada íntegra',
        frases: intactas.length,
        'caracteres quitados': 0,
        '¿puede ser contenido real?': 'no se tocó; NO cuenta como pérdida'
      },
      {
        tipo: '4 · contenido legítimo perdido (confirmado a mano)',
        frases: '—',
        'caracteres quitados': '—',
        '¿puede ser contenido real?': 'lo rellenas tú al revisar el tipo 2'
      }
    ]);

    console.log(
      `\n[LiveDub] ${cortes.length} frase(s) tocadas por el detector: ` +
        `${eliminadas.length} alucinación eliminada, ${recortadas.length} recortada parcialmente, ` +
        `${intactas.length} conservada íntegra.\n` +
        'SÓLO las del tipo 2 pueden haber perdido habla. Los textos completos están en el ' +
        'array devuelto (campos ANTES y DESPUES). La fila 4 no la puede rellenar el programa: ' +
        'sólo se sabe leyendo.'
    );
    return cortes;
  },

  /**
   * Tope de ocupación del altavoz: corta una frase que lleva demasiado
   * tiempo hablando SI hay otras esperando. Por defecto apagado.
   * Uso: livedub.toparVozLarga(true)
   */
  toparVozLarga: (encendido) => {
    const vozSistema = motorVoz?.vozSistema();
    if (!vozSistema?.fijarTopeVozLarga) {
      console.warn('[LiveDub] la voz del sistema no está iniciada.');
      return null;
    }
    if (encendido === undefined) {
      return {
        activo: vozSistema.topeVozLargaActivo(),
        'se corta a partir de': `${VOZ_SISTEMA.TOPE_OCUPACION}x la duración del audio`,
        'nunca antes de': `${VOZ_SISTEMA.TOPE_OCUPACION_MINIMO_MS / 1000} s`,
        'sólo si hay alguien esperando': true,
        'cómo encenderlo': 'livedub.toparVozLarga(true)'
      };
    }
    const activo = vozSistema.fijarTopeVozLarga(encendido);
    console.log(`[LiveDub] tope de voz larga ${activo ? 'ENCENDIDO' : 'APAGADO'}.`);
    return activo;
  },

  /* ---------------- Recorte de traducciones (opción A) -------------- */

  // Enciende o apaga el recorte en caliente. Sin argumento, sólo informa.
  // Uso: livedub.recorte()  ·  livedub.recorte(true)  ·  livedub.recorte(false)
  recorte: (encendido) => {
    if (encendido === undefined) {
      return {
        activo: recorteActivo,
        'objetivo de reducción': `${Math.round(recorteObjetivo * 100)} %`,
        'cómo encenderlo': 'livedub.recorte(true)',
        'cómo apagarlo': 'livedub.recorte(false)',
        'ver ejemplos antes de decidir': 'livedub.recorteEjemplos()'
      };
    }
    recorteActivo = Boolean(encendido);
    console.log(
      `[LiveDub] recorte de traducciones ${recorteActivo ? 'ENCENDIDO' : 'APAGADO'}. ` +
        'Afecta sólo a las frases siguientes; no hay que recargar nada.'
    );
    return recorteActivo;
  },

  // Cambia cuánto se recorta (0.10 - 0.15 es la horquilla acordada).
  recorteObjetivo: (fraccion) => {
    if (fraccion === undefined) return recorteObjetivo;
    const v = Number(fraccion);
    if (!(v > 0 && v < 0.5)) return 'Dame una fracción entre 0 y 0.5 (por ejemplo 0.12).';
    recorteObjetivo = v;
    return `Objetivo de recorte: ${Math.round(v * 100)} %`;
  },

  /**
   * ANTES/DESPUÉS con las frases REALES de esta sesión.
   *
   * No inventa ejemplos: usa las traducciones que el cronómetro tiene
   * guardadas de las frases ya dobladas. Si no hay bastantes, lo dice en vez
   * de rellenar con frases de muestra.
   *
   * Uso: livedub.recorteEjemplos()  ·  livedub.recorteEjemplos(10)
   */
  recorteEjemplos: (cuantas = 10) => {
    const textos = cronometro.textosTraducidos().slice(-cuantas);
    if (textos.length === 0) {
      console.warn(
        '[LiveDub] Todavía no hay traducciones en esta sesión. Deja correr el vídeo ' +
          'un par de minutos y vuelve a pedirlo.'
      );
      return null;
    }
    if (textos.length < cuantas) {
      console.warn(
        `[LiveDub] Sólo hay ${textos.length} frases traducidas, no ${cuantas}. ` +
          'La muestra es corta: déjalo correr más para juzgar mejor.'
      );
    }

    const lote = recortarLote(textos, { objetivo: recorteObjetivo });
    const tabla = lote.filas.map((f, i) => ({
      '#': i + 1,
      ANTES: f.original,
      DESPUÉS: f.texto,
      '−%': `${(f.reduccion * 100).toFixed(1)} %`,
      's ahorrados': f.segundosAhorrados,
      'reglas usadas': f.reglas.join(' · ') || '(ninguna)'
    }));
    console.table(tabla);
    console.log(
      `Reducción media: ${(lote.reduccionMedia * 100).toFixed(1)} % · ` +
        `${lote.segundosAhorrados} s ahorrados en ${textos.length} frases · ` +
        `${lote.frasesSinTocar} frases no se tocaron.`
    );
    console.log(
      'Lee los DESPUÉS en voz alta. Si alguno suena mal o pierde algo, dímelo y ' +
        'quito esa regla; el recorte sigue APAGADO hasta que digas que sí.'
    );
    return { tabla, resumen: lote };
  },

  /**
   * ¿CUÁNTO APORTA EL RECORTE? Compara las frases marcadas "on" contra las
   * marcadas "off" de esta misma sesión. Uso: livedub.comparar()
   */
  comparar: () => {
    const r = cronometro.compararRecorte();
    console.log('\n── ¿Cuánto aporta el recorte? ──');
    console.table({
      'con recorte (on)': r['con recorte (on)'],
      'sin recorte (off)': r['sin recorte (off)']
    });
    if (r['frases sin marcar (medidas antes de existir la columna)']) {
      console.warn(
        `[LiveDub] ${r['frases sin marcar (medidas antes de existir la columna)']} frases ` +
          'no llevan marca de recorte. Son de antes de que existiera la columna y ' +
          'quedan fuera de la comparación.'
      );
    }
    console.log(`VEREDICTO: ${r.veredicto}`);
    console.log(
      'La cifra que manda es la PROPORCIÓN ES/EN. Por encima de 1, cada frase deja ' +
        'menos hueco a la siguiente y la pérdida es inevitable, calcule el equipo lo ' +
        'rápido que calcule.'
    );
    return r;
  },

  /**
   * LA COMPARACIÓN LIMPIA: qué habría pasado CON y SIN recorte sobre las
   * MISMAS frases de esta sesión. Uso: livedub.simularRecorte()
   *
   * Es la única forma de comparar sin que el contenido del vídeo contamine
   * el resultado, porque las dos columnas salen de las mismas frases.
   */
  simularRecorte: () => {
    const r = cronometro.simularRecorte((t) => recortar(t, { objetivo: recorteObjetivo }));
    console.log('\n── CON recorte vs SIN recorte, sobre las MISMAS frases ──');
    console.table(r);
    console.log(`VEREDICTO: ${r.veredicto}`);
    console.log(
      'Limitación: la duración de cada variante se estima con el ritmo real de ESA ' +
        'frase (ms por carácter), suponiendo que el habla es proporcional a los ' +
        'caracteres. Da la MAGNITUD del efecto; la confirmación con audio real sigue ' +
        'haciendo falta.'
    );
    return r;
  },

  // El límite teórico: qué pasaría si Whisper y la traducción fueran
  // instantáneos. Uso: livedub.limiteTeorico()
  limiteTeorico: () => {
    const texto = cronometro.veredictoLimiteTeorico();
    console.log(texto);
    return texto;
  },

  // Borra las mediciones para empezar una tanda limpia.
  latenciaReiniciar: () => {
    cronometro.reiniciar();
    return 'Mediciones borradas. Deja correr el vídeo otra vez.';
  },

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
