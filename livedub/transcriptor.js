// transcriptor.js
// Capa fina de orquestación entre offscreen.js y el worker de IA.
// No sabe nada de audio ni de UI: recibe Float32Array, devuelve texto.
//
// Decisiones de diseño:
//  - UNA frase en vuelo a la vez (la CPU ya va justa con WASM).
//  - Cola corta: si se acumulan frases, se descartan las más viejas. Vale más
//    perder una frase que ir acumulando retraso infinito.
//  - Si el modelo no carga, el transcriptor queda en 'error' y el resto de la
//    extensión (captura, medidor, VAD) sigue funcionando sin tocarse.

export const ESTADO_MODELO = {
  INACTIVO: 'inactivo',
  CARGANDO: 'cargando',
  LISTO: 'listo',
  ERROR: 'error'
};

const RUTA_WORKER = 'transcriptor-worker.js';
const MAX_EN_COLA = 2; // frases esperando; por encima, se tira la más antigua
const TIMEOUT_MS = 120000; // 2 min por frase: si no, damos el intento por perdido

export function crearTranscriptor({ onEstado, onActividad, onResultado, onError, onDescartada } = {}) {
  let worker = null;
  let estado = ESTADO_MODELO.INACTIVO;
  let siguienteId = 1;

  const cola = []; // { id, audio, idioma }
  let enVuelo = null; // { id, temporizador }

  function fijarEstado(nuevo, detalle = {}) {
    estado = nuevo;
    onEstado?.({ estado: nuevo, ...detalle });
  }

  /* ---------------------- Arranque del worker --------------------- */

  function iniciar({ rutaModelos, rutaWasm, modelo }) {
    if (worker) return;

    fijarEstado(ESTADO_MODELO.CARGANDO, { detalle: 'Cargando modelo local…' });

    try {
      worker = new Worker(chrome.runtime.getURL(RUTA_WORKER), { type: 'module' });
    } catch (error) {
      fijarEstado(ESTADO_MODELO.ERROR, { detalle: `No se pudo crear el worker: ${error?.message || error}` });
      return;
    }

    worker.onmessage = (evento) => manejarMensaje(evento.data || {});
    worker.onerror = (evento) => {
      fijarEstado(ESTADO_MODELO.ERROR, {
        detalle: `Fallo en el worker de transcripción: ${evento?.message || 'error desconocido'}`
      });
      cancelarEnVuelo();
    };

    worker.postMessage({ type: 'INIT', rutaModelos, rutaWasm, modelo });
  }

  /* ---------------------- Mensajes del worker --------------------- */

  function manejarMensaje(mensaje) {
    switch (mensaje.type) {
      case 'PROGRESO':
        if (estado !== ESTADO_MODELO.LISTO) {
          fijarEstado(ESTADO_MODELO.CARGANDO, {
            detalle: mensaje.porcentaje !== null && mensaje.porcentaje !== undefined
              ? `Cargando modelo local… ${mensaje.porcentaje}%`
              : 'Cargando modelo local…'
          });
        }
        break;

      case 'LISTO':
        fijarEstado(ESTADO_MODELO.LISTO, { detalle: `Modelo listo (${mensaje.modelo})` });
        procesarCola();
        break;

      case 'RESULTADO':
        cancelarEnVuelo();
        if (mensaje.texto) {
          onResultado?.({
            // El id viaja con el resultado para poder correlacionar las
            // etapas de la frase en el cronómetro. No se usa para nada más.
            id: mensaje.id,
            texto: mensaje.texto,
            idiomaDetectado: mensaje.idiomaDetectado,
            duracionMs: mensaje.duracionMs
          });
        }
        procesarCola();
        break;

      case 'ERROR':
        cancelarEnVuelo();
        if (mensaje.fase === 'carga' || mensaje.fase === 'worker') {
          // El modelo no está disponible: modo "solo captura".
          fijarEstado(ESTADO_MODELO.ERROR, { detalle: traducirErrorModelo(mensaje.error) });
          cola.length = 0;
        } else {
          onError?.(mensaje.error);
          procesarCola();
        }
        break;

      default:
        break;
    }
  }

  // Mensajes de error típicos cuando faltan los pesos o el WASM.
  function traducirErrorModelo(bruto) {
    const texto = String(bruto || '');

    // Archivo presente pero roto o a medias (visto en la prueba de Nivel 2:
    // "Failed to load model because protobuf parsing failed").
    if (/protobuf|InvalidProtobuf|corrupt|Failed to load model/i.test(texto)) {
      return 'El archivo del modelo está corrupto o incompleto: vuelve a ejecutar models/descargar-modelo.sh. La captura sigue funcionando.';
    }

    // Archivo directamente ausente (fallo A de la prueba de Nivel 2:
    // "Unable to load from local path ...: TypeError: Failed to fetch").
    if (/Unable to load from local path|Failed to fetch|404|not found|Could not locate|no such file/i.test(texto)) {
      return 'Faltan los archivos del modelo en livedub/models/whisper-tiny/ (ver README). La captura sigue funcionando.';
    }
    if (/wasm|WebAssembly|magic word|CompileError/i.test(texto)) {
      return 'No se pudo iniciar WebAssembly. La captura sigue funcionando, pero no habrá subtítulos.';
    }
    if (/memory|allocation|RangeError/i.test(texto)) {
      return 'Memoria insuficiente para cargar el modelo. La captura sigue funcionando.';
    }
    return texto.length > 160 ? `${texto.slice(0, 157)}…` : texto;
  }

  /* ------------------------- Cola de frases ----------------------- */

  function transcribir(audio, idioma = 'auto') {
    if (estado === ESTADO_MODELO.ERROR || estado === ESTADO_MODELO.INACTIVO) return null;
    if (!audio || audio.length === 0) return null;

    const id = siguienteId++;
    cola.push({ id, audio, idioma });

    // Descartamos lo más viejo si nos estamos quedando atrás.
    //
    // ESTO ERA UN DESCARTE COMPLETAMENTE SILENCIOSO: la frase recibía un id,
    // se la daba por aceptada a quien llamaba, y luego desaparecía sin dejar
    // rastro en ningún log ni en ninguna medición. Audio del vídeo que no se
    // transcribía, no se traducía, no se doblaba y de cuya existencia nadie
    // se enteraba. Ahora se avisa siempre.
    while (cola.length > MAX_EN_COLA) {
      const viejo = cola.shift();
      const segundos = (viejo.audio.length / 16000).toFixed(2);
      console.warn(
        `[LiveDub][transcriptor] ⚠ DESCARTADA la frase #${viejo.id} (${segundos} s de audio) SIN transcribir: ` +
          `había ${MAX_EN_COLA + 1} esperando y Whisper no da abasto. ` +
          'Ese trozo del vídeo no va a aparecer ni en subtítulos ni en voz.'
      );
      onDescartada?.({ id: viejo.id, segundos: Number(segundos), etapa: 'transcripción' });
    }

    procesarCola();
    return id;
  }

  function procesarCola() {
    if (!worker || enVuelo || estado !== ESTADO_MODELO.LISTO) return;

    const tarea = cola.shift();
    if (!tarea) return;

    // Sólo informativo para la UI: el estado interno sigue siendo LISTO.
    onActividad?.(true);

    const temporizador = setTimeout(() => {
      onError?.(`La transcripción de la frase ${tarea.id} tardó más de ${TIMEOUT_MS / 1000} s y se descartó.`);
      enVuelo = null;
      procesarCola();
    }, TIMEOUT_MS);

    enVuelo = { id: tarea.id, temporizador };

    // Transferimos el buffer: evitamos copiar megas de audio entre hilos.
    worker.postMessage(
      { type: 'TRANSCRIBIR', id: tarea.id, audio: tarea.audio, idioma: tarea.idioma },
      [tarea.audio.buffer]
    );
  }

  function cancelarEnVuelo() {
    if (enVuelo?.temporizador) clearTimeout(enVuelo.temporizador);
    enVuelo = null;
    // Si no queda nada pendiente, la UI vuelve a "Modelo listo".
    if (cola.length === 0 && estado === ESTADO_MODELO.LISTO) onActividad?.(false);
  }

  /* --------------------------- Limpieza --------------------------- */

  function destruir() {
    cancelarEnVuelo();
    cola.length = 0;
    if (worker) {
      worker.onmessage = null;
      worker.onerror = null;
      worker.terminate();
      worker = null;
    }
    fijarEstado(ESTADO_MODELO.INACTIVO, { detalle: '' });
  }

  return {
    iniciar,
    transcribir,
    destruir,
    obtenerEstado: () => estado
  };
}
