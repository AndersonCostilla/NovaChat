// traductor.js
// Capa fina de orquestación entre offscreen.js y el worker de traducción.
// Mismo patrón que transcriptor.js: no sabe de audio ni de UI, recibe texto en
// inglés y devuelve texto en español.
//
// Degradación independiente: si el modelo de traducción no carga, el estado
// queda en 'error' y la transcripción sigue funcionando sin enterarse.

export const ESTADO_TRADUCTOR = {
  INACTIVO: 'inactivo',
  CARGANDO: 'cargando',
  LISTO: 'listo',
  ERROR: 'error'
};

const RUTA_WORKER = 'traductor-worker.js';
const MAX_EN_COLA = 4; // traducir texto es rápido; aguanta más cola que Whisper
// TIEMPOS (revisados el 8-oct-2026, tras el episodio de #4, #5 y #6).
//
// EL BUG QUE HABÍA. Al vencer TIMEOUT_MS se daba la frase por perdida pero
// NO se liberaba el hueco del worker, porque el worker estaba dentro de una
// llamada a generate() sin puntos de corte y no podía acusar la cancelación.
// El hueco no volvía hasta que el rescate reiniciaba el worker, 20 s más
// tarde: 50 s de tubería parada, recarga de 113 MB y cola vaciada de golpe.
//
// POR QUÉ NO SE ARREGLA LIBERANDO EL HUECO A LA FUERZA. Porque eso es
// exactamente el bug que se arregló el 7-oct: declarar libre un worker que
// sigue ocupado mete dos generate() a la vez en el mismo núcleo y va PEOR.
//
// CÓMO SE ARREGLA DE VERDAD. Dándole al worker puntos donde pueda parar.
// traductor-worker.js traduce ahora por grupos de 8 oraciones, cede el turno
// entre grupo y grupo y se autoimpone un presupuesto de 12 s, al cabo del
// cual devuelve lo que lleve marcado como PARCIAL. Con eso el worker se
// libera solo y estos dos temporizadores pasan a ser lo que siempre
// debieron ser: una red de seguridad que casi nunca se usa.
const TIMEOUT_MS = 30000; // 30 s por frase: si no, se da por perdida

// Vigilante de carga. El modelo está en disco (unos 113 MB): cargarlo son
// segundos. Si en 90 s no hay ni 'listo' ni 'error', algo se ha quedado
// colgado y es preferible declararlo roto que dejar el badge girando para
// siempre y la cola descartando frases en silencio.
const TIMEOUT_CARGA_MS = 90000;

// Margen para que el worker acuse una cancelación antes de darlo por colgado.
//
// Antes eran 20 s, elegidos cuando el worker podía tardar lo que quisiera en
// reaccionar. Ya no: con los puntos de abandono, lo máximo que puede tardar
// en atender un CANCELAR es lo que dure el grupo que tiene entre manos. Se
// deja en 15 s, que es holgado para un grupo de 8 oraciones, y así el peor
// caso de tubería parada baja de 50 s a 45 s en el único escenario que queda
// vivo: una sola oración que por sí sola tarde más de 30 s. Ese caso no se
// puede trocear más, y por eso el rescate sigue existiendo.
const TIMEOUT_RESCATE_MS = 15000;

// A partir de cuántos trozos en un mismo lote se considera anómalo. El habla
// normal da 1-2 trozos por frase (medido con segmentador.js); una alucinación
// repetitiva de Whisper da decenas, y el coste de generate() va con ese número.
const TROZOS_SOSPECHOSOS = 8;

const LOG = '[LiveDub][traductor]';

export function crearTraductor({ onEstado, onActividad, onError, onTrabajo } = {}) {
  let worker = null;
  let estado = ESTADO_TRADUCTOR.INACTIVO;
  let siguienteId = 1;

  const cola = []; // { id, texto, resolver }
  const pendientes = new Map(); // id -> { resolver, temporizador }
  let enVuelo = false;

  // Id de la frase que está AHORA MISMO dentro del worker. Mismo arreglo que
  // en sintetizador.js: antes `enVuelo` era un booleano suelto y el resultado
  // tardío de una frase ya dada por perdida liberaba un hueco que no estaba
  // libre, metiendo dos traducciones en paralelo en el mismo núcleo.
  let idEnVuelo = null;
  let ultimasOpciones = null;
  let vigilanteCarga = null;

  // Qué lote está dentro de generate() ahora mismo: { id, trozos, maxTokens }.
  // Sirve para que, si se agota el tiempo, el aviso diga CUÁNTO trabajo había
  // en vuelo en vez de limitarse a "tardó demasiado".
  let trabajoEnVuelo = null;

  function fijarEstado(nuevo, detalle = {}) {
    const anterior = estado;
    estado = nuevo;
    if (nuevo !== anterior) console.log(`${LOG} estado: ${anterior} → ${nuevo}`, detalle.detalle || '');

    // En cuanto el modelo decide (listo o error), el vigilante sobra.
    if (nuevo === ESTADO_TRADUCTOR.LISTO || nuevo === ESTADO_TRADUCTOR.ERROR) pararVigilante();

    onEstado?.({ estado: nuevo, ...detalle });
  }

  function pararVigilante() {
    if (vigilanteCarga === null) return;
    clearTimeout(vigilanteCarga);
    vigilanteCarga = null;
  }

  // Si el worker no responde nada en TIMEOUT_CARGA_MS, forzamos 'error'. Así el
  // fallo es visible en la UI en vez de parecer una carga eterna, y las frases
  // encoladas se resuelven en lugar de acumularse.
  function armarVigilante() {
    pararVigilante();
    vigilanteCarga = setTimeout(() => {
      vigilanteCarga = null;
      if (estado === ESTADO_TRADUCTOR.LISTO || estado === ESTADO_TRADUCTOR.ERROR) return;

      const mensaje =
        `El traductor no terminó de cargar en ${TIMEOUT_CARGA_MS / 1000} s. ` +
        'Revisa la consola del documento offscreen (filtra por "traductor"). ' +
        'La transcripción sigue funcionando.';
      console.error(`${LOG} ${mensaje}`);
      fijarEstado(ESTADO_TRADUCTOR.ERROR, { detalle: 'Tiempo agotado al cargar el traductor.' });
      fallarTodo('tiempo agotado al cargar el traductor');
    }, TIMEOUT_CARGA_MS);
  }

  /* ---------------------- Arranque del worker --------------------- */

  function iniciar({ rutaModelos, rutaWasm, modelo }) {
    if (worker) return;
    ultimasOpciones = { rutaModelos, rutaWasm, modelo };

    console.log(`${LOG} iniciando worker`, { modelo, rutaModelos });
    fijarEstado(ESTADO_TRADUCTOR.CARGANDO, { detalle: 'Cargando traductor local…' });
    armarVigilante();

    try {
      worker = new Worker(chrome.runtime.getURL(RUTA_WORKER), { type: 'module' });
    } catch (error) {
      console.error(`${LOG} no se pudo crear el worker:`, error);
      fijarEstado(ESTADO_TRADUCTOR.ERROR, {
        detalle: `No se pudo crear el worker de traducción: ${error?.message || error}`
      });
      return;
    }

    worker.onmessage = (evento) => manejarMensaje(evento.data || {});

    // Un mensaje que no se puede deserializar dejaría al worker mudo sin avisar.
    worker.onmessageerror = (evento) => {
      console.error(`${LOG} mensaje ilegible del worker:`, evento);
      fijarEstado(ESTADO_TRADUCTOR.ERROR, { detalle: 'Mensaje ilegible del worker de traducción.' });
      fallarTodo('mensaje ilegible del worker de traducción');
    };

    worker.onerror = (evento) => {
      console.error(`${LOG} fallo del worker:`, evento?.message || evento);
      fijarEstado(ESTADO_TRADUCTOR.ERROR, {
        detalle: `Fallo en el worker de traducción: ${evento?.message || 'error desconocido'}`
      });
      fallarTodo('El worker de traducción se detuvo.');
    };

    worker.postMessage({ type: 'INIT', rutaModelos, rutaWasm, modelo });
  }

  /* ---------------------- Mensajes del worker --------------------- */

  function manejarMensaje(mensaje) {
    switch (mensaje.type) {
      case 'PROGRESO':
        if (estado !== ESTADO_TRADUCTOR.LISTO) {
          fijarEstado(ESTADO_TRADUCTOR.CARGANDO, {
            detalle:
              mensaje.porcentaje !== null && mensaje.porcentaje !== undefined
                ? `Cargando traductor local… ${mensaje.porcentaje}%`
                : 'Cargando traductor local…'
          });
        }
        break;

      case 'LISTO':
        console.log(`${LOG} worker listo con el modelo "${mensaje.modelo}"`);
        fijarEstado(ESTADO_TRADUCTOR.LISTO, { detalle: `Traductor listo (${mensaje.modelo})` });
        procesarCola();
        break;

      case 'RESULTADO':
        // Si no es el que esperábamos, es el de una frase ya dada por perdida:
        // no libera el hueco y no se procesa como actual.
        if (!liberarSi(mensaje.id)) break;
        if (mensaje.parcial) {
          console.warn(
            `${LOG} frase #${mensaje.id}: traducción PARCIAL ` +
              `(${mensaje.trozosTraducidos} de ${mensaje.trozos} trozos). ` +
              'Se entrega marcada; el resto de la frase no se dobla.'
          );
        }
        resolverPendiente(mensaje.id, {
          traduccion: mensaje.traduccion,
          duracionMs: mensaje.duracionMs,
          trozos: mensaje.trozos, // nº de oraciones en que se partió la frase
          trozosTraducidos: mensaje.trozosTraducidos ?? mensaje.trozos,
          parcial: Boolean(mensaje.parcial)
        });
        procesarCola();
        break;

      case 'EN_CURSO':
        // El worker ya está dentro de generate() y no se le puede interrumpir.
        trabajoEnVuelo = {
          id: mensaje.id,
          trozos: mensaje.trozos,
          palabrasMasLargo: mensaje.palabrasMasLargo,
          maxTokens: mensaje.maxTokens
        };
        if (mensaje.trozos >= TROZOS_SOSPECHOSOS) {
          console.warn(
            `${LOG} frase #${mensaje.id}: lote de ${mensaje.trozos} trozos. ` +
              'El coste de generate() crece con el número de trozos y NO se puede ' +
              'interrumpir a mitad: es el perfil de las traducciones que agotan el tiempo. ' +
              'Suele venir de una alucinación repetitiva de Whisper sobre música o silencio.'
          );
        }
        onTrabajo?.(trabajoEnVuelo);
        break;

      case 'CANCELADO':
        console.warn(`${LOG} el worker confirmó el abandono de la frase #${mensaje.id}.`);
        if (liberarSi(mensaje.id)) procesarCola();
        break;

      case 'ERROR':
        console.error(`${LOG} error del worker (fase ${mensaje.fase}):`, mensaje.error);
        if (mensaje.fase === 'carga' || mensaje.fase === 'worker') {
          fijarEstado(ESTADO_TRADUCTOR.ERROR, { detalle: traducirErrorModelo(mensaje.error) });
          fallarTodo(mensaje.error);
        } else {
          onError?.(mensaje.error);
          resolverPendiente(mensaje.id, { traduccion: '', error: mensaje.error });
          if (liberarSi(mensaje.id)) procesarCola();
        }
        break;

      default:
        break;
    }
  }

  // Mismos casos que en transcriptor.js: pesos ausentes, corruptos, WASM, memoria.
  function traducirErrorModelo(bruto) {
    const texto = String(bruto || '');
    if (/protobuf|InvalidProtobuf|corrupt|Failed to load model/i.test(texto)) {
      return 'El modelo de traducción está corrupto o incompleto: vuelve a ejecutar models/descargar-modelo-traductor.sh. La transcripción sigue funcionando.';
    }
    if (/Unable to load from local path|Failed to fetch|404|not found|Could not locate|no such file/i.test(texto)) {
      return 'Faltan los archivos del traductor en livedub/models/opus-mt-en-es/ (ver models/README.md). La transcripción sigue funcionando.';
    }
    if (/wasm|WebAssembly|magic word|CompileError/i.test(texto)) {
      return 'No se pudo iniciar WebAssembly para el traductor. La transcripción sigue funcionando.';
    }
    if (/memory|allocation|RangeError/i.test(texto)) {
      return 'Memoria insuficiente para el traductor. La transcripción sigue funcionando.';
    }
    return texto.length > 160 ? `${texto.slice(0, 157)}…` : texto;
  }

  /* ------------------------- Cola de textos ----------------------- */

  // Devuelve una promesa que SIEMPRE se resuelve (nunca rechaza): si no se
  // puede traducir, devuelve { traduccion: '', motivo }. Así quien llama no
  // tiene que envolver todo en try/catch y el subtítulo se publica igual.
  function traducir(texto) {
    if (!texto) return Promise.resolve({ traduccion: '', motivo: 'texto vacío' });

    if (estado === ESTADO_TRADUCTOR.ERROR) {
      return Promise.resolve({ traduccion: '', motivo: 'traductor no disponible' });
    }
    if (estado === ESTADO_TRADUCTOR.INACTIVO) {
      return Promise.resolve({ traduccion: '', motivo: 'traductor no iniciado' });
    }

    const id = siguienteId++;
    return new Promise((resolver) => {
      cola.push({ id, texto, resolver });

      // Si nos quedamos atrás, soltamos lo más viejo (igual que en Whisper).
      while (cola.length > MAX_EN_COLA) {
        const viejo = cola.shift();
        // Si esto se repite con el traductor en 'cargando', el modelo está
        // tardando de más: el vigilante acabará cortando por lo sano.
        console.warn(
          `${LOG} frase #${viejo.id} descartada por cola llena (estado actual: ${estado}).`
        );
        viejo.resolver({ traduccion: '', motivo: 'descartada por cola llena' });
      }

      procesarCola();
    });
  }

  function procesarCola() {
    if (!worker || enVuelo || estado !== ESTADO_TRADUCTOR.LISTO) return;

    const tarea = cola.shift();
    if (!tarea) return;

    enVuelo = true;
    onActividad?.(true);

    const temporizador = setTimeout(() => {
      // Diagnóstico: distinguir "nunca empezó" de "empezó y se atascó".
      const enVueloAhora = trabajoEnVuelo && trabajoEnVuelo.id === tarea.id ? trabajoEnVuelo : null;
      const perfil = enVueloAhora
        ? `lote de ${enVueloAhora.trozos} trozo(s), hasta ${enVueloAhora.maxTokens} tokens por trozo`
        : 'el worker NUNCA llegó a empezarla (sigue ocupado con la anterior o cargando)';
      console.error(
        `${LOG} frase #${tarea.id}: ${TIMEOUT_MS / 1000} s agotados — ${perfil}. ` +
          'generate() no se puede interrumpir, así que la cancelación sólo surtirá efecto ' +
          `cuando el lote termine por su cuenta; si no lo hace en ${TIMEOUT_RESCATE_MS / 1000} s ` +
          'se reinicia el worker y TODO lo encolado se pierde de golpe.'
      );
      onError?.(
        `La traducción ${tarea.id} superó ${TIMEOUT_MS / 1000} s y se descartó (${perfil}).`
      );
      // Se deja de esperar, pero no se finge que el worker está libre.
      resolverPendiente(tarea.id, { traduccion: '', motivo: 'tiempo agotado' });
      worker?.postMessage({ type: 'CANCELAR', id: tarea.id });
      armarRescate(tarea.id);
    }, TIMEOUT_MS);

    pendientes.set(tarea.id, { resolver: tarea.resolver, temporizador });
    idEnVuelo = tarea.id;
    worker.postMessage({ type: 'TRADUCIR', id: tarea.id, texto: tarea.texto });
  }

  // ÚNICO punto donde se declara libre el worker, y sólo para el id correcto.
  function liberarSi(id) {
    if (id !== idEnVuelo) {
      console.warn(`${LOG} mensaje CADUCADO de la frase #${id} (en vuelo: #${idEnVuelo}). Se ignora.`);
      return false;
    }
    pararRescate();
    idEnVuelo = null;
    trabajoEnVuelo = null;
    enVuelo = false;
    return true;
  }

  let rescate = null;
  function pararRescate() {
    if (rescate === null) return;
    clearTimeout(rescate);
    rescate = null;
  }
  function armarRescate(id) {
    pararRescate();
    rescate = setTimeout(() => {
      rescate = null;
      if (idEnVuelo !== id) return;
      console.error(`${LOG} el worker no soltó la frase #${id} tras cancelarla. Se reinicia.`);
      const opciones = ultimasOpciones;
      destruir();
      if (opciones) iniciar(opciones);
    }, TIMEOUT_RESCATE_MS);
  }

  function resolverPendiente(id, resultado) {
    const pendiente = pendientes.get(id);
    if (!pendiente) return;
    clearTimeout(pendiente.temporizador);
    pendientes.delete(id);
    pendiente.resolver(resultado);

    if (pendientes.size === 0 && cola.length === 0) onActividad?.(false);
  }

  // Resuelve todo lo pendiente cuando el modelo se cae: nadie se queda colgado.
  function fallarTodo(motivo) {
    for (const [id] of pendientes) {
      resolverPendiente(id, { traduccion: '', motivo });
    }
    while (cola.length) {
      cola.shift().resolver({ traduccion: '', motivo });
    }
    pararRescate();
    idEnVuelo = null;
    trabajoEnVuelo = null;
    enVuelo = false;
  }

  /* --------------------------- Limpieza --------------------------- */

  function destruir() {
    pararVigilante();
    fallarTodo('traductor detenido');
    if (worker) {
      worker.onmessage = null;
      worker.onerror = null;
      worker.terminate();
      worker = null;
    }
    fijarEstado(ESTADO_TRADUCTOR.INACTIVO, { detalle: '' });
  }

  return {
    iniciar,
    traducir,
    destruir,
    obtenerEstado: () => estado
  };
}
