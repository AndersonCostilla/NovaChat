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

const ENTRADA = { INIT: 'INIT', TRADUCIR: 'TRADUCIR', CANCELAR: 'CANCELAR' };
const SALIDA = {
  PROGRESO: 'PROGRESO',
  LISTO: 'LISTO',
  RESULTADO: 'RESULTADO',
  CANCELADO: 'CANCELADO', // acuse de una frase abandonada: libera el hueco
  EN_CURSO: 'EN_CURSO', // aviso de cuánto trabajo lleva el lote que empieza
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

/* ------------------------------------------------------------------ */
/* Lote con continuación (8-oct-2026)                                  */
/* ------------------------------------------------------------------ */
//
// POR QUÉ. Antes, todas las oraciones de una frase iban en UNA sola llamada
// a generate(). Como esa llamada no tiene puntos intermedios, el worker se
// quedaba ciego y sordo hasta terminarla: no podía atender el CANCELAR, el
// hueco no se liberaba, y el rescate de traductor.js acababa reiniciando el
// worker 50 s después, vaciando la cola de paso. Una alucinación repetitiva
// de Whisper ("Thank you." x40) bastaba para tirar cuatro frases seguidas.
//
// Ahora se traduce por GRUPOS, con un punto de abandono entre grupo y grupo.

// Cuántas oraciones van en cada llamada a generate().
//
// 8-oct-2026, SEGUNDA VUELTA. Estaba en 8 y el razonamiento era "con 8 el
// troceo no se activa nunca con habla legítima". Eso era cierto y, aun así,
// el número estaba mal, porque pasaba por alto lo esencial:
//
//   EL TAMAÑO DEL GRUPO ES LA RESOLUCIÓN DEL PRESUPUESTO.
//
// generate() no se puede interrumpir. El presupuesto sólo se puede mirar
// ENTRE grupos. Así que el tiempo máximo que esta frase puede ocupar el
// worker sin que nadie pueda hacer nada no es PRESUPUESTO_MS: es
// "lo que tarde un grupo". Un presupuesto de 12 s comprobado cada 8
// oraciones no es un presupuesto de 12 s.
//
// Lo demostró la frase #3 en producción: 12 trozos, o sea 8 + 4. El primer
// grupo de 8 se comió los 30 s enteros del orquestador. La comprobación del
// presupuesto, que estaba en i = 8, NUNCA LLEGÓ A EJECUTARSE. El arreglo
// anterior no falló: no llegó a entrar en juego.
//
// Con 3, una frase de habla real (1-2 trozos medidos, 3-4 en el peor caso)
// sigue cabiendo en UN grupo, que era lo que se quería conservar; y el peor
// caso de ceguera baja de 8 oraciones a 3.
const TROZOS_POR_GRUPO = 3;

// Tiempo máximo que esta frase puede ocupar el worker. Al terminar un grupo,
// si se ha pasado, se devuelve lo traducido hasta ahí MARCADO COMO PARCIAL
// y se libera el worker.
//
// El número tampoco es arbitrario: 12 s es lo que dura como mucho una frase
// (MAX_FRASE_CHUNKS = 47 bloques x 256 ms = 12,03 s). Si traducir una frase
// cuesta más de lo que la frase dura, el doblaje ya no se recupera: cada
// frase empujaría a la siguiente para siempre. Gastar más tiempo ahí no
// salva esa frase, sólo se lleva por delante las que vienen detrás.
//
// Importante: este presupuesto es MENOR que el TIMEOUT_MS de traductor.js
// (30 s). Esa diferencia es deliberada — así el worker devuelve lo que tenga
// ANTES de que el orquestador se canse, y la parte traducida no se pierde.
const PRESUPUESTO_MS = 12000;

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
  // A diferencia del sintetizador, aquí la traducción es UNA sola llamada por
  // lote: no hay puntos intermedios donde abandonar. Sólo se puede evitar
  // empezarla.
  if (estaCancelado(id)) {
    cancelados.delete(id);
    console.warn(`${LOG} frase #${id}: cancelada antes de empezar.`);
    self.postMessage({ type: SALIDA.CANCELADO, id });
    return;
  }
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
  // DIAGNÓSTICO (8-oct-2026). Se avisa del tamaño del lote ANTES de empezar,
  // porque generate() no se puede interrumpir: si esta frase se come el
  // tiempo de espera, éste es el último dato que se tendrá de ella. Sin esto,
  // una traducción que agota los 30 s no deja ni rastro de POR QUÉ.
  self.postMessage({
    type: SALIDA.EN_CURSO,
    id,
    trozos: trozos.length,
    palabrasMasLargo,
    maxTokens
  });

  // Se le pasa de TROZOS_POR_GRUPO en TROZOS_POR_GRUPO para que haya puntos
  // donde parar. Con habla normal sólo hay un grupo: es exactamente lo mismo
  // que antes, misma llamada y mismo coste.
  const lista = [];
  let abandonadoEn = -1;
  // Duración de cada llamada a generate(), en orden. Es lo que permite
  // distinguir "muchos grupos normales" de "un grupo atascado".
  const grupos = [];

  for (let i = 0; i < entradas.length; i += TROZOS_POR_GRUPO) {
    // Punto de abandono 1: nos han cancelado mientras trabajábamos.
    if (estaCancelado(id)) {
      abandonadoEn = i;
      break;
    }
    // Punto de abandono 2: esta frase ya ha gastado su tiempo. Nunca antes
    // del primer grupo: toda frase tiene derecho a intentarse una vez.
    const transcurrido = performance.now() - inicio;
    if (i > 0 && transcurrido > PRESUPUESTO_MS) {
      abandonadoEn = i;
      console.warn(
        `${LOG} frase #${id}: presupuesto de ${PRESUPUESTO_MS / 1000} s agotado tras ` +
          `${i} de ${entradas.length} trozo(s). Se devuelve lo traducido y se libera el worker.`
      );
      break;
    }

    // Punto de abandono 3: PREDICTIVO. Mirar sólo el tiempo ya gastado llega
    // tarde — se puede estar a 11,9 s y entrar igual en un grupo que va a
    // costar otros 20. Como ya sabemos lo que han costado los grupos
    // anteriores de ESTA frase, en ESTE equipo y en ESTE momento (que es la
    // única medida que vale cuando la máquina va degradada), se estima lo
    // que costaría el siguiente y no se entra si no cabe.
    const porTrozo = i > 0 ? transcurrido / i : 0;
    const grupoQueViene = Math.min(TROZOS_POR_GRUPO, entradas.length - i);
    const estimado = porTrozo * grupoQueViene;
    if (i > 0 && transcurrido + estimado > PRESUPUESTO_MS) {
      abandonadoEn = i;
      console.warn(
        `${LOG} frase #${id}: no se entra en el grupo ${grupos.length + 1} — ` +
          `llevamos ${Math.round(transcurrido)} ms y ese grupo costaría unos ` +
          `${Math.round(estimado)} ms más (${Math.round(porTrozo)} ms/trozo medidos aquí), ` +
          `por encima del presupuesto de ${PRESUPUESTO_MS} ms. Se devuelve lo traducido.`
      );
      break;
    }

    const tGrupo = performance.now();
    const parte = await modelo(entradas.slice(i, i + TROZOS_POR_GRUPO), {
      max_new_tokens: maxTokens,
      num_beams: NUM_BEAMS
    });
    const msGrupo = Math.round(performance.now() - tGrupo);
    grupos.push(msGrupo);

    // POR GRUPO, no sólo el total. Con el total no se puede saber si una
    // traducción de 30 s fueron diez grupos normales o uno solo atascado, y
    // esas dos cosas piden arreglos distintos.
    console.log(
      `${LOG} frase #${id}: grupo ${grupos.length} (trozos ${i + 1}-${i + grupoQueViene} ` +
        `de ${entradas.length}) ${msGrupo} ms, ${Math.round(msGrupo / grupoQueViene)} ms/trozo, ` +
        `acumulado ${Math.round(performance.now() - inicio)} ms.`
    );

    lista.push(...(Array.isArray(parte) ? parte : [parte]));

    // CEDER EL TURNO. Esta línea es la que hace que todo lo anterior sirva
    // de algo, y no es nada evidente: los mensajes que llegan al worker son
    // MACROtareas, y `await` sobre una promesa ya resuelta sólo drena
    // MICROtareas. Sin este setTimeout(0), el CANCELAR no se entrega jamás y
    // el bucle de grupos no se entera de nada: parecería implementado y no
    // haría nada. Comprobado ejecutándolo, en tests/test-lote-continuacion.mjs.
    if (i + TROZOS_POR_GRUPO < entradas.length) {
      await new Promise((resolver) => setTimeout(resolver, 0));
    }
  }

  cancelados.delete(id);

  // Si nos cancelaron ANTES de traducir nada, no hay nada que devolver.
  if (abandonadoEn === 0) {
    console.warn(`${LOG} frase #${id}: abandonada sin traducir nada.`);
    self.postMessage({ type: SALIDA.CANCELADO, id });
    return;
  }
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

  console.log(
    `${LOG} frase #${id} traducida en ${duracionMs} ms (${trozos.length} trozo(s), ` +
      `${grupos.length} grupo(s): ${grupos.join(' + ')} ms)`
  );

  // Una traducción a medias NUNCA se entrega en silencio: va marcada, y
  // aguas arriba se cuenta como pérdida parcial y se avisa en el subtítulo.
  const parcial = abandonadoEn > 0;
  if (parcial) {
    console.warn(
      `${LOG} frase #${id}: PARCIAL — ${lista.length} de ${trozos.length} trozo(s) traducidos.`
    );
  }

  self.postMessage({
    type: SALIDA.RESULTADO,
    id,
    traduccion,
    trozos: trozos.length,
    trozosTraducidos: lista.length,
    parcial,
    terminosProtegidos: totalMarcas,
    duracionMs,
    grupos // ms de cada llamada a generate(), en orden
  });
}

/* ------------------------------------------------------------------ */
/* Protocolo de mensajes                                               */
/* ------------------------------------------------------------------ */

async function atender(mensaje) {

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
}

/* ------------------------------------------------------------------ */
/* Serialización y cancelación (arreglo de colas, 7-oct-2026)          */
/* ------------------------------------------------------------------ */
//
// Mismo defecto que se encontró en el sintetizador: `self.onmessage = async`
// NO espera a terminar antes de atender el mensaje siguiente, así que dos
// traducciones podían correr a la vez repartiéndose el único núcleo. Ahora se
// encadenan.
let cadena = Promise.resolve();
const cancelados = new Set();

// Cuántas cancelaciones se recuerdan. Un Set que sólo crece en un worker que
// vive toda la sesión es una fuga, aunque sea barata.
const CANCELACIONES_RECORDADAS = 200;

function estaCancelado(id) {
  return id !== undefined && id !== null && cancelados.has(id);
}

self.onmessage = (evento) => {
  const mensaje = evento.data || {};

  // CANCELAR no pasa por la cadena: si esperase su turno llegaría después del
  // trabajo que pretende cancelar.
  if (mensaje.type === ENTRADA.CANCELAR) {
    if (mensaje.id !== undefined && mensaje.id !== null) {
      cancelados.add(mensaje.id);
      // FUGA PEQUEÑA PERO REAL (8-oct-2026). Si la cancelación llega cuando
      // la frase YA había terminado, nadie la borra nunca de aquí: el Set
      // crece durante toda la sesión. Son números, así que no explica una
      // degradación de x4 — pero un conjunto que sólo crece en un worker que
      // dura horas no se deja pasar. Se acota a las últimas CANCELACIONES_
      // RECORDADAS: cancelar algo de hace 200 frases no tiene sentido.
      if (cancelados.size > CANCELACIONES_RECORDADAS) {
        const viejo = cancelados.values().next().value;
        cancelados.delete(viejo);
      }
      console.warn(`${LOG} cancelación recibida para #${mensaje.id}`);
    }
    return;
  }

  cadena = cadena.then(() => atender(mensaje)).catch((error) => {
    console.error(`${LOG} fallo no capturado en la cadena:`, error);
  });
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
