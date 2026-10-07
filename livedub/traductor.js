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
const TIMEOUT_MS = 30000; // 30 s por frase: si no, se da por perdida

export function crearTraductor({ onEstado, onActividad, onError } = {}) {
  let worker = null;
  let estado = ESTADO_TRADUCTOR.INACTIVO;
  let siguienteId = 1;

  const cola = []; // { id, texto, resolver }
  const pendientes = new Map(); // id -> { resolver, temporizador }
  let enVuelo = false;

  function fijarEstado(nuevo, detalle = {}) {
    estado = nuevo;
    onEstado?.({ estado: nuevo, ...detalle });
  }

  /* ---------------------- Arranque del worker --------------------- */

  function iniciar({ rutaModelos, rutaWasm, modelo }) {
    if (worker) return;

    fijarEstado(ESTADO_TRADUCTOR.CARGANDO, { detalle: 'Cargando traductor local…' });

    try {
      worker = new Worker(chrome.runtime.getURL(RUTA_WORKER), { type: 'module' });
    } catch (error) {
      fijarEstado(ESTADO_TRADUCTOR.ERROR, {
        detalle: `No se pudo crear el worker de traducción: ${error?.message || error}`
      });
      return;
    }

    worker.onmessage = (evento) => manejarMensaje(evento.data || {});
    worker.onerror = (evento) => {
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
        fijarEstado(ESTADO_TRADUCTOR.LISTO, { detalle: `Traductor listo (${mensaje.modelo})` });
        procesarCola();
        break;

      case 'RESULTADO':
        resolverPendiente(mensaje.id, {
          traduccion: mensaje.traduccion,
          duracionMs: mensaje.duracionMs
        });
        enVuelo = false;
        procesarCola();
        break;

      case 'ERROR':
        if (mensaje.fase === 'carga' || mensaje.fase === 'worker') {
          fijarEstado(ESTADO_TRADUCTOR.ERROR, { detalle: traducirErrorModelo(mensaje.error) });
          fallarTodo(mensaje.error);
        } else {
          onError?.(mensaje.error);
          resolverPendiente(mensaje.id, { traduccion: '', error: mensaje.error });
          enVuelo = false;
          procesarCola();
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
      onError?.(`La traducción ${tarea.id} superó ${TIMEOUT_MS / 1000} s y se descartó.`);
      resolverPendiente(tarea.id, { traduccion: '', motivo: 'tiempo agotado' });
      enVuelo = false;
      procesarCola();
    }, TIMEOUT_MS);

    pendientes.set(tarea.id, { resolver: tarea.resolver, temporizador });
    worker.postMessage({ type: 'TRADUCIR', id: tarea.id, texto: tarea.texto });
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
    enVuelo = false;
  }

  /* --------------------------- Limpieza --------------------------- */

  function destruir() {
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
