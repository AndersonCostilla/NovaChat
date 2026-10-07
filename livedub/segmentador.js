// segmentador.js
// Parte un texto en oraciones traducibles de una en una.
//
// POR QUÉ EXISTE ESTE ARCHIVO
// OPUS-MT (Marian) está entrenado con pares de ORACIONES sueltas, no con
// párrafos. Si se le mete un bloque con varias oraciones, no las traduce todas:
// emite el token de fin después de una y se come el resto. En las pruebas
// reales de Anderson, una entrada de 4 oraciones devolvió sólo la traducción de
// la última, y otra de 3 devolvió sólo la del medio.
//
// La solución no es subir ningún límite de longitud (está comprobado que el
// tope de 257 tokens nunca se alcanzaba): es trocear antes de traducir y volver
// a unir después.
//
// Este módulo no sabe nada de modelos ni de workers: entra texto, salen trozos.

// Por encima de esto, un trozo se parte por comas aunque sea una sola oración:
// las frases muy largas también degradan la calidad y disparan la latencia.
const MAX_PALABRAS_POR_TROZO = 40;

// Abreviaturas frecuentes en inglés que llevan punto y NO terminan oración.
// Sin esto, "Mr. Smith" se partiría en dos trozos y se traduciría peor.
const ABREVIATURAS = [
  'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st',
  'vs', 'etc', 'inc', 'ltd', 'co', 'approx', 'dept',
  'e.g', 'i.e', 'a.m', 'p.m', 'u.s', 'u.k'
];

// Cuenta palabras de forma barata (sirve para decidir si hay que partir más).
function contarPalabras(texto) {
  const limpio = texto.trim();
  return limpio ? limpio.split(/\s+/).length : 0;
}

// ¿El punto que cierra este trozo pertenece a una abreviatura o a un número
// decimal? En ese caso no es un final de oración de verdad.
function terminaEnFalsoPunto(trozo) {
  const texto = trozo.trimEnd();
  if (!texto.endsWith('.')) return false;

  // Número decimal partido: "3." seguido de dígitos (se comprueba al unir).
  const ultima = texto.slice(0, -1).split(/\s+/).pop()?.toLowerCase() ?? '';
  if (/^\d+$/.test(ultima)) return true;

  // Inicial suelta: "J." de "J. Smith".
  if (/^[a-z]$/.test(ultima)) return true;

  return ABREVIATURAS.includes(ultima.replace(/^[^a-z.]+/, ''));
}

// Parte por comas, punto y coma o dos puntos, manteniendo el signo. Último
// recurso antes del corte duro: respeta al menos los límites de cláusula.
function partirPorComas(trozo, maxPalabras) {
  const piezas = trozo.split(/(?<=[,;:])\s+/);
  const resultado = [];
  let actual = '';

  for (const pieza of piezas) {
    const candidato = actual ? `${actual} ${pieza}` : pieza;
    if (actual && contarPalabras(candidato) > maxPalabras) {
      resultado.push(actual);
      actual = pieza;
    } else {
      actual = candidato;
    }
  }
  if (actual) resultado.push(actual);
  return resultado;
}

// Corte duro cada maxPalabras. Sólo se llega aquí con texto sin puntuación
// ninguna, que es justo lo que a veces devuelve Whisper en audio corrido.
function partirPorPalabras(trozo, maxPalabras) {
  const palabras = trozo.split(/\s+/);
  const resultado = [];
  for (let i = 0; i < palabras.length; i += maxPalabras) {
    resultado.push(palabras.slice(i, i + maxPalabras).join(' '));
  }
  return resultado;
}

/**
 * Trocea un texto en oraciones listas para traducir una por una.
 *
 * @param {string} texto
 * @param {{ maxPalabras?: number }} opciones
 * @returns {string[]} trozos no vacíos; [] si no hay nada que traducir.
 */
export function trocearEnOraciones(texto, { maxPalabras = MAX_PALABRAS_POR_TROZO } = {}) {
  if (typeof texto !== 'string') return [];

  const normalizado = texto.replace(/\s+/g, ' ').trim();
  if (!normalizado) return [];

  // 1) Cortar detrás de . ! ? … cuando les sigue un espacio.
  const brutos = normalizado.split(/(?<=[.!?…])\s+/);

  // 2) Volver a pegar los cortes falsos (abreviaturas, iniciales, decimales).
  const oraciones = [];
  for (const bruto of brutos) {
    const anterior = oraciones[oraciones.length - 1];
    if (anterior !== undefined && terminaEnFalsoPunto(anterior)) {
      oraciones[oraciones.length - 1] = `${anterior} ${bruto}`;
    } else {
      oraciones.push(bruto);
    }
  }

  // 3) Partir lo que siga siendo demasiado largo.
  const finales = [];
  for (const oracion of oraciones) {
    if (contarPalabras(oracion) <= maxPalabras) {
      finales.push(oracion);
      continue;
    }
    for (const porComas of partirPorComas(oracion, maxPalabras)) {
      if (contarPalabras(porComas) <= maxPalabras) {
        finales.push(porComas);
      } else {
        finales.push(...partirPorPalabras(porComas, maxPalabras));
      }
    }
  }

  return finales.map((t) => t.trim()).filter(Boolean);
}

/**
 * Vuelve a unir las traducciones de los trozos en un texto único.
 * Se limita a pegar con espacios: no reordena ni reescribe nada.
 */
export function unirTraducciones(trozos) {
  return trozos
    .map((t) => (typeof t === 'string' ? t.trim() : ''))
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export const LIMITES = { MAX_PALABRAS_POR_TROZO };
