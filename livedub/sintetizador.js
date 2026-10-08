// sintetizador.js
// Capa fina de orquestación entre offscreen.js y el worker de voz.
// Mismo patrón que transcriptor.js y traductor.js: no sabe de audio ni de UI,
// recibe texto en español y devuelve una onda.
//
// Degradación independiente: si el modelo de voz no carga, el estado queda en
// 'error' y la transcripción y la traducción siguen funcionando sin enterarse.

export const ESTADO_SINTETIZADOR = {
  INACTIVO: 'inactivo',
  CARGANDO: 'cargando',
  LISTO: 'listo',
  ERROR: 'error'
};

const RUTA_WORKER = 'sintetizador-worker.js';

// La cola es CORTA a propósito. Si el doblaje se retrasa mucho respecto al
// vídeo deja de ser útil: más vale descartar frases viejas que acumular una
// cola de voz que suene medio minuto tarde.
const MAX_EN_COLA = 2;

const TIMEOUT_MS = 30000; // por frase
const TIMEOUT_CARGA_MS = 90000; // vigilante de carga, igual que en el traductor

const LOG = '[LiveDub][sintetizador]';

export function crearSintetizador({ onEstado, onActividad, onError } = {}) {
  let worker = null;
  let estado = ESTADO_SINTETIZADOR.INACTIVO;
  let siguienteId = 1;

  const cola = []; // { id, texto, resolver }
  const pendientes = new Map();
  let enVuelo = false;
  let vigilanteCarga = null;

  function fijarEstado(nuevo, detalle = {}) {
    const anterior = estado;
    estado = nuevo;
    if (nuevo !== anterior) console.log(`${LOG} estado: ${anterior} → ${nuevo}`, detalle.detalle || '');
    if (nuevo === ESTADO_SINTETIZADOR.LISTO || nuevo === ESTADO_SINTETIZADOR.ERROR) pararVigilante();
    onEstado?.({ estado: nuevo, ...detalle });
  }

  function pararVigilante() {
    if (vigilanteCarga === null) return;
    clearTimeout(vigilanteCarga);
    vigilanteCarga = null;
  }

  function armarVigilante() {
    pararVigilante();
    vigilanteCarga = setTimeout(() => {
      vigilanteCarga = null;
      if (estado === ESTADO_SINTETIZADOR.LISTO || estado === ESTADO_SINTETIZADOR.ERROR) return;
      console.error(`${LOG} el modelo de voz no terminó de cargar en ${TIMEOUT_CARGA_MS / 1000} s.`);
      fijarEstado(ESTADO_SINTETIZADOR.ERROR, { detalle: 'Tiempo agotado al cargar la voz.' });
      fallarTodo('tiempo agotado al cargar la voz');
    }, TIMEOUT_CARGA_MS);
  }

  /* ---------------------- Arranque del worker --------------------- */

  function iniciar({ rutaModelos, rutaWasm, modelo }) {
    if (worker) return;

    console.log(`${LOG} iniciando worker`, { modelo, rutaModelos });
    fijarEstado(ESTADO_SINTETIZADOR.CARGANDO, { detalle: 'Cargando voz local…' });
    armarVigilante();

    try {
      worker = new Worker(chrome.runtime.getURL(RUTA_WORKER), { type: 'module' });
    } catch (error) {
      console.error(`${LOG} no se pudo crear el worker:`, error);
      fijarEstado(ESTADO_SINTETIZADOR.ERROR, {
        detalle: `No se pudo crear el worker de voz: ${error?.message || error}`
      });
      return;
    }

    worker.onmessage = (evento) => manejarMensaje(evento.data || {});

    worker.onmessageerror = (evento) => {
      console.error(`${LOG} mensaje ilegible del worker:`, evento);
      fijarEstado(ESTADO_SINTETIZADOR.ERROR, { detalle: 'Mensaje ilegible del worker de voz.' });
      fallarTodo('mensaje ilegible del worker de voz');
    };

    worker.onerror = (evento) => {
      console.error(`${LOG} fallo del worker:`, evento?.message || evento);
      fijarEstado(ESTADO_SINTETIZADOR.ERROR, {
        detalle: `Fallo en el worker de voz: ${evento?.message || 'error desconocido'}`
      });
      fallarTodo('El worker de voz se detuvo.');
    };

    worker.postMessage({ type: 'INIT', rutaModelos, rutaWasm, modelo });
  }

  /* ---------------------- Mensajes del worker --------------------- */

  function manejarMensaje(mensaje) {
    switch (mensaje.type) {
      case 'PROGRESO':
        if (estado !== ESTADO_SINTETIZADOR.LISTO) {
          fijarEstado(ESTADO_SINTETIZADOR.CARGANDO, {
            detalle:
              mensaje.porcentaje !== null && mensaje.porcentaje !== undefined
                ? `Cargando voz local… ${mensaje.porcentaje}%`
                : 'Cargando voz local…'
          });
        }
        break;

      case 'LISTO':
        console.log(`${LOG} worker listo con el modelo "${mensaje.modelo}"`);
        fijarEstado(ESTADO_SINTETIZADOR.LISTO, { detalle: `Voz lista (${mensaje.modelo})` });
        procesarCola();
        break;

      case 'RESULTADO':
        resolverPendiente(mensaje.id, {
          audio: mensaje.audio ? new Float32Array(mensaje.audio) : null,
          hz: mensaje.hz,
          trozos: mensaje.trozos,
          duracionMs: mensaje.duracionMs
        });
        enVuelo = false;
        procesarCola();
        break;

      case 'ERROR':
        console.error(`${LOG} error del worker (fase ${mensaje.fase}):`, mensaje.error);
        if (mensaje.fase === 'carga' || mensaje.fase === 'worker') {
          fijarEstado(ESTADO_SINTETIZADOR.ERROR, { detalle: traducirErrorModelo(mensaje.error) });
          fallarTodo(mensaje.error);
        } else {
          onError?.(mensaje.error);
          resolverPendiente(mensaje.id, { audio: null, motivo: mensaje.error });
          enVuelo = false;
          procesarCola();
        }
        break;

      default:
        break;
    }
  }

  // Mismos casos que en los otros dos módulos, con el texto adaptado.
  function traducirErrorModelo(bruto) {
    const texto = String(bruto || '');
    if (/protobuf|InvalidProtobuf|corrupt|Failed to load model/i.test(texto)) {
      return 'El modelo de voz está corrupto o incompleto: vuelve a ejecutar models/descargar-modelo-voz.sh. Los subtítulos siguen funcionando.';
    }
    if (/Unable to load from local path|Failed to fetch|404|not found|Could not locate|no such file|Faltan archivos/i.test(texto)) {
      return 'Faltan los archivos de la voz en livedub/models/mms-tts-spa/ (ver models/README.md). Los subtítulos siguen funcionando.';
    }
    if (/wasm|WebAssembly|magic word|CompileError/i.test(texto)) {
      return 'No se pudo iniciar WebAssembly para la voz. Los subtítulos siguen funcionando.';
    }
    if (/memory|allocation|RangeError/i.test(texto)) {
      return 'Memoria insuficiente para el modelo de voz. Los subtítulos siguen funcionando.';
    }
    return texto.length > 160 ? `${texto.slice(0, 157)}…` : texto;
  }

  /* ------------------------- Cola de textos ----------------------- */

  // Devuelve una promesa que SIEMPRE se resuelve: si no se puede sintetizar,
  // devuelve { audio: null, motivo }. El subtítulo se publica igual.
  function sintetizar(texto) {
    if (!texto) return Promise.resolve({ audio: null, motivo: 'texto vacío' });

    if (estado === ESTADO_SINTETIZADOR.ERROR) {
      return Promise.resolve({ audio: null, motivo: 'voz no disponible' });
    }
    if (estado === ESTADO_SINTETIZADOR.INACTIVO) {
      return Promise.resolve({ audio: null, motivo: 'voz no iniciada' });
    }

    const id = siguienteId++;
    return new Promise((resolver) => {
      cola.push({ id, texto, resolver });

      while (cola.length > MAX_EN_COLA) {
        const viejo = cola.shift();
        console.warn(`${LOG} frase #${viejo.id} descartada: el doblaje iba muy por detrás.`);
        viejo.resolver({ audio: null, motivo: 'descartada por ir muy retrasada' });
      }

      procesarCola();
    });
  }

  function procesarCola() {
    if (!worker || enVuelo || estado !== ESTADO_SINTETIZADOR.LISTO) return;

    const tarea = cola.shift();
    if (!tarea) return;

    enVuelo = true;
    onActividad?.(true);

    const temporizador = setTimeout(() => {
      onError?.(`La síntesis ${tarea.id} superó ${TIMEOUT_MS / 1000} s y se descartó.`);
      resolverPendiente(tarea.id, { audio: null, motivo: 'tiempo agotado' });
      enVuelo = false;
      procesarCola();
    }, TIMEOUT_MS);

    pendientes.set(tarea.id, { resolver: tarea.resolver, temporizador });
    worker.postMessage({ type: 'SINTETIZAR', id: tarea.id, texto: tarea.texto });
  }

  function resolverPendiente(id, resultado) {
    const pendiente = pendientes.get(id);
    if (!pendiente) return;
    clearTimeout(pendiente.temporizador);
    pendientes.delete(id);
    pendiente.resolver(resultado);
    if (pendientes.size === 0 && cola.length === 0) onActividad?.(false);
  }

  function fallarTodo(motivo) {
    for (const [id] of pendientes) resolverPendiente(id, { audio: null, motivo });
    while (cola.length) cola.shift().resolver({ audio: null, motivo });
    enVuelo = false;
  }

  /* --------------------------- Limpieza --------------------------- */

  function destruir() {
    pararVigilante();
    fallarTodo('voz detenida');
    if (worker) {
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      worker.terminate();
      worker = null;
    }
    fijarEstado(ESTADO_SINTETIZADOR.INACTIVO, { detalle: '' });
  }

  return {
    iniciar,
    sintetizar,
    destruir,
    obtenerEstado: () => estado
  };
}
