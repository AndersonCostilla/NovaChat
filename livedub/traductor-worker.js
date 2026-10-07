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
import { trocearEnOraciones, unirTraducciones } from './segmentador.js';
import { proteger, restaurar, limpiarMarcadoresSueltos } from './terminos-protegidos.js';

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

// Búsqueda en haz. OPUS-MT publica num_beams=4 en su config, y la librería lo
// fusiona antes que nuestras opciones (_get_generation_config). Con 4 haces el
// decodificador hace 4 pasadas por token: en esta CPU, sin hilos de WebAssembly,
// eso es el factor más caro de la traducción. 1 = greedy, varias veces más
// rápido a cambio de algo de calidad. Súbelo a 4 si prefieres calidad.
const NUM_BEAMS = 1;

// Techo de tokens generados por trozo. No es el límite que causaba el
// truncamiento (comprobado: nunca se alcanzaba), sólo un seguro contra
// generaciones desbocadas. Se calcula según el trozo más largo del lote.
const TOKENS_MINIMOS = 64;
const TOKENS_MAXIMOS = 512;

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

      // Dejamos por escrito qué parámetros de generación trae el modelo: así
      // sabemos si num_beams venía de su config y cuánto estamos ahorrando.
      const propios = { ...(p?.model?.config ?? {}), ...(p?.model?.generation_config ?? {}) };
      console.log(`${LOG} generación → num_beams del modelo: ${propios.num_beams ?? '(sin definir)'}` +
        ` · max_length del modelo: ${propios.max_length ?? '(sin definir)'}` +
        ` · usaremos num_beams=${NUM_BEAMS}`);
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

  // OPUS-MT traduce ORACIONES, no párrafos: con varias oraciones de golpe se
  // come todas menos una. Por eso troceamos antes y reunimos después.
  const trozos = trocearEnOraciones(texto);
  if (trozos.length === 0) {
    self.postMessage({ type: SALIDA.RESULTADO, id, traduccion: '', duracionMs: 0 });
    return;
  }

  const palabrasMasLargo = Math.max(...trozos.map((t) => t.split(/\s+/).length));
  const maxTokens = Math.min(TOKENS_MAXIMOS, Math.max(TOKENS_MINIMOS, palabrasMasLargo * 4));

  // Nombres propios y términos técnicos fuera del alcance del modelo: se
  // cambian por marcadores antes de traducir y se reponen después.
  const protegidos = trozos.map((trozo) => proteger(trozo));
  const entradas = protegidos.map((p) => p.texto);
  const totalMarcas = protegidos.reduce((n, p) => n + p.marcas.length, 0);

  console.log(
    `${LOG} frase #${id}: ${trozos.length} trozo(s), máx ${palabrasMasLargo} palabras` +
      (totalMarcas ? `, ${totalMarcas} término(s) protegido(s)` : '')
  );

  // El pipeline acepta un array y lo procesa como LOTE en una sola llamada a
  // generate(), que es bastante más barato que una llamada por oración.
  const salida = await modelo(entradas, {
    max_new_tokens: maxTokens,
    num_beams: NUM_BEAMS
  });

  const lista = Array.isArray(salida) ? salida : [salida];
  const perdidas = [];
  const parciales = lista.map((item, i) => {
    const crudo = item?.translation_text ?? '';
    const { texto: repuesto, perdidas: sinRestaurar } = restaurar(crudo, protegidos[i]?.marcas ?? []);
    perdidas.push(...sinRestaurar);
    // Por si algún marcador sobrevivió deformado: nunca se le enseña al usuario.
    return limpiarMarcadoresSueltos(repuesto);
  });

  if (perdidas.length) {
    // Si esto aparece mucho, el modelo se está comiendo los marcadores y hay
    // que cambiar PREFIJO_MARCA en terminos-protegidos.js.
    console.warn(`${LOG} frase #${id}: el modelo perdió ${perdidas.length} marcador(es): ${perdidas.join(', ')}`);
  }

  const traduccion = unirTraducciones(parciales);

  const duracionMs = Math.round(performance.now() - inicio);

  // Si algún trozo se queda sin traducir lo decimos: antes esto se perdía en
  // silencio y parecía que el modelo "resumía".
  const vacios = parciales.filter((t) => !t.trim()).length;
  if (vacios > 0) {
    console.warn(`${LOG} frase #${id}: ${vacios} de ${trozos.length} trozos volvieron vacíos.`);
  }

  console.log(`${LOG} frase #${id} traducida en ${duracionMs} ms (${trozos.length} trozo(s))`);

  self.postMessage({
    type: SALIDA.RESULTADO,
    id,
    traduccion,
    trozos: trozos.length,
    terminosProtegidos: totalMarcas,
    duracionMs
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
