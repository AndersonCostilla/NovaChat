// traductor-worker.js
// Worker dedicado para la TRADUCCIÓN (inglés → español), separado a propósito
// del worker de Whisper: así traducir una frase nunca bloquea la transcripción
// de la siguiente, y si un modelo falla el otro sigue vivo.
//
// Responsabilidad única: cargar una vez el pipeline de traducción
// (OPUS-MT en→es, ONNX cuantizado, 100 % local) y traducir los textos que le
// manden desde traductor.js.
//
// IMPORTANTE: cero peticiones a internet. Las rutas del modelo y de los
// binarios WASM llegan en el mensaje INIT como URLs chrome-extension://.

import { pipeline, env } from './libs/transformers/transformers.min.js';

const ENTRADA = { INIT: 'INIT', TRADUCIR: 'TRADUCIR' };
const SALIDA = {
  PROGRESO: 'PROGRESO',
  LISTO: 'LISTO',
  RESULTADO: 'RESULTADO',
  ERROR: 'ERROR'
};

let traductor = null; // pipeline cacheado: se carga una sola vez
let cargando = null;
let idModelo = 'opus-mt-en-es';

/* ------------------------------------------------------------------ */
/* Configuración del entorno: todo local, nada de red                  */
/* ------------------------------------------------------------------ */

function configurarEntorno({ rutaModelos, rutaWasm }) {
  env.allowRemoteModels = false; // jamás descargar un modelo
  env.allowLocalModels = true;
  env.localModelPath = rutaModelos; // chrome-extension://<id>/models/
  env.useBrowserCache = false;

  const wasm = env.backends.onnx.wasm;
  wasm.wasmPaths = rutaWasm; // chrome-extension://<id>/libs/transformers/
  wasm.numThreads = 1;
  wasm.proxy = false;

  // Mismo silenciado de ruido que en el worker de Whisper.
  try {
    if (env.backends.onnx.env) env.backends.onnx.env.logLevel = 'error';
  } catch (_) {
    /* API interna de onnxruntime-web: si cambia, sólo habrá más ruido */
  }
}

/* ------------------------------------------------------------------ */
/* Carga del modelo                                                    */
/* ------------------------------------------------------------------ */

async function cargarModelo() {
  if (traductor) return traductor;
  if (cargando) return cargando;

  // OPUS-MT es un modelo Marian: el par de idiomas va en el propio modelo,
  // por eso no hay que pasar src_lang/tgt_lang al traducir.
  cargando = pipeline('translation', idModelo, {
    quantized: true,
    progress_callback: (info) => {
      self.postMessage({
        type: SALIDA.PROGRESO,
        estado: info?.status ?? '',
        archivo: info?.file ?? '',
        porcentaje: typeof info?.progress === 'number' ? Math.round(info.progress) : null
      });
    }
  })
    .then((p) => {
      traductor = p;
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
/* Traducción de un texto                                              */
/* ------------------------------------------------------------------ */

async function traducir({ id, texto }) {
  const inicio = performance.now();
  const modelo = await cargarModelo();

  const salida = await modelo(texto, {
    max_new_tokens: 256 // suficiente para una frase; evita generaciones eternas
  });

  // El pipeline devuelve [{ translation_text: '...' }]
  const traduccion = (Array.isArray(salida) ? salida[0]?.translation_text : salida?.translation_text) || '';

  self.postMessage({
    type: SALIDA.RESULTADO,
    id,
    traduccion: traduccion.trim(),
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

      case ENTRADA.TRADUCIR:
        await traducir(mensaje);
        break;

      default:
        break;
    }
  } catch (error) {
    self.postMessage({
      type: SALIDA.ERROR,
      id: mensaje.id ?? null,
      fase: mensaje.type === ENTRADA.INIT ? 'carga' : 'traduccion',
      error: String(error?.message || error)
    });
  }
};

self.onerror = (evento) => {
  self.postMessage({
    type: SALIDA.ERROR,
    fase: 'worker',
    error: String(evento?.message || evento)
  });
};
