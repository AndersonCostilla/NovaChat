// recortador.js
// Acorta el español traducido para que SUENE menos tiempo, sin quitar
// información.
//
// POR QUÉ EXISTE ESTE ARCHIVO
// Medido en dos tandas independientes: el doblaje en español dura ~1,1 veces
// lo que dura el original en inglés. Ese 1,1 es lo que hace que la ocupación
// pase del 100 % y que cada frase empuje a la siguiente hasta que hay que
// descartar alguna. No es un problema de velocidad de cálculo — está
// demostrado en cronometro.js: con Whisper y la traducción a 0 ms la
// ocupación sale IGUAL. Es la proporción entre los dos idiomas.
//
// Bajar esa proporción de 1,1 a ~0,97 es lo único que corta la pérdida de
// raíz sin tocar el vídeo ni meter búfer.
//
// QUÉ NO HACE ESTE ARCHIVO
// No resume, no omite frases y no decide qué es importante. Sólo cambia
// maneras largas de decir lo mismo por maneras cortas de decir lo mismo.
// Si con eso no llega al objetivo, LO DICE y se queda corto, en vez de
// empezar a tirar contenido por su cuenta.

/* ------------------------------------------------------------------ */
/* Cuánto hay que recortar                                             */
/* ------------------------------------------------------------------ */

// 12 % es el centro de la horquilla pedida (10-15 %) y lo que hace falta
// para pasar de 1,11 a 0,98 veces el original: 1,11 x 0,88 = 0,977.
export const OBJETIVO_POR_DEFECTO = 0.12;

// Velocidad medida de la voz del sistema en el equipo de Anderson: 17,2
// caracteres por segundo. Sirve para traducir "caracteres ahorrados" a
// "segundos ahorrados", que es lo que de verdad importa.
export const CARACTERES_POR_SEGUNDO = 17.2;

/* ------------------------------------------------------------------ */
/* Las reglas, por niveles de agresividad                              */
/* ------------------------------------------------------------------ */
//
// Se aplican de menos a más invasivas y se PARA en cuanto se alcanza el
// objetivo. Una frase que ya es corta no pasa del nivel 1.

/** NIVEL 1 — Perífrasis. Mismo significado, menos sílabas. Sin pérdida. */
const NIVEL_1 = [
  ['con el fin de', 'para'],
  ['con el objetivo de', 'para'],
  ['con el propósito de', 'para'],
  ['en orden a', 'para'],
  ['a fin de que', 'para que'],
  ['para poder', 'para'],
  ['a través de', 'por'],
  ['por medio de', 'con'],
  // CONCORDANCIA. Estas dos se dejan porque 'un montón de' es invariable y
  // vale igual para masculino, femenino, singular y plural. Las versiones
  // con 'muchos' se probaron y daban "muchos personas": una regla que
  // produce español incorrecto no vale ningún ahorro de tiempo.
  ['una gran cantidad de', 'un montón de'],
  ['un gran número de', 'un montón de'],
  ['la mayor parte de', 'la mayoría de'],
  ['por parte de', 'de'],
  ['a lo largo de', 'durante'],
  ['en el transcurso de', 'durante'],
  ['debido al hecho de que', 'porque'],
  ['debido a que', 'porque'],
  ['dado que', 'porque'],
  ['puesto que', 'porque'],
  ['por el hecho de que', 'porque'],
  // MODO VERBAL. Quitadas el 8-oct-2026 al ver los ejemplos reales:
  //   'en el caso de que' -> 'si'   daba "Si no funcione" (pide indicativo)
  //   'es necesario que'  -> 'hay que' daba "hay que vayas"
  //   'de manera que'     -> 'así que' cambia finalidad por consecuencia
  //   'el hecho de que'   -> 'que'  daba "es que funcione no significa"
  // Todas ahorraban tiempo y todas producían español incorrecto. Una regla
  // que rompe la frase no vale ningún segundo.
  ['por lo tanto', 'así que'],
  ['por consiguiente', 'así que'],
  ['en consecuencia', 'así que'],
  ['a pesar de que', 'aunque'],
  ['a pesar de', 'pese a'],
  ['si bien es cierto que', 'aunque'],
  ['de acuerdo con', 'según'],
  ['en relación con', 'sobre'],
  ['con respecto a', 'sobre'],
  ['en lo que respecta a', 'sobre'],
  ['en cuanto a', 'sobre'],
  ['acerca de', 'sobre'],
  ['es capaz de', 'puede'],
  ['tiene la capacidad de', 'puede'],
  ['tiene la posibilidad de', 'puede'],
  ['tiene que ser capaz de', 'tiene que'],
  ['lleva a cabo', 'hace'],
  ['llevar a cabo', 'hacer'],
  ['hace uso de', 'usa'],
  ['hacer uso de', 'usar'],
  ['da lugar a', 'causa'],
  ['dar lugar a', 'causar'],
  ['poner de manifiesto', 'mostrar'],
  ['se da cuenta de que', 've que'],
  ['en este momento', 'ahora'],
  ['en estos momentos', 'ahora'],
  ['en la actualidad', 'hoy'],
  ['hoy en día', 'hoy'],
  ['en aquel entonces', 'entonces'],
  ['en el día de hoy', 'hoy'],
  ['de forma inmediata', 'ya'],
  ['de manera inmediata', 'ya'],
  ['al mismo tiempo', 'a la vez'],
  ['en todo momento', 'siempre'],
  ['en ningún momento', 'nunca'],
  ['en algún momento', 'alguna vez'],
  ['todo el mundo', 'todos'],
  ['lo que es lo mismo', 'o sea'],
  ['es decir que', 'o sea'],
  ['que es lo que', 'lo que'],
  ['el motivo por el que', 'por qué'],
  ['la razón por la que', 'por qué'],
  ['la manera en la que', 'cómo'],
  ['la forma en la que', 'cómo'],
  ['el lugar en el que', 'donde'],
  ['de esta manera', 'así'],
  ['de esta forma', 'así'],
  ['de la misma manera', 'igual'],
  ['del mismo modo', 'igual'],
  ['sin embargo', 'pero'],
  ['no obstante', 'pero'],
  ['además de eso', 'además'],
  ['aparte de eso', 'además'],
  ['en primer lugar', 'primero'],
  ['en segundo lugar', 'segundo'],
  ['en último lugar', 'por último'],
  ['antes que nada', 'primero'],
  ['a partir de ahora', 'desde ahora'],
  ['existe la posibilidad de que', 'puede que'],
  ['hay que decir que', ''],
  ['es importante señalar que', ''],
  ['cabe destacar que', ''],
  ['lo que quiero decir es que', '']
];

/**
 * NIVEL 2 — Muletillas DE ARRANQUE. OPUS-MT las calca del inglés.
 *
 * FALLO GRAVE CORREGIDO EL 8-OCT-2026. Esta lista siempre dijo "de arranque",
 * pero se aplicaba en CUALQUIER posición de la frase. Con eso, 'bien' y
 * 'bueno' se borraban también cuando eran el complemento del verbo, y
 * destrozaron frases reales de Anderson:
 *
 *   "Se siente muy bien y de manera similar"   ->  "Se siente muy y de manera similar"
 *   "Se siente muy bien. Sí, creo que..."      ->  "Se siente muy. Sí, creo que..."
 *   "...entregas una cosa y es bueno. Esto..." ->  "...entregas una cosa y es. Esto..."
 *
 * No eran recortes agresivos: eran frases rotas. Ahora estas reglas SÓLO
 * disparan al principio de una oración y seguidas de coma, que es como
 * aparece una muletilla de verdad ("Bueno, ..."). Y las más ambiguas
 * —'bien', 'vale', 'sabes', 'la verdad', 'pues'— se han quitado del todo:
 * aunque vayan al principio, muchas veces no son relleno.
 */
const NIVEL_2 = [
  ['bueno', ''],
  ['así que', ''],
  ['ya sabes', ''],
  ['ya sabéis', ''],
  ['quiero decir', ''],
  ['o sea', ''],
  ['de hecho', ''],
  ['básicamente', ''],
  ['obviamente', ''],
  ['evidentemente', ''],
  ['claramente', ''],
  ['sinceramente', ''],
  ['honestamente', ''],
  ['francamente', ''],
  ['por supuesto', ''],
  ['en realidad', ''],
  ['digamos', ''],
  ['mira', ''],
  ['oye', ''],
  ['dicho esto', ''],
  ['en fin', '']
];

/** NIVEL 3 — Intensificadores vacíos dentro de la frase. */
const NIVEL_3 = [
  ['realmente', ''],
  ['verdaderamente', ''],
  ['literalmente', ''],
  ['absolutamente', ''],
  ['completamente', ''],
  ['totalmente', ''],
  ['simplemente', ''],
  ['prácticamente', ''],
  ['efectivamente', ''],
  ['ciertamente', ''],
  ['realmente bien', 'bien'],
  ['muy muy', 'muy'],
  ['un poco de', 'algo de'],
  ['una especie de', 'una especie de']
];

/* ------------------------------------------------------------------ */
/* Motor                                                               */
/* ------------------------------------------------------------------ */

function escapar(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Las reglas se compilan una vez. \b no sirve con acentos en todos los
// motores, así que los límites se hacen a mano con (?<![\wáéíóúüñ]).
const LIMITE_IZQ = '(?<![\\wáéíóúüñÁÉÍÓÚÜÑ])';
const LIMITE_DER = '(?![\\wáéíóúüñÁÉÍÓÚÜÑ])';

function compilar(reglas) {
  return reglas.map(([de, a]) => ({
    de,
    a,
    patron: new RegExp(`${LIMITE_IZQ}${escapar(de)}${LIMITE_DER}`, 'gi')
  }));
}

/**
 * RED DE SEGURIDAD. Después de aplicar una regla, ¿la frase sigue siendo una
 * frase?
 *
 * Esto NO sustituye a escribir bien las reglas: es lo que tiene que cazar la
 * próxima regla mal escrita antes de que llegue a los oídos de nadie. Si una
 * regla no pasa por aquí, se descarta ESA regla y el texto se queda como
 * estaba. El recorte es opcional; la frase correcta no.
 */
const FINAL_COJO =
  /(?:^|\s)(?:es|era|fue|son|eran|está|están|ser|sea|muy|tan|más|mas|menos|bastante|demasiado|casi|de|del|al|a|en|con|por|para|sin|sobre|y|e|o|u|que|lo|la|el|los|las|un|una)\s*[.!?…,]/i;

function oraciones(t) {
  return t.split(/(?<=[.!?…])\s+/).filter((o) => o.trim());
}

function esSeguro(nuevo, previo) {
  if (!nuevo.trim()) return false;
  // Una oración que se queda en una sola palabra donde antes había varias.
  const minimas = (t) => oraciones(t).filter((o) => o.trim().split(/\s+/).length < 2).length;
  if (minimas(nuevo) > minimas(previo)) return false;
  // Una frase que corta en una palabra que pedía algo detrás:
  // "se siente muy.", "y es.", "una cosa y es, ...".
  if (FINAL_COJO.test(nuevo) && !FINAL_COJO.test(previo)) return false;
  return true;
}

// Palabras que EXIGEN un complemento detrás. Si se borra lo que viene
// después, la frase queda coja: "se siente muy ___", "y es ___". Ninguna
// regla de BORRADO puede dispararse justo detrás de una de éstas.
const EXIGEN_COMPLEMENTO = [
  'muy', 'tan', 'más', 'mas', 'menos', 'bastante', 'demasiado', 'casi', 'poco', 'qué',
  'es', 'era', 'fue', 'son', 'eran', 'fueron', 'está', 'estaba', 'están', 'estaban',
  'ser', 'sea', 'sido', 'parece', 'parecía', 'resulta', 'queda', 'suena', 'siente',
  'sientes', 'sentía', 'estoy', 'estás', 'soy', 'eres', 'somos'
];
const GUARDA_IZQ = `(?<!(?:${EXIGEN_COMPLEMENTO.join('|')})\\s)`;

// Arranque de oración: principio del texto, o detrás de . ! ? … y espacio.
const ARRANQUE = '(?<=^|[.!?…]\\s)';

/** Nivel 2: sólo al arrancar una oración Y seguida de coma. */
function compilarNivel2(reglas) {
  return reglas.map(([de, a]) => ({
    de,
    a,
    patron: new RegExp(`${ARRANQUE}${escapar(de)},\\s*`, 'gi')
  }));
}

/** Nivel 3: borrados, con la guarda de "no detrás de muy/es/...". */
function compilarConGuarda(reglas) {
  return reglas.map(([de, a]) => ({
    de,
    a,
    patron: new RegExp(
      `${a === '' ? GUARDA_IZQ : ''}${LIMITE_IZQ}${escapar(de)}${LIMITE_DER}`,
      'gi'
    )
  }));
}

const NIVELES = [compilar(NIVEL_1), compilarNivel2(NIVEL_2), compilarConGuarda(NIVEL_3)];

/**
 * Deja el texto presentable después de borrar trozos: espacios dobles,
 * comas huérfanas, mayúscula inicial y puntuación final.
 */
function limpiar(texto, original) {
  let t = texto
    .replace(/\s+/g, ' ')
    // Restos de haber borrado un conector: ", y," / ", pero," / ", ,"
    .replace(/,\s*(y|pero|o)\s*,/gi, ',')
    .replace(/^\s*(y|pero|o)\s*,\s*/i, '')
    // Palabra repetida por el recorte: "hay que decir que" + "el hecho de
    // que" -> "que" daba "que que funcione".
    .replace(/\b(que|de|a|en|y|lo|la|el)\s+\1\b/gi, '$1')
    .replace(/\s+([,.;:!?…])/g, '$1')
    .replace(/([(¡¿])\s+/g, '$1')
    .replace(/^[\s,;:]+/, '')
    .replace(/,\s*,/g, ',')
    .replace(/\s*,\s*\./g, '.')
    .trim();

  if (!t) return '';

  // Si el original empezaba en mayúscula, el recorte también.
  const primeraOriginal = original.trim()[0] || '';
  if (primeraOriginal === primeraOriginal.toUpperCase() && primeraOriginal !== primeraOriginal.toLowerCase()) {
    t = t[0].toUpperCase() + t.slice(1);
  }

  // Si el original terminaba en signo y el recorte se lo comió, se repone.
  const finalOriginal = original.trim().slice(-1);
  if (/[.!?…]/.test(finalOriginal) && !/[.!?…]/.test(t.slice(-1))) {
    t += finalOriginal;
  }
  return t;
}

// Se para EN CUANTO se alcanza el objetivo, regla a regla y no nivel a
// nivel. En la primera versión la comprobación estaba entre niveles y una
// frase pedía un 12 % y se llevaba un 36 %: cada rodeo de más que se quita
// es una oportunidad de más de estropear la frase, así que no se recorta ni
// un carácter de lo que haga falta.
function aplicar(texto, reglas, { objetivoCaracteres }) {
  let t = texto;
  const usadas = [];
  for (const regla of reglas) {
    if (t.length <= objetivoCaracteres) break;
    const antes = t;
    const candidato = t.replace(regla.patron, regla.a);
    if (candidato === antes) continue;
    if (!esSeguro(candidato, antes)) continue; // la regla se descarta, no la frase
    t = candidato;
    usadas.push(regla.de);
  }
  return { texto: t, usadas };
}

/**
 * Acorta un texto en español hasta acercarse al objetivo de reducción.
 *
 * @param {string} texto    la traducción tal cual sale de OPUS-MT
 * @param {{objetivo?: number, nivelMaximo?: number}} opciones
 * @returns {{
 *   texto: string, original: string,
 *   caracteresAntes: number, caracteresDespues: number,
 *   reduccion: number, segundosAhorrados: number,
 *   nivelAlcanzado: number, reglas: string[], objetivoCumplido: boolean
 * }}
 */
export function recortar(texto, { objetivo = OBJETIVO_POR_DEFECTO, nivelMaximo = 3 } = {}) {
  const original = typeof texto === 'string' ? texto : '';
  const caracteresAntes = original.length;

  const vacio = {
    texto: original,
    original,
    caracteresAntes,
    caracteresDespues: caracteresAntes,
    reduccion: 0,
    segundosAhorrados: 0,
    nivelAlcanzado: 0,
    reglas: [],
    objetivoCumplido: false
  };
  if (!caracteresAntes) return vacio;

  let actual = original;
  const reglas = [];
  let nivelAlcanzado = 0;

  const objetivoCaracteres = Math.ceil(caracteresAntes * (1 - objetivo));

  for (let nivel = 0; nivel < Math.min(nivelMaximo, NIVELES.length); nivel++) {
    if (actual.length <= objetivoCaracteres) break;
    const { texto: nuevo, usadas } = aplicar(actual, NIVELES[nivel], { objetivoCaracteres });
    actual = limpiar(nuevo, original);
    reglas.push(...usadas);
    nivelAlcanzado = nivel + 1;
  }

  // Un recorte que deja la frase en nada es un error, no un éxito.
  if (!actual || actual.length < 3) return vacio;

  const caracteresDespues = actual.length;
  const reduccion = (caracteresAntes - caracteresDespues) / caracteresAntes;

  return {
    texto: actual,
    original,
    caracteresAntes,
    caracteresDespues,
    reduccion: Number(reduccion.toFixed(4)),
    segundosAhorrados: Number(((caracteresAntes - caracteresDespues) / CARACTERES_POR_SEGUNDO).toFixed(2)),
    nivelAlcanzado,
    reglas,
    objetivoCumplido: reduccion >= objetivo
  };
}

/**
 * Pasa una lista de traducciones por el recortador y resume el efecto.
 * Es lo que alimenta la tabla de ejemplos "antes/después".
 */
export function recortarLote(textos, opciones = {}) {
  const filas = textos.map((t) => recortar(t, opciones));
  const antes = filas.reduce((n, f) => n + f.caracteresAntes, 0);
  const despues = filas.reduce((n, f) => n + f.caracteresDespues, 0);
  return {
    filas,
    caracteresAntes: antes,
    caracteresDespues: despues,
    // AGREGADA, no promedio de porcentajes: caracteres ahorrados sobre
    // caracteres totales. Es la que corresponde comparar con el 9,9 % que
    // haría falta, porque lo que importa es el tiempo total de habla, no el
    // porcentaje medio por frase. Etiquetada así para que no se confunda con
    // la mediana por frase que da livedub.comparar().
    reduccionAgregada: antes ? Number(((antes - despues) / antes).toFixed(4)) : 0,
    reduccionMedia: antes ? Number(((antes - despues) / antes).toFixed(4)) : 0, // alias histórico
    segundosAhorrados: Number(((antes - despues) / CARACTERES_POR_SEGUNDO).toFixed(2)),
    frasesQueCumplenElObjetivo: filas.filter((f) => f.objetivoCumplido).length,
    frasesSinTocar: filas.filter((f) => f.reduccion === 0).length
  };
}
