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
// Cuántas frases se guardan en la tabla. Subido de 40 a 200 el 8-oct-2026:
// con 40, una tanda de 5 minutos (60-70 frases) perdía de vista la primera
// mitad y las medianas sólo describían el final. Cada frase guardada son unos
// pocos cientos de bytes, así que 200 no es nada y cubre una tanda larga.
const MAX_FRASES = 200;

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
  // Último instante en que se cerró una frase en el VAD. Sirve para medir el
  // hueco de llegada en orden, sin depender de cuándo acabe cada frase.
  let ultimoFinHabla = null;

  // Contadores de CONTENIDO PERDIDO, por etapa. No son lo mismo que un
  // retraso: esto es audio del vídeo que nadie va a oír doblado.
  const perdidas = [];

  // Ids que salieron de la tabla por antigüedad, no por pérdida.
  //
  // REGRESIÓN DEL 8-OCT-2026, Y ERA DE LA PROPIA VERIFICACIÓN. En una tanda
  // de 61 frases SIN NINGUNA PÉRDIDA REAL, verificacionCruzada() decía
  // "21 frases desaparecieron sin que ningún contador las recogiera". Las 21
  // eran 61 − 40: las que el tope del historial había ido tirando por viejas.
  // idsVistos crecía sin límite y la tabla no, así que la resta daba fuga
  // donde sólo había olvido.
  //
  // El aviso en sí hizo su trabajo —dijo "no te fíes de mí" y tenía razón en
  // no ser fiable—, pero señalaba a la tubería cuando el problema estaba en
  // el instrumento. Ahora se distingue lo uno de lo otro.
  const idsRetirados = new Set();

  // TODOS los ids que han entrado alguna vez. Sirve para detectar frases que
  // se evaporaron sin pasar por ningún contador: si un id entró y no está ni
  // en la tabla ni viva ni contado como pérdida, hay una fuga que no
  // conocemos. Es la red de seguridad sobre la propia instrumentación.
  const idsVistos = new Set();

  /**
   * Una frase acaba de cerrarse en el VAD y sale hacia Whisper.
   * @param {number} id            el que devuelve transcriptor.transcribir()
   * @param {number} tInicioHabla  cuándo llegó el primer bloque con voz
   * @param {number} segundosAudio duración del audio capturado
   * @param {string} motivoCierre  MOTIVO_CIERRE.SILENCIO o .TOPE
   */
  function abrir(id, { tInicioHabla, segundosAudio, motivoCierre }) {
    if (!activo || id === undefined || id === null) return;

    // EL HUECO SE MIDE AQUÍ, AL LLEGAR LA FRASE, NO AL CERRARLA.
    //
    // Antes se calculaba en cerrar() contra la última frase del historial, y
    // eso daba huecos NEGATIVOS: una frase que falla (p. ej. no se traduce)
    // se cierra al instante, mientras que la anterior sigue hablando y se
    // cierra después. El historial quedaba desordenado y la resta salía al
    // revés. Es lo que producía el -117 % de la fila #22.
    //
    // El orden de LLEGADA sí es siempre monótono, así que el hueco medido
    // aquí no puede salir negativo pase lo que pase aguas abajo.
    idsVistos.add(id);
    const tFinHabla = ahora();
    const intervaloMs = ultimoFinHabla === null ? null : tFinHabla - ultimoFinHabla;
    ultimoFinHabla = tFinHabla;

    vivas.set(id, {
      id,
      tInicioHabla,
      tFinHabla,
      intervaloMs,
      segundosAudio,
      motivoCierre,
      tFinAsr: null,
      tFinMt: null,
      tInicioVoz: null,
      tFinVoz: null,
      tDecision: null,
      seIntentoTraducir: null,
      motivoNoTraducir: null,
      caracteres: null,
      texto: null,
      traduccion: null,
      trozosMt: null,
      maxTokensMt: null,
      // ESTADO DEL RECORTE EN EL MOMENTO DE PROCESAR ESTA FRASE.
      //
      // Se guarda por frase, no por sesión, porque ya hubo DOS tandas en las
      // que no quedó claro si el recorte estaba activo y las dos quedaron
      // inservibles. Depender de que alguien recuerde qué comando escribió y
      // en qué orden no es un método de medición.
      //
      // null = la frase se procesó antes de que existiera esta columna.
      recorteActivo: null,
      reduccionRecorte: null,
      traduccionSinRecortar: null,
      // El texto que de verdad SALIÓ POR EL ALTAVOZ. Distinto de
      // `traduccion` cuando el recorte lo cambió, y es el que hay que usar
      // para calcular el ritmo real de habla de esta frase.
      traduccionHablada: null,
      trozosAsr: null,
      sospechosaAlucinacion: false,
      // ms de cada llamada a generate() de esta frase, en orden. Con el
      // total solo no se distingue "muchos grupos normales" de "uno atascado".
      gruposMt: null
    });
  }

  /**
   * Tamaño del lote que el traductor tiene dentro de generate().
   *
   * No lleva marca de tiempo, por eso no pasa por marcar(): es un dato de
   * CARGA DE TRABAJO, no de instante. Se anota en cuanto el worker avisa de
   * que empieza, para que una frase que luego agote el tiempo deje escrito
   * cuánto trabajo había pedido. Sin esto, una traducción de 30 s es un
   * número sin explicación.
   */
  function anotarLote(id, { trozos = null, maxTokens = null } = {}) {
    const f = vivas.get(id);
    if (!f) return false;
    f.trozosMt = trozos;
    f.maxTokensMt = maxTokens;
    return true;
  }

  /**
   * Deja constancia de si el recorte estaba encendido cuando se procesó esta
   * frase. Como anotarLote(), no lleva marca de tiempo y por eso no pasa por
   * marcar(): es un dato de configuración, no de instante.
   */
  /** Diagnóstico de alucinación de esta frase (describe, no decide). */
  /** Duración de cada grupo de generate() de esta frase. */
  function anotarGrupos(id, grupos) {
    const f = vivas.get(id);
    if (!f || !Array.isArray(grupos) || !grupos.length) return false;
    f.gruposMt = grupos;
    return true;
  }

  function anotarAlucinacion(id, diagnostico) {
    const f = vivas.get(id);
    if (!f) return false;
    f.trozosAsr = diagnostico?.total ?? null;
    f.sospechosaAlucinacion = Boolean(diagnostico?.esSospechosa);
    return true;
  }

  function anotarRecorte(
    id,
    { activo = null, reduccion = null, sinRecortar = null, hablada = null } = {}
  ) {
    const f = vivas.get(id);
    if (!f) return false;
    if (activo !== null) f.recorteActivo = Boolean(activo);
    if (reduccion !== null) f.reduccionRecorte = reduccion;
    if (sinRecortar !== null) f.traduccionSinRecortar = sinRecortar;
    if (hablada !== null) f.traduccionHablada = hablada;
    return true;
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
    // Al sacar una frase de la tabla por antigüedad hay que ANOTARLO. Si no,
    // la verificación cruzada la ve desaparecida y la cuenta como fuga.
    while (historial.length > MAX_FRASES) {
      const retirada = historial.shift();
      if (retirada && retirada.id !== undefined) idsRetirados.add(retirada.id);
    }
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
        // Cuántas oraciones iban en el mismo lote de generate(). El habla
        // normal da 1-2; decenas delatan una alucinación repetitiva y
        // explican una traducción desbocada.
        'trozos MT': f.trozosMt,
        '¿alucinación?': f.sospechosaAlucinacion ? 'SOSPECHOSA' : '',
        // El grupo más caro de la frase. Es el tiempo durante el cual el
        // worker estuvo ciego y sordo: ni cancelación ni presupuesto.
        'grupo MT más caro (ms)': f.gruposMt ? Math.max(...f.gruposMt) : null,
        // El dato que vuelve interpretable cualquier tanda, incluso una en
        // la que se tocara el interruptor a mitad.
        recorte: f.recorteActivo === null ? '?' : f.recorteActivo ? 'on' : 'off',
        '−% recorte': f.reduccionRecorte === null ? null : `${(f.reduccionRecorte * 100).toFixed(1)} %`,
        'espera hasta hablar (ms)': ms(f.tFinMt, f.tInicioVoz),
        'DESFASE desde FIN (s)': segundos(ms(f.tFinHabla, f.tInicioVoz)),
        'DESFASE desde INICIO (s)': segundos(ms(f.tInicioHabla, f.tInicioVoz)),
        // Cuánto dura el doblaje hablado y cuánto se tardó en llegar a esta
        // frase desde la anterior. El cociente de ambos es lo que decide si
        // el sistema da abasto o no.
        'doblaje hablado (s)': segundos(ms(f.tInicioVoz, f.tFinVoz)),
        'hueco disponible (s)': segundos(f.intervaloMs ?? null),
        'ocupación (%)': ocupacionDe(f),
        // LA PROPORCIÓN ES/EN. Cuánto dura el doblaje en español comparado
        // con lo que duró el original en inglés. Es el número que decide si
        // el sistema puede dar abasto: por encima de 1, cada frase deja menos
        // hueco a la siguiente, y da igual lo rápido que calcule el equipo.
        'proporción ES/EN': proporcionDe(f),
        'resultado': f.motivoFinal || 'doblada'
      };
    });
  }

  /**
   * Qué porcentaje del hueco entre dos frases se come el doblaje de la
   * anterior. Por encima de 100 el sistema NO da abasto: cada frase empuja
   * a la siguiente y el retraso crece hasta que hay que descartar.
   */
  function proporcionDe(f) {
    if (f.tInicioVoz === null || f.tFinVoz === null || !f.segundosAudio) return null;
    return Number(((f.tFinVoz - f.tInicioVoz) / 1000 / f.segundosAudio).toFixed(3));
  }

  function ocupacionDe(f) {
    if (f.tInicioVoz === null || f.tFinVoz === null || !f.intervaloMs) return null;
    return Math.round(((f.tFinVoz - f.tInicioVoz) / f.intervaloMs) * 100);
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

    // ─── ¿Da abasto el canal de voz? ─────────────────────────────────
    // La voz es un recurso de UNO EN UNO: mientras habla una frase, las
    // demás esperan. Si el doblaje hablado dura más que el hueco entre
    // frases, cada una empuja a la siguiente y el retraso crece sin techo.
    const conVoz = dobladas.filter((f) => f.tFinVoz !== null && f.intervaloMs);
    const duracionVoz = conVoz.map((f) => f.tFinVoz - f.tInicioVoz);
    const intervalos = conVoz.map((f) => f.intervaloMs);
    const ocupaciones = conVoz.map((f) => ((f.tFinVoz - f.tInicioVoz) / f.intervaloMs) * 100);
    const expansiones = conVoz
      .filter((f) => f.segundosAudio > 0)
      .map((f) => (f.tFinVoz - f.tInicioVoz) / 1000 / f.segundosAudio);

    const ocupacionMediana = mediana(ocupaciones);
    const descartadas = historial.filter((f) => /descartada/i.test(f.motivoFinal || '')).length;

    // ─── ¿Cuesta Whisper lo mismo da igual la frase? ─────────────────
    // Si el coste es FIJO por frase (Whisper rellena a 30 s pase lo que
    // pase), acortar las frases NO reduce el tiempo de transcripción y en
    // cambio multiplica el número de veces que hay que pagarlo.
    const cortas = dobladas.filter((f) => f.segundosAudio < 6 && f.tFinAsr);
    const largas = dobladas.filter((f) => f.segundosAudio >= 11 && f.tFinAsr);
    const asrCortas = mediana(cortas.map((f) => f.tFinAsr - f.tFinHabla));
    const asrLargas = mediana(largas.map((f) => f.tFinAsr - f.tFinHabla));

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
      'espera en cola antes de hablar (mediana, s)': segundos(mediana(espera)),

      // ─── Capacidad ───────────────────────────────────────────────
      'duración del doblaje hablado (mediana, s)': segundos(mediana(duracionVoz)),
      'hueco entre frases (mediana, s)': segundos(mediana(intervalos)),
      'OCUPACIÓN del canal de voz (%)': ocupacionMediana === null ? null : Math.round(ocupacionMediana),
      'el español dura x veces el original':
        mediana(expansiones) === null ? null : Number(mediana(expansiones).toFixed(2)),
      'frases descartadas por retraso': descartadas,

      // ─── LÍMITE TEÓRICO ──────────────────────────────────────────
      // Qué pasaría si Whisper y la traducción fueran INSTANTÁNEOS.
      //
      // La ocupación es duración_del_doblaje ÷ hueco_entre_frases. Ninguno
      // de los dos términos depende de lo que tarde el procesamiento: el
      // hueco lo marca el VAD sobre el audio que entra, y la duración del
      // doblaje la marca lo que tarda la voz en leer el texto. Por eso la
      // cifra de abajo es IDÉNTICA a la de arriba: acelerar Whisper y la
      // traducción no cambia la ocupación ni un punto.
      'ocupación si Whisper y traducción costaran 0 ms (%)':
        ocupacionMediana === null ? null : Math.round(ocupacionMediana),
      'atraso que se acumula por frase (s)':
        mediana(duracionVoz) === null || mediana(intervalos) === null
          ? null
          : segundos(mediana(duracionVoz) - mediana(intervalos)),
      'lo que SÍ ganaría un procesamiento instantáneo (s)':
        segundos((mediana(asr) || 0) + (mediana(mt) || 0)),

      VEREDICTO: veredictoCapacidad(ocupacionMediana, descartadas),

      // ─── ¿Es el coste de Whisper fijo o proporcional? ────────────
      'Whisper en frases cortas (<6 s)': asrCortas === null ? 'sin muestras' : `${segundos(asrCortas)} s (${cortas.length})`,
      'Whisper en frases largas (≥11 s)': asrLargas === null ? 'sin muestras' : `${segundos(asrLargas)} s (${largas.length})`
    };
  }

  /**
   * Traduce la ocupación a un veredicto. Por encima del 100 % el sistema no
   * da abasto de forma ESTRUCTURAL: no es que vaya lento, es que no cabe.
   */
  function veredictoCapacidad(ocupacion, descartadas) {
    if (ocupacion === null) return 'sin datos suficientes';
    if (ocupacion >= 100) {
      return (
        'NO DA ABASTO: el doblaje hablado dura MÁS que el hueco entre frases. ' +
        'El retraso crece sin techo y sólo se frena descartando frases' +
        (descartadas ? ` (ya van ${descartadas})` : '') + '.'
      );
    }
    if (ocupacion >= 85) {
      return (
        'AL LÍMITE: el canal de voz va al ' + Math.round(ocupacion) + ' %. Cabe de media, ' +
        'pero cualquier frase un poco más larga crea un atasco que tarda en deshacerse. ' +
        'Es lo que produce los picos de espera.'
      );
    }
    return 'HAY MARGEN: el canal de voz va al ' + Math.round(ocupacion) + ' %.';
  }

  /**
   * El párrafo que responde a la pregunta del límite teórico. Se escribe
   * aquí, en el código, para que la conclusión no dependa de que alguien
   * interprete bien una tabla.
   */
  function veredictoLimiteTeorico() {
    const r = resumen();
    const ocup = r['OCUPACIÓN del canal de voz (%)'];
    if (ocup === null) return 'Sin datos suficientes para el límite teórico.';

    const ganancia = r['lo que SÍ ganaría un procesamiento instantáneo (s)'];
    const crecimiento = r['atraso que se acumula por frase (s)'];

    if (ocup < 100) {
      return (
        `Con Whisper y traducción a 0 ms la ocupación seguiría siendo del ${ocup} % ` +
        '(no depende de ellos), pero como está por debajo del 100 % el sistema cabe: ' +
        `acelerar el procesamiento ahorraría ${ganancia} s de desfase constante y no habría pérdida.`
      );
    }

    return [
      `LÍMITE TEÓRICO: aunque Whisper y la traducción fueran INSTANTÁNEOS, la ocupación`,
      `seguiría siendo del ${ocup} %, porque no depende de ellos: es la duración del`,
      'doblaje dividida por el hueco entre frases.',
      `El atraso seguiría creciendo ${crecimiento} s por frase y la pérdida de contenido`,
      'seguiría ocurriendo igual.',
      `Acelerar el procesamiento sólo recortaría ${ganancia} s de desfase CONSTANTE`,
      '(una vez, no de forma acumulativa).',
      'CONCLUSIÓN: ninguna optimización de Whisper o de la traducción puede evitar la',
      'pérdida de contenido en habla continua. El problema es la proporción entre el',
      'español y el original, no la velocidad de cálculo.'
    ].join(' ');
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

    // El canal de voz manda sobre todo lo demás: si no da abasto, da igual
    // lo rápido que vaya Whisper.
    const ocup = r['OCUPACIÓN del canal de voz (%)'];
    if (ocup !== null && ocup >= 85) {
      lineas.push(
        `CAPACIDAD: ${r.VEREDICTO}`,
        `El doblaje hablado dura ${r['duración del doblaje hablado (mediana, s)']} s y el hueco ` +
          `entre frases es de ${r['hueco entre frases (mediana, s)']} s ` +
          `(el español dura ${r['el español dura x veces el original']} veces el original).`,
        '',
        'OJO: esto NO se arregla acortando las frases. Lo que importa es la ' +
          'PROPORCIÓN entre el doblaje y el original, y esa proporción no cambia ' +
          'por partir las frases en trozos más pequeños.',
        ''
      );
    }

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

  /** Registra contenido perdido en cualquier etapa de la tubería. */
  function anotarPerdida({
    id = null,
    segundos = null,
    etapa = 'desconocida',
    detalle = '',
    // Una PÉRDIDA PARCIAL no termina la frase: la mitad traducida se va a
    // doblar igual y su desfase hay que seguir midiéndolo. Si se cerrase
    // aquí, la frase saldría de la tabla antes de sonar y las columnas de
    // voz quedarían vacías. Por defecto sí se cierra, que es el caso normal.
    cerrarFrase = true
  }) {
    perdidas.push({ id, segundos, etapa, detalle, cuando: ahora() });
    while (perdidas.length > MAX_FRASES * 2) perdidas.shift();
    if (cerrarFrase && id !== null && vivas.has(id)) {
      cerrar(id, { motivoFinal: `PERDIDA en ${etapa}: ${detalle}` });
    }
  }

  /**
   * VERIFICACIÓN CRUZADA. ¿Cuadra el contador de pérdidas con los huecos
   * que hay en la numeración de las frases?
   *
   * La numeración la asigna el transcriptor y es consecutiva. Si falta un
   * número en la tabla, esa frase existió y desapareció. Si el contador de
   * pérdidas no la recoge, es que hay una fuga por una vía que todavía no
   * conocemos — y entonces el propio contador no es de fiar.
   */
  function verificacionCruzada() {
    const enTabla = new Set(historial.map((f) => f.id));
    const contadas = new Set(perdidas.map((p) => p.id).filter((i) => i !== null));

    const faltan = [...idsVistos]
      .filter((id) => !enTabla.has(id) && !vivas.has(id) && !idsRetirados.has(id))
      .sort((a, b) => a - b);
    const sinExplicar = faltan.filter((id) => !contadas.has(id));

    // Huecos en la numeración: ids que ni siquiera llegaron a abrirse.
    const todos = [...idsVistos].sort((a, b) => a - b);
    const huecosNumeracion = [];
    for (let i = 1; i < todos.length; i++) {
      for (let n = todos[i - 1] + 1; n < todos[i]; n++) huecosNumeracion.push(n);
    }

    const totalFrases = idsVistos.size + huecosNumeracion.length;
    const totalPerdidas = perdidas.length + huecosNumeracion.length;

    return {
      'frases que entraron': idsVistos.size,
      'frases en la tabla': enTabla.size,
      'frases aún en curso': vivas.size,
      'huecos en la numeración': huecosNumeracion.length,
      'pérdidas registradas por el contador': perdidas.length,
      'frases retiradas de la tabla por antigüedad': idsRetirados.size,
      'PORCENTAJE PERDIDO': totalFrases
        ? `${((totalPerdidas / totalFrases) * 100).toFixed(1)} %`
        : 'sin datos',
      '¿cuadra el contador?':
        sinExplicar.length === 0 && huecosNumeracion.length === 0
          ? 'SÍ — todas las frases están explicadas'
          : `NO — ${sinExplicar.length + huecosNumeracion.length} frases desaparecieron sin que ningún ` +
            'contador las recogiera. Hay una vía de pérdida sin identificar.',
      'ids sin explicar': [...sinExplicar, ...huecosNumeracion].sort((a, b) => a - b)
    };
  }

  /**
   * COMPARACIÓN on/off DEL RECORTE, hecha por el programa.
   *
   * Parte el historial en dos según el estado real del interruptor cuando se
   * procesó cada frase y compara lo único que importa: la proporción ES/EN y
   * la ocupación. Así una tanda en la que se tocara el interruptor a mitad
   * deja de ser basura — se lee por grupos — y una tanda homogénea lo dice.
   *
   * No hace falta recordar nada ni fiarse de nadie: el dato va en la frase.
   */
  function compararRecorte() {
    const conVoz = historial.filter((f) => f.tInicioVoz !== null && f.tFinVoz !== null);

    const grupo = (activo) => {
      const filas = conVoz.filter((f) => f.recorteActivo === activo);
      const props = filas.map(proporcionDe).filter((v) => v !== null);
      const ocup = filas.map(ocupacionDe).filter((v) => v !== null);
      const reducciones = filas.map((f) => f.reduccionRecorte).filter((v) => typeof v === 'number');
      return {
        frases: filas.length,
        'proporción ES/EN (mediana)': props.length ? Number(mediana(props).toFixed(3)) : null,
        'ocupación % (mediana)': ocup.length ? Math.round(mediana(ocup)) : null,
        'frases por encima del 100 %': ocup.filter((v) => v > 100).length,

        // LAS DOS CIFRAS DEL RECORTE, ETIQUETADAS.
        //
        // Antes había una sola, llamada "recorte medio aplicado", y era una
        // MEDIANA. Daba 0,0 % mientras recorteEjemplos() decía 1,8 %, y
        // parecían contradecirse. No se contradicen: miden cosas distintas y
        // ahora lo dicen en el nombre.
        //
        // Y la diferencia entre las dos es el dato más interesante de la
        // tabla: si la MEDIANA es 0 % y la MEDIA no, es que a MÁS DE LA
        // MITAD de las frases el recorte no les quita ni un carácter, y lo
        // poco que ahorra sale de unas pocas frases con rodeos. Eso explica
        // por sí solo por qué el recorte no llega al 9,9 % que haría falta.
        'recorte: MEDIANA por frase': reducciones.length
          ? `${(mediana(reducciones) * 100).toFixed(1)} %`
          : 'no aplica',
        'recorte: MEDIA por frase': reducciones.length
          ? `${((reducciones.reduce((n, v) => n + v, 0) / reducciones.length) * 100).toFixed(1)} %`
          : 'no aplica',
        'frases a las que NO les quitó nada': reducciones.filter((v) => v === 0).length
      };
    };

    const on = grupo(true);
    const off = grupo(false);
    const sinMarcar = conVoz.filter((f) => f.recorteActivo === null).length;

    // El veredicto se escribe aquí y no en el chat, para que no dependa de
    // quién lo cuente.
    let veredicto;
    if (on.frases < 5 || off.frases < 5) {
      veredicto =
        'NO SE PUEDE COMPARAR TODAVÍA: hacen falta al menos 5 frases con voz en ' +
        `cada grupo (hay ${on.frases} con recorte y ${off.frases} sin él).`;
    } else if (on['proporción ES/EN (mediana)'] < 1 && off['proporción ES/EN (mediana)'] >= 1) {
      veredicto = 'EL RECORTE BASTA: con él la proporción baja de 1 y sin él no.';
    } else if (on['proporción ES/EN (mediana)'] >= 1) {
      veredicto =
        'EL RECORTE NO BASTA: aun con él, la proporción sigue en o por encima de 1, ' +
        'así que cada frase sigue dejando menos hueco a la siguiente y la pérdida ' +
        'estructural no desaparece. Hay que decidir entre aceptar pérdida residual ' +
        'o reconsiderar el búfer.';
    } else {
      veredicto = 'La proporción ya estaba por debajo de 1 sin recorte: este vídeo no es el caso difícil.';
    }

    return {
      'con recorte (on)': on,
      'sin recorte (off)': off,
      'frases sin marcar (medidas antes de existir la columna)': sinMarcar,
      veredicto
    };
  }

  /**
   * ¿QUÉ HABRÍA PASADO CON Y SIN RECORTE, SOBRE ESTAS MISMAS FRASES?
   *
   * El problema de comparar dos tandas es que no son el mismo contenido: un
   * tramo de vídeo con frases densas y otro con frases sueltas dan
   * proporciones distintas sin que el recorte tenga nada que ver. Esto lo
   * evita por completo: coge las frases REALES ya medidas y calcula cuánto
   * habría durado cada una con el texto recortado y sin él.
   *
   * No hay confusión posible con el contenido, porque el contenido es
   * exactamente el mismo en las dos columnas.
   *
   * CÓMO SE ESTIMA LA DURACIÓN. No con una constante global, sino con la
   * velocidad REAL de cada frase: milisegundos que tardó en decirse dividido
   * entre sus caracteres. Después se multiplica por los caracteres de la
   * variante. Así cada frase se mide con su propio ritmo.
   *
   * LIMITACIÓN, DICHA AQUÍ Y NO EN LETRA PEQUEÑA: esto supone que el tiempo
   * de habla es proporcional al número de caracteres DENTRO de una misma
   * frase. Es buena aproximación con un motor de voz a ritmo fijo, pero las
   * pausas de puntuación no escalan igual. Da la MAGNITUD del efecto; la
   * confirmación con audio real sigue haciendo falta.
   *
   * @param {(texto: string) => {texto: string}} recortarFn
   */
  function simularRecorte(recortarFn) {
    const usables = historial.filter(
      (f) =>
        f.tInicioVoz !== null &&
        f.tFinVoz !== null &&
        f.segundosAudio &&
        typeof (f.traduccionSinRecortar ?? f.traduccion) === 'string' &&
        (f.traduccionSinRecortar ?? f.traduccion).trim() &&
        typeof (f.traduccionHablada ?? f.traduccion) === 'string' &&
        (f.traduccionHablada ?? f.traduccion).length > 0
    );

    if (usables.length < 5) {
      return {
        frases: usables.length,
        veredicto:
          `NO HAY BASTANTES FRASES (${usables.length}). Hacen falta al menos 5 con voz ` +
          'medida y texto guardado. Deja correr el vídeo unos minutos más.'
      };
    }

    const sin = [];
    const con = [];
    const ahorros = [];
    let caracteresSin = 0;
    let caracteresCon = 0;

    for (const f of usables) {
      const original = f.traduccionSinRecortar ?? f.traduccion;
      const recortado = recortarFn(original)?.texto ?? original;

      // Ritmo real de ESTA frase, a partir de lo que de verdad se pronunció.
      const hablada = f.traduccionHablada ?? f.traduccion;
      const msPorCaracter = (f.tFinVoz - f.tInicioVoz) / hablada.length;
      const msSin = original.length * msPorCaracter;
      const msCon = recortado.length * msPorCaracter;

      caracteresSin += original.length;
      caracteresCon += recortado.length;
      ahorros.push(original.length === 0 ? 0 : (original.length - recortado.length) / original.length);

      sin.push(msSin / 1000 / f.segundosAudio);
      con.push(msCon / 1000 / f.segundosAudio);
    }

    const propSin = Number(mediana(sin).toFixed(3));
    const propCon = Number(mediana(con).toFixed(3));
    const reduccionAgregada = caracteresSin ? (caracteresSin - caracteresCon) / caracteresSin : 0;
    const necesaria = propSin > 1 ? 1 - 1 / propSin : 0;

    let veredicto;
    if (propSin <= 1) {
      veredicto =
        `Este tramo NO es el caso difícil: sin recorte la proporción ya era ${propSin}, ` +
        'por debajo de 1. No sirve para saber si el recorte basta.';
    } else if (propCon < 1) {
      veredicto =
        `EL RECORTE BASTA EN ESTE CONTENIDO: baja la proporción de ${propSin} a ${propCon}.`;
    } else {
      veredicto =
        `EL RECORTE NO BASTA: baja la proporción de ${propSin} a ${propCon}, y sigue ` +
        `en o por encima de 1. Habría hecho falta recortar un ${(necesaria * 100).toFixed(1)} % ` +
        `y recorta un ${(reduccionAgregada * 100).toFixed(1)} %.`;
    }

    return {
      frases: usables.length,
      'proporción ES/EN SIN recorte (mediana)': propSin,
      'proporción ES/EN CON recorte (mediana)': propCon,
      'recorte AGREGADO (caracteres totales)': `${(reduccionAgregada * 100).toFixed(1)} %`,
      'recorte MEDIANA por frase': `${(mediana(ahorros) * 100).toFixed(1)} %`,
      'recorte necesario para bajar de 1': `${(necesaria * 100).toFixed(1)} %`,
      'frases a las que no les quita nada': ahorros.filter((v) => v === 0).length,
      veredicto
    };
  }

  /**
   * ¿El sistema se degrada con el tiempo?
   *
   * Anderson lo describió así: "después de un tiempo empieza a hacer así".
   * En la sesión del fallo, Whisper pasó de 3-5 s a 16-25 s. Eso es un
   * factor 4-5 sobre un trabajo que es MAYORMENTE FIJO (chunk_length_s: 30,
   * Whisper rellena hasta 30 s pase lo que pase), así que no puede
   * explicarse porque las frases se hicieran más largas.
   *
   * Esta función no adivina la causa: la hace visible. Parte la sesión en
   * tres tercios por orden de llegada y compara las medianas. Si el primer
   * tercio y el último se parecen, no hay deriva y hay que buscar en otro
   * sitio; si el último es varias veces el primero, la hay.
   *
   * NOTA: esto sólo es medible desde que el historial guarda 200 frases.
   * Con el tope anterior de 40, el primer tercio de una sesión larga ya se
   * había borrado cuando se iba a mirar.
   */
  function deriva() {
    const n = historial.length;
    if (n < 9) {
      return {
        '¿se puede responder?': `NO — hacen falta al menos 9 frases y hay ${n}.`
      };
    }

    const corte = Math.floor(n / 3);
    const tercios = [
      { nombre: 'primer tercio', frases: historial.slice(0, corte) },
      { nombre: 'tercio central', frases: historial.slice(corte, n - corte) },
      { nombre: 'último tercio', frases: historial.slice(n - corte) }
    ];

    const ms = (a, b) => (a !== null && b !== null ? b - a : null);
    const tabla = tercios.map(({ nombre, frases }) => ({
      tramo: nombre,
      frases: frases.length,
      // El trabajo de entrada: si esto crece, la culpa no es de la máquina.
      'duración frase mediana (s)': mediana(frases.map((f) => f.segundosAudio)),
      'trozos MT mediana': mediana(frases.map((f) => f.trozosMt)),
      // El coste. Whisper es el testigo limpio: su trabajo es casi fijo.
      'Whisper mediana (ms)': mediana(frases.map((f) => ms(f.tFinHabla, f.tFinAsr))),
      'traducción mediana (ms)': mediana(frases.map((f) => ms(f.tFinAsr, f.tFinMt))),
      'grupo MT más caro (ms)': Math.max(
        0,
        ...frases.map((f) => (f.gruposMt ? Math.max(...f.gruposMt) : 0))
      ),
      'pérdidas': frases.filter((f) => f.motivoFinal && f.motivoFinal !== 'doblada').length
    }));

    const primero = tabla[0]['Whisper mediana (ms)'];
    const ultimo = tabla[2]['Whisper mediana (ms)'];
    const factor = primero && ultimo ? Number((ultimo / primero).toFixed(2)) : null;

    const entradaCrecio =
      tabla[0]['duración frase mediana (s)'] &&
      tabla[2]['duración frase mediana (s)'] > tabla[0]['duración frase mediana (s)'] * 1.3;

    let veredicto;
    if (factor === null) veredicto = 'NO SE SABE — falta el tiempo de Whisper en alguno de los tercios.';
    else if (factor < 1.3) veredicto = `NO — Whisper va x${factor} al final. Eso es ruido, no deriva.`;
    else if (entradaCrecio)
      veredicto =
        `OJO — Whisper va x${factor}, pero las frases TAMBIÉN se alargaron. ` +
        'Parte del aumento es trabajo de más, no degradación.';
    else
      veredicto =
        `SÍ — Whisper va x${factor} al final sobre el mismo trabajo de entrada. ` +
        'Eso es degradación, no frases más largas.';

    return {
      '¿se degrada con el tiempo?': veredicto,
      tramos: tabla,
      'cómo leer esto':
        'Whisper es el testigo limpio: su coste es casi fijo (chunk_length_s = 30), ' +
        'así que si su mediana se multiplica sin que crezca la duración de las frases, ' +
        'lo que se ha degradado es la máquina, no la entrada.'
    };
  }

  /**
   * ¿Ha habido algún EVENTO CATASTRÓFICO en esta tanda?
   *
   * Criterio 6 del encargo del 8-oct, puesto en código para que sea una
   * comprobación y no una impresión: "sin timeouts de 30+ s, sin trozos MT
   * disparados". Cada umbral viene de un fallo concreto ya vivido, y va
   * anotado con cuál.
   */
  function eventosCatastroficos() {
    const ms = (a, b) => (a !== null && b !== null ? b - a : null);
    const sucesos = [];

    for (const f of historial) {
      const tMt = ms(f.tFinAsr, f.tFinMt);
      const tAsr = ms(f.tFinHabla, f.tFinAsr);
      const vozMs = ms(f.tInicioVoz, f.tFinVoz);
      const peorGrupo = f.gruposMt ? Math.max(...f.gruposMt) : null;

      // La #3: traducción de 30002 ms que agotó el tiempo de espera.
      if (tMt !== null && tMt >= 30000) {
        sucesos.push({ '#': f.id, qué: 'traducción de 30 s o más', valor: `${Math.round(tMt)} ms` });
      }
      // El tramo degradado: Whisper de 16-25 s frente a 3-5 s habituales.
      if (tAsr !== null && tAsr >= 16000) {
        sucesos.push({ '#': f.id, qué: 'Whisper de 16 s o más', valor: `${Math.round(tAsr)} ms` });
      }
      // La #3 otra vez: 12 trozos. El habla real da 1-2, 3-4 en el peor caso.
      if (f.trozosMt !== null && f.trozosMt > 8) {
        sucesos.push({ '#': f.id, qué: 'lote de trozos disparado', valor: `${f.trozosMt} trozos` });
      }
      // Un solo grupo de generate() por encima del presupuesto: significa
      // que el worker estuvo ciego más de lo que se le permite.
      if (peorGrupo !== null && peorGrupo > 12000) {
        sucesos.push({ '#': f.id, qué: 'un grupo de generate() pasó del presupuesto', valor: `${peorGrupo} ms` });
      }
      // La #23 y la #57: el altavoz ocupado muchas veces lo que duró el audio.
      if (vozMs !== null && f.segundosAudio && vozMs / 1000 / f.segundosAudio > 3) {
        sucesos.push({
          '#': f.id,
          qué: 'el doblaje ocupó más de 3x el audio',
          valor: `${(vozMs / 1000 / f.segundosAudio).toFixed(2)}x (${(vozMs / 1000).toFixed(1)} s)`
        });
      }
    }

    return {
      '¿tanda limpia?': sucesos.length
        ? `NO — ${sucesos.length} suceso(s). La tanda NO valida nada.`
        : 'SÍ — ningún evento catastrófico en esta tanda.',
      sucesos,
      'frases en la tanda': historial.length
    };
  }

  function resumenPerdidas() {
    const porEtapa = {};
    let segundosTotales = 0;
    for (const p of perdidas) {
      porEtapa[p.etapa] = (porEtapa[p.etapa] || 0) + 1;
      if (typeof p.segundos === 'number') segundosTotales += p.segundos;
    }
    return {
      'frases perdidas': perdidas.length,
      'segundos de vídeo sin doblar': Number(segundosTotales.toFixed(1)),
      'por etapa': porEtapa,
      'porcentaje del total': (() => {
        const total = idsVistos.size;
        return total ? `${((perdidas.length / total) * 100).toFixed(1)} %` : 'sin datos';
      })(),
      detalle: perdidas.slice(-10)
    };
  }

  function reiniciar() {
    vivas.clear();
    historial.length = 0;
    perdidas.length = 0;
    idsRetirados.clear();
    idsVistos.clear();
    ultimoFinHabla = null;
    console.log(`${LOG} mediciones borradas.`);
  }

  return {
    abrir,
    marcar,
    cerrar,
    abandonar,
    // Las traducciones REALES de esta sesión, para poder enseñar ejemplos
    // de recorte sobre frases de verdad en vez de sobre frases inventadas.
    textosTraducidos: () => historial.map((f) => f.traduccion).filter((t) => typeof t === 'string' && t.trim()),
    compararRecorte,
    simularRecorte,
    anotarLote,
    anotarRecorte,
    anotarAlucinacion,
    anotarGrupos,
    eventosCatastroficos,
    deriva,
    anotarPerdida,
    resumenPerdidas,
    verificacionCruzada,
    perdidas: () => perdidas.length,
    filas,
    resumen,
    explicacion,
    veredictoLimiteTeorico,
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
