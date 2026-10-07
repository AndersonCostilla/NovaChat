// Prueba del troceo en oraciones y del truncamiento de OPUS-MT (Fase 4).
//
// Reproduce el bug de calidad que reportó Anderson con 9 muestras reales: al
// mandarle a OPUS-MT un bloque con varias oraciones, el modelo traduce UNA y
// se come las demás. No era un límite de longitud (el tope de 257 tokens nunca
// se alcanzaba): es que Marian está entrenado con oraciones sueltas.
//
// Aquí se simula ese comportamiento con un "modelo" que, ante un texto con
// varias oraciones, devuelve sólo una. Con el troceo, no se pierde nada.

import { trocearEnOraciones, unirTraducciones } from '../segmentador.js';

let fallos = 0;
const comprobar = (nombre, condicion, extra = '') => {
  console.log(`${condicion ? '  ✔' : '  ✘'} ${nombre}${extra ? ` → ${extra}` : ''}`);
  if (!condicion) fallos++;
};

/* ------------------------------------------------------------------ */
/* Modelo simulado que imita el defecto real de OPUS-MT                */
/* ------------------------------------------------------------------ */

// Traduce "de mentira" (marca cada oración) pero copia el fallo de verdad:
// si la entrada tiene más de una oración, sólo sobrevive una.
function modeloOpusMtSimulado(entrada) {
  const textos = Array.isArray(entrada) ? entrada : [entrada];
  return textos.map((texto) => {
    const oraciones = texto.split(/(?<=[.!?…])\s+/).filter(Boolean);
    const superviviente = oraciones[oraciones.length - 1] ?? texto; // se queda la última
    return { translation_text: `[es]${superviviente.trim()}` };
  });
}

// Reproduce lo que hace traducir() en traductor-worker.js.
function traducirConTroceo(texto) {
  const trozos = trocearEnOraciones(texto);
  const salida = modeloOpusMtSimulado(trozos);
  return unirTraducciones(salida.map((s) => s.translation_text));
}

/* ------------------------------------------------------------------ */
console.log('1) Casos reales de Anderson (los 3 que salieron truncados)');

const CASOS = [
  {
    nombre: 'caso 1 (4 oraciones, sólo sobrevivía la última)',
    en:
      "special type of display system. These aren't normal displays. You have a phone " +
      "or a TV computer like the type of display that people have been building for " +
      "decades. It's a way of God's system.",
    oracionesEsperadas: 4
  },
  {
    nombre: 'caso 2 (3 oraciones, sólo sobrevivía la del medio)',
    en:
      "you're looking. There's eye tracking and the camera is the illuminate your eyes. " +
      'Of course there\'s all the basic stuff that you need, all the computing, the batteries,',
    oracionesEsperadas: 3
  },
  {
    nombre: 'caso 3 (cortaba antes del final)',
    en:
      'So that probably is still not covering everything because there\'s a lot of ' +
      'things that need to go into thinking up the holographic.',
    oracionesEsperadas: 1
  }
];

for (const caso of CASOS) {
  const trozos = trocearEnOraciones(caso.en);
  comprobar(
    `${caso.nombre}: se detectan ${caso.oracionesEsperadas} trozo(s)`,
    trozos.length === caso.oracionesEsperadas,
    `obtuvo ${trozos.length}`
  );

  // SIN troceo (lo que hacíamos antes): el modelo se come casi todo.
  const sinTroceo = unirTraducciones(modeloOpusMtSimulado(caso.en).map((s) => s.translation_text));
  const conTroceo = traducirConTroceo(caso.en);

  if (caso.oracionesEsperadas > 1) {
    comprobar(
      `${caso.nombre}: sin troceo se perdía contenido`,
      sinTroceo.length < conTroceo.length,
      `${sinTroceo.length} vs ${conTroceo.length} caracteres`
    );
  }

  // Con troceo tiene que aparecer TODAS las oraciones originales.
  const todas = trozos.every((t) => conTroceo.includes(t.trim()));
  comprobar(`${caso.nombre}: con troceo no se pierde ninguna oración`, todas);
}

/* ------------------------------------------------------------------ */
console.log('\n2) Textos largos (100+ palabras), que es donde dolía');

const largo = Array.from(
  { length: 12 },
  (_, i) => `This is sentence number ${i + 1} and it carries some additional words to make it longer.`
).join(' ');

comprobar('el texto de prueba supera las 100 palabras', largo.split(/\s+/).length > 100);

const trozosLargo = trocearEnOraciones(largo);
comprobar('se parte en 12 oraciones', trozosLargo.length === 12, `obtuvo ${trozosLargo.length}`);
comprobar(
  'ningún trozo supera las 40 palabras',
  trozosLargo.every((t) => t.split(/\s+/).length <= 40)
);

const traducidoLargo = traducirConTroceo(largo);
comprobar(
  'las 12 oraciones aparecen en la salida',
  Array.from({ length: 12 }, (_, i) => `sentence number ${i + 1}`).every((frag) =>
    traducidoLargo.includes(frag)
  )
);

/* ------------------------------------------------------------------ */
console.log('\n3) Texto sin puntuación (lo que a veces devuelve Whisper)');

const corrido = Array.from({ length: 95 }, (_, i) => `palabra${i + 1}`).join(' ');
const trozosCorrido = trocearEnOraciones(corrido);
comprobar('se trocea igualmente', trozosCorrido.length > 1, `${trozosCorrido.length} trozos`);
comprobar(
  'ningún trozo supera las 40 palabras',
  trozosCorrido.every((t) => t.split(/\s+/).length <= 40)
);
comprobar(
  'no se pierde ni se duplica ninguna palabra',
  trozosCorrido.join(' ').split(/\s+/).length === 95,
  `${trozosCorrido.join(' ').split(/\s+/).length} palabras`
);

/* ------------------------------------------------------------------ */
console.log('\n4) No partir donde no toca');

comprobar(
  'abreviatura "Mr." no parte la oración',
  trocearEnOraciones('Mr. Smith went home. Then he slept.').length === 2,
  JSON.stringify(trocearEnOraciones('Mr. Smith went home. Then he slept.'))
);
comprobar(
  'número decimal no parte la oración',
  trocearEnOraciones('It costs 3. 5 dollars today.').length === 1,
  JSON.stringify(trocearEnOraciones('It costs 3. 5 dollars today.'))
);
comprobar(
  'inicial suelta no parte la oración',
  trocearEnOraciones('J. Smith arrived late.').length === 1,
  JSON.stringify(trocearEnOraciones('J. Smith arrived late.'))
);
comprobar('signos de exclamación y pregunta cuentan', trocearEnOraciones('Really? Yes! Fine.').length === 3);

/* ------------------------------------------------------------------ */
console.log('\n5) Casos límite');

comprobar('texto vacío devuelve lista vacía', trocearEnOraciones('').length === 0);
comprobar('sólo espacios devuelve lista vacía', trocearEnOraciones('   \n  ').length === 0);
comprobar('valor no string devuelve lista vacía', trocearEnOraciones(null).length === 0);
comprobar('una sola palabra se respeta', trocearEnOraciones('Todo').length === 1);
comprobar(
  'unirTraducciones descarta vacíos',
  unirTraducciones(['Hola', '', '   ', 'mundo']) === 'Hola mundo',
  unirTraducciones(['Hola', '', '   ', 'mundo'])
);
comprobar('unirTraducciones con todo vacío devuelve cadena vacía', unirTraducciones(['', '  ']) === '');

console.log(`\nRESULTADO: ${fallos === 0 ? 'TODO CORRECTO ✔' : `${fallos} FALLO(S) ✘`}`);
process.exit(fallos === 0 ? 0 : 1);
