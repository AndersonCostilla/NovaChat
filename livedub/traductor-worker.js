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
let rutaBaseModelos = '';

// Todo lo que este worker escriba en consola lleva este prefijo, para poder
// filtrar por "traductor" en las DevTools del documento offscreen.
const LOG = '[LiveDub][traductor-worker]';

// Archivos que transformers.js pide para un modelo Marian cuantizado. Los
// marcados como obligatorios hacen fallar la carga si no están: comprobarlos
// antes nos da un error exacto en vez de un fallo opaco a medio camino.
const ARCHIVOS_MODELO = [
  { ruta: 'config.json', obligatorio: true },
  { ruta: 'tokenizer.json', obligatorio: true },
  { ruta: 'tokenizer_config.json', obligatorio: true },
  { ruta: 'generation_config.json', obligatorio: false },
  { ruta: 'onnx/encoder_model_quantized.onnx', obligatorio: true },
  { ruta: 'onnx/decoder_model_merged_quantized.onnx', obligatorio: true }
];

/* ------------------------------------------------------------------ */
/* Configuración del entorno: todo local, nada de red                  */
/* ------------------------------------------------------------------ */

function configurarEntorno({ rutaModelos, rutaWasm }) {
  rutaBaseModelos = rutaModelos;
  console.log(`${LOG} configurando entorno`, { rutaModelos, rutaWasm, modelo: idModelo });

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

// Comprueba que los archivos del modelo existen ANTES de arrancar el pipeline.
// Sin esto, un archivo ausente se manifiesta como un fallo tardío y confuso (o,
// según el archivo, como una carga que no termina nunca). Aquí sabemos
// exactamente cuál falta y lo decimos.
async function comprobarArchivos() {
  const base = `${rutaBaseModelos}${idModelo}/`;
  const faltan = [];

  for (const { ruta, obligatorio } of ARCHIVOS_MODELO) {
    const url = `${base}${ruta}`;
    let ok = false;
    let detalle = '';
    try {
      const respuesta = await fetch(url, { method: 'GET' });
      ok = respuesta.ok;
      detalle = `HTTP ${respuesta.status}`;
      if (ok) {
        const bytes = Number(respuesta.headers.get('content-length') || 0);
        detalle = bytes ? `${bytes.toLocaleString('es')} bytes` : 'ok';
      }
    } catch (error) {
      detalle = String(error?.message || error);
    }

    console.log(`${LOG} ${ok ? '✔' : '✘'} ${ruta} → ${detalle}`);
    if (!ok && obligatorio) faltan.push(ruta);
  }

  if (faltan.length) {
    throw new Error(
      `Faltan archivos del modelo de traducción en models/${idModelo}/: ${faltan.join(', ')}. ` +
        'Vuelve a ejecutar models/descargar-modelo-traductor.sh.'
    );
  }
}

async function cargarModelo() {
  if (traductor) return traductor;
  if (cargando) return cargando;

  // OPUS-MT es un modelo Marian: el par de idiomas va en el propio modelo,
  // por eso no hay que pasar src_lang/tgt_lang al traducir.
  const inicioCarga = performance.now();

  cargando = comprobarArchivos()
    .then(() => {
      console.log(`${LOG} archivos verificados, arrancando el pipeline…`);
      return pipeline('translation', idModelo, {
        quantized: true,
        progress_callback: (info) => {
          // 'progress' se dispara decenas de veces por archivo: sólo logueamos
          // los hitos, para no ahogar la consola del offscreen.
          if (info?.status && info.status !== 'progress') {
            console.log(`${LOG} ${info.status}${info.file ? ` · ${info.file}` : ''}`);
          }
          self.postMessage({
            type: SALIDA.PROGRESO,
            estado: info?.status ?? '',
            archivo: info?.file ?? '',
            porcentaje: typeof info?.progress === 'number' ? Math.round(info.progress) : null
          });
        }
      });
    })
    .then((p) => {
      traductor = p;
      cargando = null;
      console.log(`${LOG} pipeline listo en ${Math.round(performance.now() - inicioCarga)} ms`);
      return p;
    })
    .catch((error) => {
      cargando = null;
      console.error(`${LOG} fallo al cargar el modelo:`, error);
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
        console.log(`${LOG} INIT completado, avisando a traductor.js`);
        self.postMessage({ type: SALIDA.LISTO, modelo: idModelo });
        break;

      case ENTRADA.TRADUCIR:
        await traducir(mensaje);
        break;

      default:
        break;
    }
  } catch (error) {
    console.error(`${LOG} error en ${mensaje.type}:`, error);
    self.postMessage({
      type: SALIDA.ERROR,
      id: mensaje.id ?? null,
      fase: mensaje.type === ENTRADA.INIT ? 'carga' : 'traduccion',
      error: String(error?.message || error)
    });
  }
};

// self.onerror NO captura promesas rechazadas sin manejar: si una se escapa,
// sin esto el worker se quedaría mudo y traductor.js esperando para siempre.
self.addEventListener('unhandledrejection', (evento) => {
  const motivo = evento?.reason;
  console.error(`${LOG} promesa rechazada sin manejar:`, motivo);
  self.postMessage({
    type: SALIDA.ERROR,
    fase: 'carga',
    error: String(motivo?.message || motivo)
  });
});

self.onerror = (evento) => {
  console.error(`${LOG} error no capturado:`, evento?.message || evento);
  self.postMessage({
    type: SALIDA.ERROR,
    fase: 'worker',
    error: String(evento?.message || evento)
  });
};
