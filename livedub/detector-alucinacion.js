// detector-alucinacion.js
// Reconoce las alucinaciones repetitivas de Whisper antes de que lleguen al
// traductor y al altavoz.
//
// POR QUÉ EXISTE ESTE ARCHIVO
// La frase #57 de la tanda del 8-oct-2026. Whisper devolvió "Es interesante."
// repetido decenas de veces sobre 12,03 s de audio: 111 oraciones. El sistema
// lo tradujo entero y lo habló entero — 102,95 segundos de voz para 12 de
// vídeo, ocupación del 856 % — y mientras tanto la cola de voz se bloqueó y
// se perdieron 14 frases legítimas seguidas (ids 58 a 68).
//
// El lote con continuación evitó que el WORKER se bloqueara, que era el
// problema anterior, pero no evitó el daño: sólo le cambió la forma. Dejó de
// ser un worker parado 50 s y pasó a ser un altavoz ocupado 103 s.
//
// LA IDEA
// Una frase de 12,03 s no puede contener 111 oraciones. Ni 50, ni 20. Esto
// no es "texto largo": es una firma reconocible, y se puede reconocer sin
// tocar el modelo ni adivinar nada.
//
// ESTE ARCHIVO NO DECIDE NADA. Analiza y describe. Quien decide qué hacer
// con el diagnóstico es offscreen.js, y sólo si el interruptor está activado.

/* ------------------------------------------------------------------ */
/* Umbrales, y de dónde sale cada número                               */
/* ------------------------------------------------------------------ */

// Duración máxima de una frase: 47 bloques x 256 ms (MAX_FRASE_CHUNKS).
// No es un parámetro de este archivo, es un hecho del VAD.
const SEGUNDOS_MAXIMOS_DE_FRASE = 12.03;

// HAY DOS UMBRALES DISTINTOS, Y ES A PROPÓSITO.
//
// Avisar es gratis y reversible: si me equivoco, sale una línea de más en la
// consola. Cortar descarta contenido: si me equivoco, el usuario se pierde
// algo y no se entera. No tiene ningún sentido que los dos usen el mismo
// número. El de aviso puede y debe ser más estricto.
//
//   TROZOS_AVISO   =  8  → a partir de aquí se avisa
//   TROZOS_MAXIMOS = 15  → a partir de aquí se corta (si el tope está activo)
//
// Umbral de AVISO.
//
// 8-oct-2026, tarde: la frase #3 trajo 12 trozos en 12,03 s y el detector NO
// la marcó, porque 12 < 15. Y 12 oraciones en 12 s es una oración por
// segundo sostenida: no es habla.
//
// El número sale de los datos que ya tenemos: segmentador.js da 1-2 trozos
// por frase con habla real, y 3-4 en el peor caso de una frase tope a ritmo
// rápido. 8 es el DOBLE del peor caso observado — margen de sobra— y son
// 1,5 s por oración sostenidos, que ya está por debajo de lo que dura una
// oración hablada corta.
export const TROZOS_AVISO = 8;

// Tope duro de oraciones por frase.
//
// JUSTIFICACIÓN, no es un número elegido a ojo: 15 oraciones en 12,03 s son
// 0,80 s por oración SOSTENIDOS durante toda la frase. El habla natural no
// hace eso ni en un intercambio rápido de monosílabos; una oración corta
// hablada ("Sí, claro.") ya ocupa cerca de un segundo, y lo normal son 2-4 s.
// Por encima de 15 el ritmo implícito deja de ser físicamente plausible.
//
// Dicho de otro modo: este tope NO puede recortar habla real, porque el habla
// real no cabe ahí. Lo único que hay por encima son alucinaciones.
export const TROZOS_MAXIMOS = 15;

// Mínimo de oraciones para molestarse en mirar la repetición. Con 3 o 4
// trozos, repetir uno no significa nada ("No. No. No.").
const MINIMO_PARA_EVALUAR = 6;

// Proporción mínima de oraciones distintas.
//
// "Es interesante." x50 da 1/50 = 0,02. El habla real, incluso insistente,
// difícilmente baja de 0,5 a lo largo de una frase entera. Se deja en 0,4
// para dejar margen a estribillos y muletillas legítimas.
const RATIO_UNICOS_MINIMO = 0.4;

// Cuántas veces seguidas puede repetirse literalmente la misma oración.
// Tres es insistencia humana ("No. No. No."). Cuatro ya no.
const REPETICIONES_SEGUIDAS_MAXIMAS = 3;

/* --- Contar oraciones no basta: hay que mirar cuánto HABLA sale ---- */
//
// 8-oct-2026, noche. La fila #23: **8 trozos** —por debajo del umbral de
// aviso— y aun así **92 s de voz sobre 12,03 s de audio, ocupación 735 %**.
//
// Es el mismo daño que la #57 con una forma distinta: no "muchas oraciones
// cortas" sino "pocas oraciones larguísimas". Contar trozos nunca iba a
// cazar eso, porque el número de trozos no es el daño: el daño es EL TIEMPO
// QUE SE OCUPA EL ALTAVOZ. Así que se mide eso directamente.
//
// Ritmo real de la voz del sistema, MEDIDO, no estimado: 17,2 caracteres por
// segundo (docs/RENDIMIENTO-VOZ.md).
const CARACTERES_POR_SEGUNDO = 17.2;

// El texto que se analiza está en INGLÉS y lo que se va a hablar es la
// traducción al español, que dura un 11 % más (proporción ES/EN = 1,11
// medida). Se aplica ese factor para estimar sobre lo que de verdad sonará.
const FACTOR_ES_EN = 1.11;

// Cuántas veces puede durar el doblaje lo que duró el audio original.
//
// Otra vez dos umbrales, por la misma razón de siempre: avisar es gratis,
// cortar no.
//
//   La proporción ES/EN MEDIDA es 1,11 (mediana de dos tandas: 1,09 y 1,11).
//   Avisar a partir de 3x es dejar casi el TRIPLE de margen sobre lo medido.
//   Cortar a partir de 4x deja casi el cuádruple.
//
// La #23 iba a 7,6x. La #57, a 8,56x.
const PROPORCION_AVISO = 3;
const PROPORCION_CORTE = 4;

// Repetición DENTRO de un mismo trozo.
//
// Si Whisper devuelve "It is interesting it is interesting it is interesting…"
// sin puntuación, segmentador.js entrega UN SOLO trozo gigante y los tres
// criterios de repetición entre trozos no ven absolutamente nada. Se busca
// un bloque corto de palabras que se repita seguido dentro del trozo.
const PALABRAS_BLOQUE_MAXIMO = 8; // bloques de hasta 8 palabras
const REPETICIONES_INTERNAS_MAXIMAS = 3; // igual que entre trozos

// Proporción máxima que puede ocupar UNA sola oración dentro de la frase.
//
// Esto caza la repetición NO SEGUIDA, que los otros dos criterios dejan
// pasar: "A. B. A. C. A. D. A. E." tiene ratio de únicos 0,63 (por encima de
// 0,4) y nunca repite dos veces seguidas, pero la mitad de la frase es la
// misma oración. Whisper también alucina así, alternando.
const DOMINANCIA_MAXIMA = 0.5;

/* ------------------------------------------------------------------ */
/* Análisis                                                            */
/* ------------------------------------------------------------------ */

/**
 * Cuántos segundos de voz saldrían de este texto.
 * No es una estimación a ojo: 17,2 car/s medidos x 1,11 de inflación ES/EN.
 */
export function segundosDeHabla(caracteres) {
  return (caracteres * FACTOR_ES_EN) / CARACTERES_POR_SEGUNDO;
}

/**
 * Busca el bloque de palabras más repetido SEGUIDO dentro de un solo trozo.
 *
 * Devuelve {palabras, veces, desde} del bloque más repetido encontrado, o
 * null. Se prueban bloques de 1 a PALABRAS_BLOQUE_MAXIMO palabras y se queda
 * con el que más terreno cubre, que es el que de verdad infla la frase.
 */
export function repeticionInterna(trozo) {
  const palabras = normalizar(trozo).split(' ').filter(Boolean);
  let mejor = null;

  for (let k = 1; k <= Math.min(PALABRAS_BLOQUE_MAXIMO, Math.floor(palabras.length / 2)); k++) {
    for (let inicio = 0; inicio + k * 2 <= palabras.length; inicio++) {
      const bloque = palabras.slice(inicio, inicio + k).join(' ');
      let veces = 1;
      let i = inicio + k;
      while (i + k <= palabras.length && palabras.slice(i, i + k).join(' ') === bloque) {
        veces++;
        i += k;
      }
      if (veces < 2) continue;
      const cubre = veces * k;
      if (!mejor || cubre > mejor.cubre || (cubre === mejor.cubre && veces > mejor.veces)) {
        mejor = { bloque, palabras: k, veces, desde: inicio, cubre };
      }
    }
    // Si ya hemos encontrado algo que cubre casi todo, no hace falta seguir.
    if (mejor && mejor.cubre >= palabras.length * 0.9) break;
  }
  return mejor;
}

function normalizar(t) {
  return String(t || '')
    .toLowerCase()
    .replace(/[.,;:!?¡¿…"'()-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Describe un lote de oraciones. No modifica nada.
 *
 * @param {string[]} trozos  salida de trocearEnOraciones()
 * @param {{segundosAudio?: number}} contexto
 * @returns {{
 *   total: number, unicos: number, ratioUnicos: number,
 *   repeticionSeguidaMaxima: number, oracionesPorSegundo: number|null,
 *   esSospechosa: boolean, motivos: string[]
 * }}
 */
export function analizarTrozos(trozos, { segundosAudio = null } = {}) {
  const lista = Array.isArray(trozos) ? trozos.filter((t) => String(t || '').trim()) : [];
  const total = lista.length;

  const base = {
    total,
    unicos: total,
    ratioUnicos: 1,
    repeticionSeguidaMaxima: total ? 1 : 0,
    repeticionTotalMaxima: total ? 1 : 0,
    dominancia: total ? 1 : 0,
    oracionesPorSegundo: null,
    caracteres: 0,
    segundosHablaEstimados: 0,
    proporcionEstimada: 0,
    repeticionInterna: null,
    esSospechosa: false,
    superaElTopeDuro: false,
    motivos: []
  };
  if (total === 0) return base;

  const normalizados = lista.map(normalizar);
  const unicos = new Set(normalizados).size;
  const ratioUnicos = unicos / total;

  let repeticionSeguidaMaxima = 1;
  let seguidas = 1;
  for (let i = 1; i < normalizados.length; i++) {
    seguidas = normalizados[i] === normalizados[i - 1] ? seguidas + 1 : 1;
    if (seguidas > repeticionSeguidaMaxima) repeticionSeguidaMaxima = seguidas;
  }

  const segundos = segundosAudio || SEGUNDOS_MAXIMOS_DE_FRASE;
  const oracionesPorSegundo = Number((total / segundos).toFixed(2));

  // Oración más repetida, estén o no sus repeticiones seguidas.
  const cuentas = new Map();
  for (const n of normalizados) cuentas.set(n, (cuentas.get(n) || 0) + 1);
  let repeticionTotalMaxima = 0;
  let oracionDominante = '';
  for (const [texto, veces] of cuentas) {
    if (veces > repeticionTotalMaxima) {
      repeticionTotalMaxima = veces;
      oracionDominante = texto;
    }
  }
  const dominancia = repeticionTotalMaxima / total;

  // CUÁNTO HABLA SALE DE AQUÍ. Éste es el criterio que mide el daño real, y
  // el único que habría cazado la fila #23 (8 trozos, 92 s de voz).
  const caracteres = lista.join(' ').length;
  const segundosHablaEstimados = Number(segundosDeHabla(caracteres).toFixed(1));
  const proporcionEstimada = Number((segundosHablaEstimados / segundos).toFixed(2));

  // Repetición dentro de un mismo trozo: el caso que el troceo no ve.
  let peorInterna = null;
  for (const trozo of lista) {
    const r = repeticionInterna(trozo);
    if (r && r.veces > REPETICIONES_INTERNAS_MAXIMAS && (!peorInterna || r.veces > peorInterna.veces)) {
      peorInterna = r;
    }
  }

  const motivos = [];
  if (total > TROZOS_AVISO) {
    motivos.push(
      `${total} oraciones en ${segundos} s (${oracionesPorSegundo} por segundo). ` +
        `Con habla real son 1-2, y 3-4 en el peor caso; a partir de ${TROZOS_AVISO} no es habla.`
    );
  }
  if (total >= MINIMO_PARA_EVALUAR && ratioUnicos < RATIO_UNICOS_MINIMO) {
    motivos.push(
      `sólo ${unicos} oraciones distintas de ${total} (${Math.round(ratioUnicos * 100)} %).`
    );
  }
  if (repeticionSeguidaMaxima > REPETICIONES_SEGUIDAS_MAXIMAS) {
    motivos.push(`la misma oración ${repeticionSeguidaMaxima} veces seguidas.`);
  }
  if (proporcionEstimada > PROPORCION_AVISO) {
    motivos.push(
      `son unos ${segundosHablaEstimados} s de voz para ${segundos} s de audio ` +
        `(${proporcionEstimada}x; lo medido con habla real es 1,11x).`
    );
  }
  if (peorInterna) {
    motivos.push(
      `dentro de una misma oración, "${peorInterna.bloque}" se repite ` +
        `${peorInterna.veces} veces seguidas.`
    );
  }
  if (
    total >= MINIMO_PARA_EVALUAR &&
    dominancia > DOMINANCIA_MAXIMA &&
    repeticionSeguidaMaxima <= REPETICIONES_SEGUIDAS_MAXIMAS
  ) {
    // Sólo se dice si no lo ha dicho ya el criterio de repetición seguida:
    // si no, la misma alucinación saldría descrita dos veces.
    motivos.push(
      `"${oracionDominante}" ocupa ${repeticionTotalMaxima} de ${total} oraciones ` +
        `(${Math.round(dominancia * 100)} %), aunque no seguidas.`
    );
  }

  return {
    total,
    unicos,
    ratioUnicos: Number(ratioUnicos.toFixed(3)),
    repeticionSeguidaMaxima,
    repeticionTotalMaxima,
    dominancia: Number(dominancia.toFixed(3)),
    oracionesPorSegundo,
    caracteres,
    segundosHablaEstimados,
    proporcionEstimada,
    repeticionInterna: peorInterna,
    esSospechosa: motivos.length > 0,
    // ¿Hay además motivo para CORTAR, y no sólo para avisar? Es un umbral
    // aparte y mucho más alto: sanearTrozos() nunca toca nada por debajo.
    superaElTopeDuro:
      total > TROZOS_MAXIMOS ||
      repeticionSeguidaMaxima > REPETICIONES_SEGUIDAS_MAXIMAS ||
      proporcionEstimada > PROPORCION_CORTE ||
      Boolean(peorInterna),
    motivos
  };
}

/* ------------------------------------------------------------------ */
/* Limpieza                                                            */
/* ------------------------------------------------------------------ */

/**
 * Devuelve la versión saneada del lote y QUÉ se ha quitado.
 *
 * Dos pasos, en este orden a propósito:
 *
 *   1. DESDUPLICAR repeticiones seguidas. Esto NO pierde contenido real:
 *      nadie dice la misma oración cincuenta veces. "Es interesante." x111
 *      se queda en "Es interesante." dicho una vez, que es exactamente lo
 *      que el vídeo decía (o ni eso, porque encima era silencio o música).
 *
 *   2. Si AUN ASÍ quedan más de TROZOS_MAXIMOS, cortar ahí. Este paso SÍ
 *      puede perder contenido real, y por eso va separado y se informa
 *      aparte: quien lo active tiene que saber que acepta ese riesgo.
 *
 * @returns {{
 *   trozos: string[], quitadosPorRepeticion: number, quitadosPorTope: number,
 *   seCorto: boolean
 * }}
 */
export function sanearTrozos(trozos, { topeDuro = TROZOS_MAXIMOS, segundosAudio = null } = {}) {
  const lista = Array.isArray(trozos) ? trozos.filter((t) => String(t || '').trim()) : [];
  if (lista.length === 0) {
    return {
      trozos: [],
      quitadosPorRepeticion: 0,
      quitadosPorRepeticionInterna: 0,
      quitadosPorTope: 0,
      quitadosPorDuracion: 0,
      seCorto: false
    };
  }

  // Paso 1: fuera las repeticiones seguidas que pasen de las que un humano
  // puede soltar de verdad. Se CONSERVAN hasta tres ("No. No. No. No lo voy
  // a hacer." se queda entera): desduplicar a una sola copia sí habría
  // cambiado una frase legítima.
  const sinRepetir = [];
  let anterior = null;
  let seguidas = 0;
  for (const trozo of lista) {
    const norma = normalizar(trozo);
    seguidas = norma === anterior ? seguidas + 1 : 1;
    if (seguidas <= REPETICIONES_SEGUIDAS_MAXIMAS) sinRepetir.push(trozo);
    anterior = norma;
  }
  const quitadosPorRepeticion = lista.length - sinRepetir.length;

  // Paso 1b: la misma idea, pero DENTRO de cada trozo. "it is interesting"
  // x20 sin puntuación llega como un solo trozo y el paso 1 no ve nada.
  // Igual de inocuo: lo que se quita es literalmente idéntico a lo que
  // queda, y se conservan hasta tres copias.
  let quitadosPorRepeticionInterna = 0;
  const sinRepetirDentro = sinRepetir.map((trozo) => {
    const r = repeticionInterna(trozo);
    if (!r || r.veces <= REPETICIONES_INTERNAS_MAXIMAS) return trozo;
    const palabras = String(trozo).split(/\s+/).filter(Boolean);
    const sobran = (r.veces - REPETICIONES_INTERNAS_MAXIMAS) * r.palabras;
    quitadosPorRepeticionInterna += sobran;
    const cortaDesde = r.desde + REPETICIONES_INTERNAS_MAXIMAS * r.palabras;
    return [...palabras.slice(0, cortaDesde), ...palabras.slice(cortaDesde + sobran)]
      .join(' ')
      .trim();
  }).filter((t) => t);

  // Paso 2: tope duro de oraciones. AQUÍ SÍ SE PUEDE PERDER CONTENIDO REAL.
  const porTope = sinRepetirDentro.slice(0, topeDuro);
  const quitadosPorTope = sinRepetirDentro.length - porTope.length;

  // Paso 3: tope duro de DURACIÓN. El que hacía falta para la fila #23:
  // 8 trozos no superan ningún tope de cantidad, pero 92 s de voz sobre
  // 12,03 s de audio bloquean el altavoz igual. Se van quitando oraciones
  // POR EL FINAL —nunca a mitad de palabra— hasta que lo que queda cabe en
  // PROPORCION_CORTE veces la duración del audio.
  //
  // ESTE PASO TAMBIÉN PUEDE PERDER CONTENIDO REAL y por eso se informa
  // aparte del resto.
  const finales = [...porTope];
  let quitadosPorDuracion = 0;
  if (segundosAudio > 0) {
    const topeSegundos = segundosAudio * PROPORCION_CORTE;
    while (
      finales.length > 1 &&
      segundosDeHabla(finales.join(' ').length) > topeSegundos
    ) {
      finales.pop();
      quitadosPorDuracion++;
    }
  }

  return {
    trozos: finales,
    quitadosPorRepeticion,
    quitadosPorRepeticionInterna,
    quitadosPorTope,
    quitadosPorDuracion,
    // "seCorto" significa: se ha quitado algo que PODRÍA haber sido real.
    // Desduplicar no cuenta; cortar por tope o por duración, sí.
    seCorto: quitadosPorTope > 0 || quitadosPorDuracion > 0
  };
}
