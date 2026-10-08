// cronometro.js
// Mide, frase a frase, dónde se va el tiempo entre que alguien habla en
// inglés y que suena el doblaje en español.
//
// PARA QUÉ EXISTE
// El desfase medido a ojo era de "unos 15 segundos", pero esa cifra sola no
// dice nada, porque no se sabía desde dónde se contaba. Este módulo responde
// con números a la pregunta exacta:
//
//   · ¿15 s desde que EMPIEZA la frase en inglés?  → el grueso es la espera
//     del VAD, que es tiempo irreducible mientras haya que oír la frase
//     entera antes de traducirla.
//   · ¿15 s desde que TERMINA la frase en inglés?  → entonces el VAD no
//     cuenta y el problema está en Whisper + traducción + colas, que
//     deberían costar 3-5 s. Sería un diagnóstico muy distinto.
//
// Las dos cifras se calculan y se muestran por separado, para que no haya
// que volver a suponerlo nunca más.
//
// NO ALTERA NADA. Sólo anota marcas de tiempo. Si se quita, el doblaje
// funciona igual.
//
// POR QUÉ SE INDEXA POR ID Y NO POR UNA COLA FIFO
// Ya hay una cola FIFO corta en offscreen.js (duracionesOrigen) y sirve para
// lo suyo, pero aquí no vale: si una frase se descarta o falla, la FIFO se
// desincroniza y todas las medidas posteriores quedarían mal atribuidas, que
// es peor que no medir. El transcriptor ya asigna un id a cada frase; se usa
// ése para correlacionar las etapas sin ambigüedad.

const LOG = '[LiveDub][cronómetro]';

// Cuántas frases se guardan. 40 cubre de sobra una prueba de 5 minutos.
const MAX_FRASES = 40;

export const MOTIVO_CIERRE = {
  SILENCIO: 'silencio',
  TOPE: 'tope de 12 s'
};

export function crearCronometro({ ahora = () => Date.now() } = {}) {
  /** @type {Map<number, object>} frases vivas, por id del transcriptor */
  const vivas = new Map();
  /** @type {object[]} frases ya terminadas, en orden */
  const historial = [];

  let activo = true;

  /**
   * Una frase acaba de cerrarse en el VAD y sale hacia Whisper.
   * @param {number} id            el que devuelve transcriptor.transcribir()
   * @param {number} tInicioHabla  cuándo llegó el primer bloque con voz
   * @param {number} segundosAudio duración del audio capturado
   * @param {string} motivoCierre  MOTIVO_CIERRE.SILENCIO o .TOPE
   */
  function abrir(id, { tInicioHabla, segundosAudio, motivoCierre }) {
    if (!activo || id === undefined || id === null) return;
    vivas.set(id, {
      id,
      tInicioHabla,
      tFinHabla: ahora(),
      segundosAudio,
      motivoCierre,
      tFinAsr: null,
      tFinMt: null,
      tInicioVoz: null,
      tFinVoz: null,
      caracteres: null,
      texto: null,
      traduccion: null
    });
  }

  function marcar(id, etapa, extra = {}) {
    const f = vivas.get(id);
    if (!f) return false;
    f[etapa] = ahora();
    Object.assign(f, extra);
    return true;
  }

  /** La frase terminó su recorrido (sonó, o se perdió por el camino). */
  function cerrar(id, { motivoFinal = null } = {}) {
    const f = vivas.get(id);
    if (!f) return null;
    vivas.delete(id);
    f.motivoFinal = motivoFinal;
    historial.push(f);
    while (historial.length > MAX_FRASES) historial.shift();
    return f;
  }

  /** Una frase que nunca llegará a sonar: se anota igual, para que se vea. */
  function abandonar(id, motivo) {
    return cerrar(id, { motivoFinal: motivo });
  }

  // ─── Lectura ─────────────────────────────────────────────────────────

  /**
   * Desglose por frase. Los dos desfases van en columnas separadas: es
   * justo la ambigüedad que había que resolver.
   */
  function filas() {
    return historial.map((f) => {
      const ms = (a, b) => (a !== null && b !== null ? Math.round(b - a) : null);
      return {
        '#': f.id,
        'duración frase (s)': f.segundosAudio !== null ? Number(f.segundosAudio.toFixed?.(2) ?? f.segundosAudio) : null,
        'cerró por': f.motivoCierre,
        'Whisper (ms)': ms(f.tFinHabla, f.tFinAsr),
        'traducción (ms)': ms(f.tFinAsr, f.tFinMt),
        'espera hasta hablar (ms)': ms(f.tFinMt, f.tInicioVoz),
        'DESFASE desde FIN (s)': segundos(ms(f.tFinHabla, f.tInicioVoz)),
        'DESFASE desde INICIO (s)': segundos(ms(f.tInicioHabla, f.tInicioVoz)),
        'resultado': f.motivoFinal || 'doblada'
      };
    });
  }

  function segundos(milis) {
    return milis === null ? null : Number((milis / 1000).toFixed(2));
  }

  function mediana(lista) {
    const limpia = lista.filter((v) => typeof v === 'number' && Number.isFinite(v)).sort((a, b) => a - b);
    if (!limpia.length) return null;
    return limpia[Math.floor(limpia.length / 2)];
  }

  /**
   * El resumen que responde al paso 0. Medianas, no medias: una sola frase
   * rara no debe mover la cifra.
   */
  function resumen() {
    const dobladas = historial.filter((f) => f.tInicioVoz !== null);

    if (!dobladas.length) {
      return { frases: 0, aviso: 'Todavía no se ha doblado ninguna frase.' };
    }

    const desdeFin = dobladas.map((f) => f.tInicioVoz - f.tFinHabla);
    const desdeInicio = dobladas.map((f) => f.tInicioVoz - f.tInicioHabla);
    const asr = dobladas.map((f) => (f.tFinAsr ? f.tFinAsr - f.tFinHabla : null));
    const mt = dobladas.map((f) => (f.tFinMt && f.tFinAsr ? f.tFinMt - f.tFinAsr : null));
    const espera = dobladas.map((f) => (f.tInicioVoz && f.tFinMt ? f.tInicioVoz - f.tFinMt : null));
    const duracion = dobladas.map((f) => f.segundosAudio * 1000);

    const porTope = historial.filter((f) => f.motivoCierre === MOTIVO_CIERRE.TOPE).length;

    return {
      frases: historial.length,
      dobladas: dobladas.length,
      perdidas: historial.length - dobladas.length,
      'cerradas por el tope de 12 s': `${porTope} de ${historial.length}`,

      // LA RESPUESTA AL PASO 0
      'DESFASE desde que TERMINA la frase (mediana, s)': segundos(mediana(desdeFin)),
      'DESFASE desde que EMPIEZA la frase (mediana, s)': segundos(mediana(desdeInicio)),

      // El desglose
      'duración media de la frase (s)': segundos(mediana(duracion)),
      'Whisper (mediana, s)': segundos(mediana(asr)),
      'traducción (mediana, s)': segundos(mediana(mt)),
      'espera en cola antes de hablar (mediana, s)': segundos(mediana(espera))
    };
  }

  /**
   * Explicación en texto llano de qué significan los números. La escribe el
   * propio código para que no haya que interpretarla a mano.
   */
  function explicacion() {
    const r = resumen();
    if (!r.dobladas) return 'Sin datos todavía: deja correr el vídeo con el doblaje activo.';

    const fin = r['DESFASE desde que TERMINA la frase (mediana, s)'];
    const ini = r['DESFASE desde que EMPIEZA la frase (mediana, s)'];
    const dur = r['duración media de la frase (s)'];
    const asr = r['Whisper (mediana, s)'];
    const mt = r['traducción (mediana, s)'];
    const espera = r['espera en cola antes de hablar (mediana, s)'];

    const lineas = [
      `Frases medidas: ${r.dobladas} dobladas de ${r.frases}.`,
      '',
      `Desde que TERMINA de hablar el inglés hasta que suena el español: ${fin} s.`,
      `Desde que EMPIEZA a hablar el inglés hasta que suena el español: ${ini} s.`,
      '',
      'De esos segundos:',
      `  · ${dur} s es lo que dura la propia frase (hay que oírla entera antes de traducirla).`,
      `  · ${asr} s los tarda Whisper en transcribir.`,
      `  · ${mt} s la traducción.`,
      `  · ${espera} s esperando turno para hablar.`,
      ''
    ];

    // El diagnóstico, dicho sin rodeos.
    if (fin !== null && fin > 6) {
      lineas.push(
        'DIAGNÓSTICO: el retraso DESPUÉS de que la frase termine ya es grande. ' +
          'El cuello de botella NO es la espera del VAD, sino el procesamiento ' +
          '(Whisper, traducción o cola). Ahí hay margen real de mejora.'
      );
    } else if (ini !== null && dur !== null && dur / ini > 0.6) {
      lineas.push(
        'DIAGNÓSTICO: la mayor parte del desfase es la DURACIÓN DE LA PROPIA FRASE. ' +
          'El procesamiento va fino. Para bajar el desfase habría que acortar las ' +
          'frases (tope del VAD), con el coste de calidad que eso tenga.'
      );
    } else {
      lineas.push(
        'DIAGNÓSTICO: el tiempo está repartido entre la duración de la frase y el ' +
          'procesamiento. Mira el desglose de arriba para ver cuál pesa más.'
      );
    }

    return lineas.join('\n');
  }

  function reiniciar() {
    vivas.clear();
    historial.length = 0;
    console.log(`${LOG} mediciones borradas.`);
  }

  return {
    abrir,
    marcar,
    cerrar,
    abandonar,
    filas,
    resumen,
    explicacion,
    reiniciar,
    activar: (v) => {
      activo = Boolean(v);
      return activo;
    },
    estaActivo: () => activo,
    vivas: () => vivas.size,
    total: () => historial.length
  };
}
