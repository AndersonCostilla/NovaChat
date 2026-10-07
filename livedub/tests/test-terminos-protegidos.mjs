// Prueba de la lista de términos protegidos (Fase 4).
//
// Reproduce el error real que encontró Anderson: "the llama models" traducido
// como "los modelos de las 'Joyas'". OPUS-MT no conoce Llama (su corpus es de
// ~2020) y "llama" es además una palabra española corriente.
//
// El modelo simulado de aquí abajo comete ESE error a propósito, para que la
// prueba demuestre que el mecanismo lo evita en vez de darlo por supuesto.

import { proteger, restaurar, limpiarMarcadoresSueltos, _interno } from '../terminos-protegidos.js';

let fallos = 0;
const comprobar = (nombre, condicion, extra = '') => {
  console.log(`${condicion ? '  ✔' : '  ✘'} ${nombre}${extra ? ` → ${extra}` : ''}`);
  if (!condicion) fallos++;
};

/* ------------------------------------------------------------------ */
/* Modelo simulado: traduce mal justo lo que nos duele                 */
/* ------------------------------------------------------------------ */

const DICCIONARIO_MALO = {
  llama: "las 'Joyas'", // el error real medido en Chrome
  meta: 'objetivo',
  quest: 'búsqueda',
  whisper: 'susurro',
  the: 'los',
  models: 'modelos',
  of: 'de',
  and: 'y'
};

// Traduce palabra a palabra y COPIA los marcadores tal cual, que es lo que
// hace un modelo de traducción con un token que no reconoce.
function modeloSimulado(texto, { destrozarMarcadores = false } = {}) {
  return texto
    .split(/\s+/)
    .map((palabra) => {
      const limpio = palabra.replace(/[^\w']/g, '');
      const clave = limpio.toLowerCase();

      if (/^xk\d+$/i.test(clave)) {
        // Un modelo real puede cambiar la capitalización o meter un espacio.
        return destrozarMarcadores ? clave.replace(/^xk/i, 'xk ') : palabra;
      }
      return DICCIONARIO_MALO[clave] ?? palabra;
    })
    .join(' ');
}

// Reproduce el encadenado completo de traductor-worker.js.
function traducirProtegido(texto, opciones) {
  const { texto: protegido, marcas } = proteger(texto);
  const crudo = modeloSimulado(protegido, opciones);
  const { texto: restaurado, perdidas } = restaurar(crudo, marcas);
  return { texto: limpiarMarcadoresSueltos(restaurado), perdidas, marcas, protegido };
}

/* ------------------------------------------------------------------ */
console.log('1) El caso real: "the llama models"');

const sinProteger = modeloSimulado('the llama models');
comprobar(
  'sin protección, el modelo simulado comete el error real',
  sinProteger.includes('Joyas'),
  sinProteger
);

const conProteccion = traducirProtegido('the llama models');
comprobar('con protección, "Llama" sobrevive', conProteccion.texto.includes('Llama'), conProteccion.texto);
comprobar('y ya no aparece "Joyas"', !conProteccion.texto.includes('Joyas'), conProteccion.texto);
comprobar('se canonicaliza a mayúscula inicial', /\bLlama\b/.test(conProteccion.texto), conProteccion.texto);
comprobar('no quedan marcadores a la vista', !/Xk\d/i.test(conProteccion.texto), conProteccion.texto);
comprobar('no se perdió ninguna marca', conProteccion.perdidas.length === 0);

/* ------------------------------------------------------------------ */
console.log('\n2) Términos de varias palabras');

const multi = proteger('I work at Reality Labs on Vision Pro');
comprobar('"Reality Labs" se protege entero', multi.marcas.some((m) => m.termino === 'Reality Labs'));
comprobar('"Vision Pro" se protege entero', multi.marcas.some((m) => m.termino === 'Vision Pro'));
comprobar(
  'no queda la palabra "Reality" suelta sin proteger',
  !/\bReality\b/.test(multi.texto),
  multi.texto
);

const restauradoMulti = restaurar(modeloSimulado(multi.texto), multi.marcas);
comprobar(
  'ambos vuelven intactos tras traducir',
  restauradoMulti.texto.includes('Reality Labs') && restauradoMulti.texto.includes('Vision Pro'),
  restauradoMulti.texto
);

/* ------------------------------------------------------------------ */
console.log('\n3) Modo estricto: no protege de más');

const estricto = proteger('my meta goal is to meta think');
comprobar(
  '"meta" en minúscula NO se protege (es palabra común)',
  estricto.marcas.length === 0,
  JSON.stringify(estricto.texto)
);

const estrictoMayus = proteger('Meta announced something');
comprobar('"Meta" con mayúscula SÍ se protege', estrictoMayus.marcas.some((m) => m.termino === 'Meta'));

const noEstricto = proteger('the LLAMA and llama models');
comprobar(
  '"Llama" se protege en cualquier capitalización',
  noEstricto.marcas.some((m) => m.termino === 'Llama'),
  noEstricto.texto
);

comprobar(
  'no se protege dentro de otra palabra',
  proteger('metadata and questionable').marcas.length === 0,
  JSON.stringify(proteger('metadata and questionable').texto)
);

/* ------------------------------------------------------------------ */
console.log('\n4) Tolerancia: el modelo maltrata el marcador');

const maltratado = traducirProtegido('the llama models', { destrozarMarcadores: true });
comprobar(
  'se restaura aunque el marcador venga con espacio y en minúscula',
  maltratado.texto.includes('Llama'),
  maltratado.texto
);

/* ------------------------------------------------------------------ */
console.log('\n5) Si el marcador desaparece, se informa y NO se inventa');

const { marcas } = proteger('the llama models');
const perdido = restaurar('los modelos', marcas); // el marcador se evaporó
comprobar('se reporta la pérdida', perdido.perdidas.includes('Llama'), JSON.stringify(perdido.perdidas));
comprobar('no se mete el término a la fuerza', !perdido.texto.includes('Llama'), perdido.texto);
comprobar('el texto sigue siendo legible', perdido.texto === 'los modelos', perdido.texto);

/* ------------------------------------------------------------------ */
console.log('\n6) Índices de dos cifras no se pisan');

const muchos = [];
for (let i = 0; i < 12; i++) muchos.push({ marca: `Xk${i}`, termino: `TERMINO${i}` });
const textoMuchos = muchos.map((m) => m.marca).join(' ');
const restauradoMuchos = restaurar(textoMuchos, muchos);
comprobar(
  'Xk1 no se come a Xk10',
  restauradoMuchos.texto === muchos.map((m) => m.termino).join(' '),
  restauradoMuchos.texto
);

/* ------------------------------------------------------------------ */
console.log('\n7) Red de seguridad y casos límite');

comprobar(
  'un marcador suelto nunca llega al usuario',
  limpiarMarcadoresSueltos('los modelos Xk3 son buenos') === 'los modelos son buenos',
  limpiarMarcadoresSueltos('los modelos Xk3 son buenos')
);
comprobar(
  'no deja espacio antes de la puntuación',
  limpiarMarcadoresSueltos('es Xk0, claro') === 'es, claro',
  limpiarMarcadoresSueltos('es Xk0, claro')
);
comprobar('texto vacío no rompe', proteger('').marcas.length === 0);
comprobar('valor no string no rompe', proteger(null).texto === '');
comprobar('restaurar sin marcas devuelve el texto igual', restaurar('hola', []).texto === 'hola');
comprobar(
  'texto sin términos protegidos pasa intacto',
  proteger('this is a normal sentence').texto === 'this is a normal sentence'
);
comprobar('la lista de términos no está vacía', _interno.TERMINOS.length > 0, `${_interno.TERMINOS.length} términos`);

console.log(`\nRESULTADO: ${fallos === 0 ? 'TODO CORRECTO ✔' : `${fallos} FALLO(S) ✘`}`);
process.exit(fallos === 0 ? 0 : 1);
