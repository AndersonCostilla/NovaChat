// tests/test-tope-voz.mjs
//
// Dos cosas que el encargo del 8-oct-2026 (noche) pedía confirmar:
//
//   1. Que el detector filtra ANTES de encolar para traducir, no después.
//   2. Que el presupuesto por frase de la cola de voz hace lo que se dice.
//
// La 1 es una comprobación de ORDEN DEL CÓDIGO: se lee el fuente y se miran
// las posiciones. Es nivel 1, no verificación en Chrome, y se etiqueta así.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

let hechas = 0;
function comprobar(nombre, fn) {
  fn();
  hechas++;
  console.log(`  ✔ ${nombre}`);
}

console.log('\n── 1) ¿Hay una ventana entre aceptar el texto y comprobarlo? ──');

const offscreen = await readFile(new URL('../offscreen.js', import.meta.url), 'utf-8');
const traductor = await readFile(new URL('../traductor.js', import.meta.url), 'utf-8');

comprobar('el detector se ejecuta ANTES de la llamada a traducir()', () => {
  const analiza = offscreen.indexOf('analizarTrozos(');
  const traduce = offscreen.indexOf('traductor?.traducir(');
  assert.ok(analiza > 0, 'no se encuentra analizarTrozos()');
  assert.ok(traduce > 0, 'no se encuentra traductor.traducir()');
  assert.ok(analiza < traduce, 'el detector corre DESPUÉS de encolar: hay ventana');
});

comprobar('el saneado reasigna el texto antes de esa llamada', () => {
  const sanea = offscreen.indexOf('texto = saneado.trozos.join');
  const traduce = offscreen.indexOf('traductor?.traducir(');
  assert.ok(sanea > 0 && sanea < traduce);
});

comprobar('traducir() es el ÚNICO sitio donde se encola', () => {
  // Si hubiera otra vía de entrada a la cola, el filtro se podría saltar.
  const llamadas = offscreen.match(/\.traducir\(/g) || [];
  assert.equal(llamadas.length, 1, `hay ${llamadas.length} llamadas a traducir()`);
  const push = traductor.match(/cola\.push\(/g) || [];
  assert.equal(push.length, 1, `hay ${push.length} sitios que llenan la cola`);
});

comprobar('el push a la cola ocurre dentro de traducir(), no antes', () => {
  const declara = traductor.indexOf('function traducir(texto)');
  const push = traductor.indexOf('cola.push({ id, texto, resolver })');
  assert.ok(declara > 0 && push > declara);
});

console.log('\n── 2) El presupuesto por frase de la cola de voz ──');

// Reglas reales de voz-sistema.js: tope = max(MINIMO, origen x OCUPACION),
// y sólo se corta si hay alguien esperando.
const TOPE_OCUPACION = 4;
const TOPE_MINIMO_MS = 10000;

function seCorta({ llevaMs, segundosOrigen, enCola, activo }) {
  if (!activo) return false;
  if (!segundosOrigen) return false;
  const topeMs = Math.max(TOPE_MINIMO_MS, segundosOrigen * 1000 * TOPE_OCUPACION);
  return llevaMs > topeMs && enCola > 0;
}

comprobar('la fila #23 (92 s para 12,03 s) se habría cortado', () => {
  assert.equal(
    seCorta({ llevaMs: 92000, segundosOrigen: 12.03, enCola: 2, activo: true }),
    true
  );
  // El tope para esa frase son 48,1 s: se corta en el primer hueco entre
  // fragmentos que haya pasado de ahí, no a los 92.
  assert.ok(12.03 * TOPE_OCUPACION < 50);
});

comprobar('la #57 (102,95 s) también', () => {
  assert.equal(
    seCorta({ llevaMs: 102950, segundosOrigen: 12.03, enCola: 1, activo: true }),
    true
  );
});

comprobar('NO se corta si no hay nadie esperando', () => {
  // Una frase larga que no bloquea a nadie no hace daño a nadie. Cortarla
  // sería perder contenido a cambio de nada.
  assert.equal(
    seCorta({ llevaMs: 92000, segundosOrigen: 12.03, enCola: 0, activo: true }),
    false
  );
});

comprobar('NO se corta con el interruptor apagado', () => {
  assert.equal(
    seCorta({ llevaMs: 92000, segundosOrigen: 12.03, enCola: 2, activo: false }),
    false
  );
});

comprobar('una frase legítima no se acerca al tope', () => {
  // Proporción ES/EN medida: 1,11. Una frase de 12,03 s habla unos 13,4 s.
  assert.equal(
    seCorta({ llevaMs: 13400, segundosOrigen: 12.03, enCola: 2, activo: true }),
    false
  );
  // Ni siquiera el doble de lo medido.
  assert.equal(
    seCorta({ llevaMs: 26700, segundosOrigen: 12.03, enCola: 2, activo: true }),
    false
  );
});

comprobar('el suelo protege a las frases cortas', () => {
  // Una frase de 1 s: 4x serían 4 s, demasiado poco margen para una voz que
  // arranca con retardo. El suelo lo sube a 10 s.
  assert.equal(seCorta({ llevaMs: 6000, segundosOrigen: 1, enCola: 2, activo: true }), false);
  assert.equal(seCorta({ llevaMs: 11000, segundosOrigen: 1, enCola: 2, activo: true }), true);
});

console.log('\n── 3) Por qué el "vaciado rápido" NO era la solución ──');

// La cola ya está topada a 2 (VOZ_SISTEMA.MAX_EN_COLA) y tira la MÁS ANTIGUA
// en cuanto se pasa. Vaciarla más deprisa sólo descarta más contenido: no
// devuelve el altavoz ni un segundo antes.
function simularCascada({ segundosLocucion, llegaCadaS, duracionS, maxEnCola }) {
  let perdidas = 0;
  let cola = 0;
  for (let t = 0; t < duracionS; t += llegaCadaS) {
    if (t < segundosLocucion) {
      cola++;
      while (cola > maxEnCola) {
        cola--;
        perdidas++;
      }
    } else {
      cola = Math.max(0, cola - 1);
    }
  }
  return perdidas;
}

comprobar('vaciar la cola más agresivamente PIERDE MÁS, no menos', () => {
  const base = { segundosLocucion: 92, llegaCadaS: 6, duracionS: 120 };
  const con2 = simularCascada({ ...base, maxEnCola: 2 });
  const con0 = simularCascada({ ...base, maxEnCola: 0 }); // "vaciado rápido"
  assert.ok(con0 >= con2, `vaciado rápido ${con0} vs actual ${con2}`);
});

comprobar('acortar la locución SÍ reduce la cascada', () => {
  const base = { llegaCadaS: 6, duracionS: 120, maxEnCola: 2 };
  const sinTope = simularCascada({ ...base, segundosLocucion: 92 });
  const conTope = simularCascada({ ...base, segundosLocucion: 48 }); // 4x
  assert.ok(conTope < sinTope, `${conTope} vs ${sinTope}`);
  // El cuello de botella es el altavoz ocupado, no la profundidad de la cola.
});

console.log(`\n${hechas} comprobaciones correctas.\n`);
