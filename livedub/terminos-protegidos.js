// terminos-protegidos.js
// Evita que el traductor traduzca nombres propios y términos técnicos.
//
// POR QUÉ EXISTE ESTE ARCHIVO
// OPUS-MT en→es se entrenó con corpus de alrededor de 2020. No conoce los
// nombres de producto posteriores, y algunos coinciden con palabras españolas
// reales. En las pruebas de Anderson, "the llama models" salió como
// "los modelos de las 'Joyas'": el modelo no sabe que Llama es un modelo de IA
// de Meta, y "llama" es una palabra corriente en español.
//
// Subir num_beams NO arregla esto: la búsqueda en haz reordena candidatos con
// las mismas probabilidades del modelo, no añade conocimiento que no tiene.
//
// MECANISMO
//   1. Antes de traducir, cada término protegido se cambia por un marcador.
//        "the llama models"  ->  "the Xk0 models"
//   2. Se traduce el texto con el marcador dentro.
//        "los modelos Xk0"
//   3. Se restaura el término en su forma canónica.
//        "los modelos Llama"
//
// ────────────────────────────────────────────────────────────────────────
//  CÓMO AÑADIR UN TÉRMINO NUEVO
//  Añade una línea a la lista TERMINOS de abajo. Nada más; no hay que tocar
//  ningún otro archivo. Campos:
//    termino  Forma canónica, tal y como debe aparecer en el subtítulo final.
//    estricto true  = sólo se protege si en el original va con mayúscula
//                     inicial. Úsalo cuando la palabra también existe en
//                     minúscula con otro sentido ("Meta" la empresa frente a
//                     "meta" objetivo).
//             false = se protege en cualquier combinación de mayúsculas, útil
//                     cuando Whisper suele transcribirlo en minúscula.
//  Después ejecuta: node livedub/tests/test-terminos-protegidos.mjs
// ────────────────────────────────────────────────────────────────────────

const TERMINOS = [
  // Los de varias palabras van primero: se sustituyen antes que los sueltos
  // para que "Reality Labs" no se parta por el término "Reality".
  { termino: 'Reality Labs', estricto: false },
  { termino: 'Apple Vision Pro', estricto: false },
  { termino: 'Vision Pro', estricto: false },

  // Caso real detectado en pruebas: se tradujo como "Joyas".
  { termino: 'Llama', estricto: false },

  { termino: 'Meta', estricto: true }, // "meta" en minúscula es otra palabra
  { termino: 'Quest', estricto: true }, // "quest" en minúscula es otra palabra
  { termino: 'Orion', estricto: true },
  { termino: 'Whisper', estricto: true }, // "whisper" en minúscula es un verbo
  { termino: 'OpenAI', estricto: false },
  { termino: 'ChatGPT', estricto: false },
  { termino: 'NVIDIA', estricto: false },
  { termino: 'GPT', estricto: false }
];

// Prefijo del marcador. Tiene que ser algo que el modelo copie tal cual y que
// no aparezca nunca en texto real. Se deja como constante porque, si en las
// pruebas en Chrome se viera que el modelo lo destroza, aquí es donde se
// cambia (y la prueba de Node seguiría valiendo).
const PREFIJO_MARCA = 'Xk';

// Escapa lo que pueda romper una expresión regular.
function escapar(texto) {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Los términos largos primero: así "Reality Labs" gana a "Reality".
function porLongitud(a, b) {
  return b.termino.length - a.termino.length;
}

/**
 * Sustituye los términos protegidos por marcadores.
 *
 * @param {string} texto
 * @returns {{ texto: string, marcas: Array<{marca: string, termino: string}> }}
 */
export function proteger(texto) {
  if (typeof texto !== 'string' || !texto) return { texto: texto || '', marcas: [] };

  let resultado = texto;
  const marcas = [];

  for (const { termino, estricto } of [...TERMINOS].sort(porLongitud)) {
    // \b no funciona bien con términos que empiezan o acaban en no-letra, pero
    // todos los nuestros son alfanuméricos, así que es seguro.
    const patron = new RegExp(`\\b${escapar(termino)}\\b`, estricto ? 'g' : 'gi');
    if (!patron.test(resultado)) continue;

    const marca = `${PREFIJO_MARCA}${marcas.length}`;
    resultado = resultado.replace(patron, marca);
    marcas.push({ marca, termino });
  }

  return { texto: resultado, marcas };
}

/**
 * Devuelve los términos a su sitio después de traducir.
 *
 * Es tolerante a propósito: el modelo puede cambiar el marcador de mayúsculas
 * o meterle espacios ("Xk0" -> "xk 0"). Lo que NO hace es inventar: si un
 * marcador desapareció del todo, se informa en `perdidas` en vez de colar un
 * término donde no toca.
 *
 * @param {string} texto traducción que todavía contiene los marcadores
 * @param {Array<{marca: string, termino: string}>} marcas
 * @returns {{ texto: string, perdidas: string[] }}
 */
export function restaurar(texto, marcas) {
  if (typeof texto !== 'string') return { texto: '', perdidas: [] };
  if (!Array.isArray(marcas) || marcas.length === 0) return { texto, perdidas: [] };

  let resultado = texto;
  const perdidas = [];

  // De mayor índice a menor: si no, el patrón de "Xk1" encajaría dentro de
  // "Xk10" y restauraríamos el término equivocado.
  const ordenadas = [...marcas].sort(
    (a, b) => Number(b.marca.slice(PREFIJO_MARCA.length)) - Number(a.marca.slice(PREFIJO_MARCA.length))
  );

  for (const { marca, termino } of ordenadas) {
    const indice = marca.slice(PREFIJO_MARCA.length);
    // Tolera espacios intercalados y cualquier capitalización.
    const patron = new RegExp(
      `${escapar(PREFIJO_MARCA).split('').join('\\s*')}\\s*${indice}`,
      'gi'
    );

    if (patron.test(resultado)) {
      resultado = resultado.replace(patron, termino);
    } else {
      perdidas.push(termino);
    }
  }

  return { texto: resultado.replace(/\s+/g, ' ').trim(), perdidas };
}

/**
 * Red de seguridad: si por lo que sea quedara un marcador suelto, no se le
 * enseña al usuario. Mejor un hueco que un "Xk0" en pantalla.
 */
export function limpiarMarcadoresSueltos(texto) {
  if (typeof texto !== 'string') return '';
  const patron = new RegExp(`\\b${escapar(PREFIJO_MARCA)}\\s*\\d+\\b`, 'gi');
  return texto.replace(patron, '').replace(/\s+([,.;:!?])/g, '$1').replace(/\s+/g, ' ').trim();
}

export const _interno = { TERMINOS, PREFIJO_MARCA };
