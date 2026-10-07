// detector-idioma.js
// Heurística MUY simple para decidir si un texto transcrito está en inglés.
//
// ¿Por qué existe? El traductor de esta fase es sólo inglés → español. Si el
// usuario deja el idioma origen en «Detectar automáticamente», no sabemos qué
// idioma eligió Whisper (transformers.js 2.x no lo expone), y traducir francés
// con un modelo en→es produciría basura. Antes que inventar, preguntamos a esta
// heurística y, si no parece inglés, no se traduce y se avisa.
//
// NO es un modelo de detección de idioma: es una cuenta de palabras frecuentes
// y de caracteres acentuados. Si el usuario selecciona «Inglés» en el popup,
// esta heurística no se usa para nada: manda su elección.

// Palabras muy frecuentes y bastante exclusivas de cada idioma.
const PISTAS = {
  en: ['the', 'and', 'you', 'that', 'this', 'with', 'have', 'what', 'they', 'are', 'was', 'for', 'not', 'but', 'it\'s', 'i\'m', 'don\'t'],
  es: ['que', 'de', 'la', 'el', 'los', 'una', 'por', 'con', 'para', 'esto', 'pero', 'como', 'muy', 'hay'],
  fr: ['le', 'les', 'des', 'une', 'est', 'pas', 'vous', 'nous', 'dans', 'pour', 'qui', 'avec', 'c\'est'],
  de: ['der', 'die', 'das', 'und', 'ist', 'nicht', 'ich', 'sie', 'mit', 'auf', 'ein', 'eine'],
  pt: ['que', 'não', 'uma', 'com', 'para', 'você', 'isso', 'mas', 'muito', 'são'],
  it: ['che', 'non', 'per', 'una', 'sono', 'come', 'anche', 'questo', 'alla', 'più']
};

// Letras que el inglés prácticamente no usa: delatan otro idioma.
const ACENTOS = /[áàâäãéèêëíìîïóòôöõúùûüñçßœ]/i;

/**
 * Devuelve { idioma, esIngles, confianza } a partir del texto transcrito.
 * `confianza` va de 0 a 1 y es orientativa, no una probabilidad real.
 */
export function detectarIdioma(texto) {
  const limpio = String(texto || '').toLowerCase();
  const palabras = limpio.match(/[\p{L}']+/gu) || [];

  if (palabras.length === 0) {
    return { idioma: 'desconocido', esIngles: false, confianza: 0 };
  }

  const puntos = {};
  for (const [idioma, lista] of Object.entries(PISTAS)) {
    puntos[idioma] = palabras.filter((p) => lista.includes(p)).length;
  }

  // Los acentos restan mucho al inglés y suman un poco al resto.
  if (ACENTOS.test(limpio)) puntos.en -= 2;

  let mejor = 'desconocido';
  let mejorPuntos = 0;
  for (const [idioma, valor] of Object.entries(puntos)) {
    if (valor > mejorPuntos) {
      mejor = idioma;
      mejorPuntos = valor;
    }
  }

  // Con textos muy cortos no hay suficientes pistas para decidir nada.
  if (mejorPuntos === 0) {
    return { idioma: 'desconocido', esIngles: false, confianza: 0 };
  }

  return {
    idioma: mejor,
    esIngles: mejor === 'en',
    confianza: Math.min(1, mejorPuntos / Math.max(4, palabras.length * 0.25))
  };
}

// Nombres para los avisos de la interfaz.
export const NOMBRE_IDIOMA = {
  en: 'inglés',
  es: 'español',
  fr: 'francés',
  de: 'alemán',
  pt: 'portugués',
  it: 'italiano',
  ja: 'japonés',
  auto: 'detección automática',
  desconocido: 'idioma no identificado'
};
