// sintetizador-worker.js
// Worker dedicado para la SÍNTESIS DE VOZ en español (Fase 5).
//
// Independiente de los workers de Whisper y de OPUS-MT, por la misma razón de
// siempre: si el modelo de voz falla, la transcripción y la traducción siguen
// funcionando con normalidad.
//
// MODELO: MMS-TTS español (arquitectura VITS), ONNX cuantizado, 100 % local.
// Se eligió porque la librería que ya tenemos vendorizada lo soporta de fábrica
// (comprobado: el bundle registra la tarea "text-to-speech" y la clase
// VitsModel), así que no hace falta añadir ninguna dependencia nueva.
//
// VITS es de una sola pieza: NO necesita vocoder aparte ni "speaker
// embeddings", a diferencia de SpeechT5. Devuelve directamente la onda.
//
// IMPORTANTE: cero peticiones a internet. Las rutas llegan en el mensaje INIT
// como URLs chrome-extension://.

import { pipeline, env } from './libs/transformers/transformers.min.js';
import { trocearEnOraciones } from './segmentador.js';
import { VOZ, archivoOnnxVoz } from './messages.js';

const ENTRADA = { INIT: 'INIT', SINTETIZAR: 'SINTETIZAR' };
const SALIDA = {
  PROGRESO: 'PROGRESO',
  LISTO: 'LISTO',
  RESULTADO: 'RESULTADO',
  ERROR: 'ERROR'
};

let sintetizador = null; // pipeline cacheado: se carga una sola vez
let cargando = null;
let idModelo = 'mms-tts-spa';
let rutaBaseModelos = '';

const LOG = '[LiveDub][sintetizador-worker]';

// Archivos que transformers.js pide para un modelo VITS cuantizado.
// Ojo a la diferencia con OPUS-MT: aquí hay UN SOLO .onnx, no encoder +
// decoder, porque VITS no es un modelo encoder-decoder.
//
// Fase 5.1: cuál de los dos .onnx se exige depende de VOZ.USAR_CUANTIZADO
// (messages.js). El script de descarga baja LOS DOS, así que alternar entre
// ellos es cambiar una línea y recargar: no hay que volver a descargar nada.
const ARCHIVOS_MODELO = [
  { ruta: 'config.json', obligatorio: true },
  { ruta: 'tokenizer.json', obligatorio: true },
  { ruta: 'tokenizer_config.json', obligatorio: true },
  { ruta: archivoOnnxVoz(), obligatorio: true }
];

/* ------------------------------------------------------------------ */
/* Configuración del entorno: todo local, nada de red                  */
/* ------------------------------------------------------------------ */

function configurarEntorno({ rutaModelos, rutaWasm }) {
  rutaBaseModelos = rutaModelos;
  console.log(`${LOG} configurando entorno`, { rutaModelos, rutaWasm, modelo: idModelo });

  env.allowRemoteModels = false; // jamás descargar un modelo
  env.allowLocalModels = true;
  env.localModelPath = rutaModelos;
  env.useBrowserCache = false;

  const wasm = env.backends.onnx.wasm;
  wasm.wasmPaths = rutaWasm;
  wasm.numThreads = 1;
  wasm.proxy = false;

  try {
    if (env.backends.onnx.env) env.backends.onnx.env.logLevel = 'error';
  } catch (_) {
    /* API interna de onnxruntime-web: si cambia, sólo habrá más ruido */
  }
}

/* ------------------------------------------------------------------ */
/* Carga del modelo                                                    */
/* ------------------------------------------------------------------ */

// Mismo pre-chequeo que en el traductor: si falta un archivo lo decimos por su
// nombre, en segundos, en vez de dejar una carga opaca a medio camino.
//
// LIMITACIÓN CONOCIDA (igual que en traductor-worker.js): esto sólo detecta
// archivos AUSENTES. Un archivo truncado responde HTTP 200 y pasa el chequeo;
// ese caso lo caza después ONNX con un error de protobuf.
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
      `Faltan archivos del modelo de voz en models/${idModelo}/: ${faltan.join(', ')}. ` +
        'Vuelve a ejecutar models/descargar-modelo-voz.sh.'
    );
  }
}

async function cargarModelo() {
  if (sintetizador) return sintetizador;
  if (cargando) return cargando;

  const inicioCarga = performance.now();

  cargando = comprobarArchivos()
    .then(() => {
      console.log(`${LOG} archivos verificados, arrancando el pipeline…`);
      console.log(
        `${LOG} motor: ${VOZ.USAR_CUANTIZADO ? 'CUANTIZADO int8' : 'COMPLETO float32'} ` +
          `(${archivoOnnxVoz()})`
      );
      return pipeline('text-to-speech', idModelo, {
        quantized: VOZ.USAR_CUANTIZADO,
        progress_callback: (info) => {
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
      sintetizador = p;
      cargando = null;
      const hz = p?.model?.config?.sampling_rate ?? '(desconocida)';
      console.log(`${LOG} pipeline listo en ${Math.round(performance.now() - inicioCarga)} ms · ${hz} Hz`);
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
/* Síntesis de un texto                                                */
/* ------------------------------------------------------------------ */

// Une varias ondas en una sola, con un pequeño silencio entre oraciones para
// que el resultado no suene atropellado.
//
// Fase 5.1: el silencio bajó de 120 ms a 40 ms. En una frase de cinco
// oraciones eran casi medio segundo de doblaje extra que no dice nada y que
// se suma al retraso contra el vídeo.
function concatenar(ondas, hz) {
  const silencio = Math.round(hz * VOZ.PAUSA_ENTRE_ORACIONES_S);
  const total = ondas.reduce((n, o) => n + o.length, 0) + silencio * Math.max(0, ondas.length - 1);
  const salida = new Float32Array(total);

  let cursor = 0;
  for (let i = 0; i < ondas.length; i++) {
    salida.set(ondas[i], cursor);
    cursor += ondas[i].length + (i < ondas.length - 1 ? silencio : 0);
  }
  return salida;
}

async function sintetizar({ id, texto }) {
  const inicio = performance.now();
  const modelo = await cargarModelo();

  // Igual que en la traducción, se trocea: una frase muy larga de una sola vez
  // sale peor y tarda más en empezar a sonar.
  const trozos = trocearEnOraciones(texto);
  if (trozos.length === 0) {
    self.postMessage({ type: SALIDA.RESULTADO, id, audio: null, duracionMs: 0 });
    return;
  }

  console.log(`${LOG} frase #${id}: sintetizando ${trozos.length} trozo(s)`);

  const ondas = [];
  let hz = 16000;
  for (const trozo of trozos) {
    const salida = await modelo(trozo);
    const onda = salida?.audio;
    if (onda && onda.length) {
      ondas.push(onda instanceof Float32Array ? onda : new Float32Array(onda));
      hz = salida.sampling_rate || hz;
    }
  }

  if (ondas.length === 0) {
    throw new Error('El modelo de voz no devolvió ninguna onda de audio.');
  }

  const audio = ondas.length === 1 ? ondas[0] : concatenar(ondas, hz);
  const duracionMs = Math.round(performance.now() - inicio);
  const segundosAudio = (audio.length / hz).toFixed(2);

  // Fase 5.1: la métrica que de verdad sirve es MS POR SEGUNDO DE AUDIO.
  // "x veces tiempo real" engaña, porque depende de lo larga que sea la frase;
  // ms/s es comparable entre una frase de 3 s y una de 20 s.
  const msPorSegundo = Math.round(duracionMs / Number(segundosAudio));
  console.log(
    `${LOG} frase #${id}: ${segundosAudio} s de voz en ${duracionMs} ms · ` +
      `${msPorSegundo} ms por segundo de audio ` +
      `(x${(Number(segundosAudio) / (duracionMs / 1000)).toFixed(2)} tiempo real)`
  );

  // El audio viaja como Transferable: se mueve, no se copia. Importante,
  // porque son cientos de miles de muestras por frase.
  self.postMessage(
    {
      type: SALIDA.RESULTADO,
      id,
      audio: audio.buffer,
      muestras: audio.length,
      hz,
      trozos: trozos.length,
      duracionMs,
      // Datos crudos para el banco de medición (rendimiento-voz.js).
      caracteres: texto.length,
      segundosAudio: Number(segundosAudio),
      msPorSegundo
    },
    [audio.buffer]
  );
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
        console.log(`${LOG} INIT completado, avisando a sintetizador.js`);
        self.postMessage({ type: SALIDA.LISTO, modelo: idModelo });
        break;

      case ENTRADA.SINTETIZAR:
        await sintetizar(mensaje);
        break;

      default:
        break;
    }
  } catch (error) {
    console.error(`${LOG} error en ${mensaje.type}:`, error);
    self.postMessage({
      type: SALIDA.ERROR,
      id: mensaje.id ?? null,
      fase: mensaje.type === ENTRADA.INIT ? 'carga' : 'sintesis',
      error: String(error?.message || error)
    });
  }
};

// self.onerror no captura promesas rechazadas sin manejar.
self.addEventListener('unhandledrejection', (evento) => {
  const motivo = evento?.reason;
  console.error(`${LOG} promesa rechazada sin manejar:`, motivo);
  self.postMessage({ type: SALIDA.ERROR, fase: 'carga', error: String(motivo?.message || motivo) });
});

self.onerror = (evento) => {
  console.error(`${LOG} error no capturado:`, evento?.message || evento);
  self.postMessage({ type: SALIDA.ERROR, fase: 'worker', error: String(evento?.message || evento) });
};
