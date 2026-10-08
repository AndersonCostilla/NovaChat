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

/* ------------------------------------------------------------------ */
/* Análisis                                                            */
/* ------------------------------------------------------------------ */

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
    oracionesPorSegundo: null,
    esSospechosa: false,
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

  const motivos = [];
  if (total > TROZOS_MAXIMOS) {
    motivos.push(
      `${total} oraciones en ${segundos} s (${oracionesPorSegundo} por segundo). ` +
        `El tope plausible son ${TROZOS_MAXIMOS}.`
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

  return {
    total,
    unicos,
    ratioUnicos: Number(ratioUnicos.toFixed(3)),
    repeticionSeguidaMaxima,
    oracionesPorSegundo,
    esSospechosa: motivos.length > 0,
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
export function sanearTrozos(trozos, { topeDuro = TROZOS_MAXIMOS } = {}) {
  const lista = Array.isArray(trozos) ? trozos.filter((t) => String(t || '').trim()) : [];
  if (lista.length === 0) {
    return { trozos: [], quitadosPorRepeticion: 0, quitadosPorTope: 0, seCorto: false };
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

  // Paso 2: tope duro.
  const finales = sinRepetir.slice(0, topeDuro);
  const quitadosPorTope = sinRepetir.length - finales.length;

  return {
    trozos: finales,
    quitadosPorRepeticion,
    quitadosPorTope,
    seCorto: quitadosPorTope > 0
  };
}
