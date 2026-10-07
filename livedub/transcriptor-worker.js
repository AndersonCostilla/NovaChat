// transcriptor-worker.js
// Worker dedicado (type: 'module'). Aquí vive TODO el peso de la IA, para que el
// documento offscreen (que está manejando audio en tiempo real) no se bloquee.
//
// Responsabilidad única: cargar una vez el pipeline de reconocimiento de voz
// (Whisper, ONNX cuantizado, 100 % local) y transcribir los Float32Array que le
// manden desde transcriptor.js.
//
// IMPORTANTE: este worker NO hace ninguna petición a internet. Las rutas del
// modelo y de los binarios WASM llegan en el mensaje INIT como URLs
// chrome-extension:// construidas por el offscreen.

import { pipeline, env } from './libs/transformers/transformers.min.js';

// Nombres de mensaje del protocolo worker <-> transcriptor.js.
const ENTRADA = { INIT: 'INIT', TRANSCRIBIR: 'TRANSCRIBIR' };
const SALIDA = {
  PROGRESO: 'PROGRESO',
  LISTO: 'LISTO',
  RESULTADO: 'RESULTADO',
  ERROR: 'ERROR'
};

let transcriptor = null; // pipeline cacheado: se carga una sola vez
let cargando = null; // promesa de carga en curso
let idModelo = 'whisper-tiny';

/* ------------------------------------------------------------------ */
/* Configuración del entorno: todo local, nada de red                  */
/* ------------------------------------------------------------------ */

function configurarEntorno({ rutaModelos, rutaWasm }) {
  env.allowRemoteModels = false; // jamás descargar un modelo
  env.allowLocalModels = true;
  env.localModelPath = rutaModelos; // chrome-extension://<id>/models/
  env.useBrowserCache = false; // ya está en disco: la caché no aporta nada

  const wasm = env.backends.onnx.wasm;
  wasm.wasmPaths = rutaWasm; // chrome-extension://<id>/libs/transformers/
  wasm.numThreads = 1; // sin cross-origin isolation no hay hilos
  wasm.proxy = false; // ya estamos dentro de un worker

  // Bajamos el nivel de log de ONNX Runtime: por defecto escupe decenas de
  // avisos "CleanUnusedInitializersAndNodeArgs..." en cada carga, puro ruido
  // que se confunde con errores reales. Va en try/catch porque es una API
  // interna de onnxruntime-web y podría cambiar entre versiones.
  try {
    if (env.backends.onnx.env) env.backends.onnx.env.logLevel = 'error';
  } catch (_) {
    /* si no se puede, sólo tendremos consola más ruidosa */
  }
}

/* ------------------------------------------------------------------ */
/* Carga del modelo                                                    */
/* ------------------------------------------------------------------ */

async function cargarModelo() {
  if (transcriptor) return transcriptor;
  if (cargando) return cargando;

  cargando = pipeline('automatic-speech-recognition', idModelo, {
    quantized: true, // usamos los pesos int8
    progress_callback: (info) => {
      // info.status: 'initiate' | 'download' | 'progress' | 'done' | 'ready'
      self.postMessage({
        type: SALIDA.PROGRESO,
        estado: info?.status ?? '',
        archivo: info?.file ?? '',
        porcentaje: typeof info?.progress === 'number' ? Math.round(info.progress) : null
      });
    }
  })
    .then((p) => {
      transcriptor = p;
      cargando = null;
      return p;
    })
    .catch((error) => {
      cargando = null;
      throw error;
    });

  return cargando;
}

/* ------------------------------------------------------------------ */
/* Transcripción de una frase                                          */
/* ------------------------------------------------------------------ */

async function transcribir({ id, audio, idioma }) {
  const inicio = performance.now();
  const modelo = await cargarModelo();

  // 'auto' => no forzamos idioma y dejamos que Whisper lo detecte.
  const opciones = {
    chunk_length_s: 30, // Whisper trabaja en ventanas de 30 s
    return_timestamps: false,
    task: 'transcribe' // NUNCA 'translate': la traducción es de otra fase
  };
  if (idioma && idioma !== 'auto') opciones.language = idioma;

  const salida = await modelo(audio, opciones);
  const texto = (salida?.text ?? '').trim();

  self.postMessage({
    type: SALIDA.RESULTADO,
    id,
    texto,
    // transformers.js 2.x no expone el idioma que detectó internamente:
    // informamos el configurado ('auto' si lo dejamos detectar).
    idiomaDetectado: opciones.language ?? 'auto',
    duracionMs: Math.round(performance.now() - inicio)
  });
}

/* ------------------------------------------------------------------ */
/* Protocolo de mensajes                                               */
/* ------------------------------------------------------------------ */

self.onmessage = async (evento) => {
  const mensaje = evento.data || {};

  try {
    switch (mensaje.type) {
      case ENTRADA.INIT:
        if (mensaje.modelo) idModelo = mensaje.modelo;
        configurarEntorno(mensaje);
        await cargarModelo();
        self.postMessage({ type: SALIDA.LISTO, modelo: idModelo });
        break;

      case ENTRADA.TRANSCRIBIR:
        await transcribir(mensaje);
        break;

      default:
        break;
    }
  } catch (error) {
    self.postMessage({
      type: SALIDA.ERROR,
      id: mensaje.id ?? null,
      fase: mensaje.type === ENTRADA.INIT ? 'carga' : 'transcripcion',
      error: String(error?.message || error)
    });
  }
};

// Si algo revienta fuera del try (p. ej. al importar WASM), que se entere el padre.
self.onerror = (evento) => {
  self.postMessage({
    type: SALIDA.ERROR,
    fase: 'worker',
    error: String(evento?.message || evento)
  });
};
