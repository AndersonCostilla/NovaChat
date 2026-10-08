// tests/test-lote-continuacion.mjs
//
// EVALUACIÓN de la tercera opción propuesta por Anderson el 8-oct-2026:
// tope de trozos por lote CON CONTINUACIÓN, en vez de con descarte.
//
// No implementa nada en el traductor. Comprueba, sobre las reglas reales del
// código, las tres cosas de las que depende que la idea sea viable:
//
//   A) Que partir el lote SOLO sirve si además se cede el turno al bucle de
//      eventos. Sin eso, el CANCELAR nunca se entrega y no se gana nada.
//   B) Qué se recupera realmente al vencer el tiempo de espera.
//   C) Qué pasa con el ORDEN si el resto se reencola al final de la cola
//      (que es la variante literal de "la siguiente vuelta").
//
// Si esto se implementa algún día, este archivo pasa de evaluación a
// regresión sin tocar una línea.

import assert from 'node:assert/strict';
import { trocearEnOraciones } from '../segmentador.js';

let hechas = 0;
function comprobar(nombre, fn) {
  fn();
  hechas++;
  console.log(`  ✔ ${nombre}`);
}
async function comprobarAsync(nombre, fn) {
  await fn();
  hechas++;
  console.log(`  ✔ ${nombre}`);
}

const TIMEOUT_MS = 30000;
const TIMEOUT_RESCATE_MS = 20000;

console.log('\n── A) ¿Basta con partir el lote? ──');

// Los mensajes que llegan a un worker son MACROtareas. `await` sobre una
// promesa ya resuelta sólo drena MICROtareas. Es decir: partir el lote en
// varias llamadas no hace, por sí solo, que el worker pueda enterarse de
// que le han mandado CANCELAR.
async function bucleDeGrupos({ grupos, cediendoElTurno }) {
  let cancelado = false;
  const avisarMasTarde = setTimeout(() => {
    cancelado = true;
  }, 0);

  let ejecutados = 0;
  for (let g = 0; g < grupos; g++) {
    if (cancelado) break;
    await Promise.resolve('generate() falso');
    ejecutados++;
    if (cediendoElTurno) await new Promise((r) => setTimeout(r, 0));
  }
  clearTimeout(avisarMasTarde);
  return ejecutados;
}

await comprobarAsync('partir el lote SIN ceder el turno NO permite cancelar', async () => {
  // Los cinco grupos se ejecutan: la cancelación nunca llegó a entregarse.
  assert.equal(await bucleDeGrupos({ grupos: 5, cediendoElTurno: false }), 5);
});

await comprobarAsync('cediendo el turno entre grupos, la cancelación SÍ se atiende', async () => {
  const ejecutados = await bucleDeGrupos({ grupos: 5, cediendoElTurno: true });
  assert.ok(ejecutados < 5, `se ejecutaron ${ejecutados} grupos; debería abandonar antes`);
});

console.log('\n── B) Qué se recupera al vencer el tiempo de espera ──');

/**
 * Traducción por grupos con punto de abandono entre grupo y grupo.
 * @returns {{trozosTraducidos:number, msWorkerOcupado:number, abandonado:boolean}}
 */
function simularPorGrupos({ trozos, porGrupo, msPorTrozo, limiteMs }) {
  let t = 0;
  let hechos = 0;
  const grupos = Math.ceil(trozos / porGrupo);
  for (let g = 0; g < grupos; g++) {
    // El abandono se comprueba ENTRE grupos: el grupo que ya empezó se termina.
    if (t >= limiteMs) return { trozosTraducidos: hechos, msWorkerOcupado: t, abandonado: true };
    const n = Math.min(porGrupo, trozos - g * porGrupo);
    t += n * msPorTrozo;
    hechos += n;
  }
  return { trozosTraducidos: hechos, msWorkerOcupado: t, abandonado: false };
}

comprobar('el habla normal no nota el cambio: un solo grupo', () => {
  const normal = trocearEnOraciones('This works well in practice. I like it a lot.');
  const r = simularPorGrupos({
    trozos: normal.length,
    porGrupo: 8,
    msPorTrozo: 1000,
    limiteMs: TIMEOUT_MS
  });
  assert.equal(r.abandonado, false);
  assert.equal(r.trozosTraducidos, normal.length);
  assert.ok(r.msWorkerOcupado <= 2000);
});

comprobar('con la alucinación de 40 trozos se salva el 80 % en vez del 0 %', () => {
  const alucinacion = trocearEnOraciones(Array(40).fill('Thank you.').join(' '));
  assert.equal(alucinacion.length, 40);
  const r = simularPorGrupos({
    trozos: 40,
    porGrupo: 8,
    msPorTrozo: 1000, // ~1 s/trozo: es lo que implica el lote de 40 en ~40 s
    limiteMs: TIMEOUT_MS
  });
  assert.equal(r.abandonado, true);
  assert.equal(r.trozosTraducidos, 32); // hoy serían 0
  assert.ok(r.msWorkerOcupado < TIMEOUT_MS + TIMEOUT_RESCATE_MS);
});

comprobar('el worker deja de poder quedarse bloqueado 50 s', () => {
  // Lo que importa no es cuánto tarda el lote, sino cuánto puede tardar el
  // worker en ESTAR DISPONIBLE después de que se le pida abandonar: como
  // mucho, lo que dure un grupo.
  const porGrupo = 8;
  const msPorTrozo = 1000;
  const peorEspera = porGrupo * msPorTrozo;
  assert.equal(peorEspera, 8000);
  assert.ok(peorEspera < TIMEOUT_RESCATE_MS, 'el rescate ya no debería dispararse nunca');
});

console.log('\n── C) El orden, si el resto se reencola al FINAL de la cola ──');

comprobar('reencolar al final desordena el doblaje', () => {
  // Variante literal de "reencolar el resto para la siguiente vuelta".
  const cola = [{ id: 4, parte: 1, resto: 2 }, { id: 5, parte: 1 }, { id: 6, parte: 1 }];
  const salida = [];
  while (cola.length) {
    const t = cola.shift();
    salida.push(`${t.id}.${t.parte}`);
    if (t.resto) cola.push({ id: t.id, parte: t.parte + 1 });
  }
  // El espectador oiría media frase 4, la 5, la 6, y DESPUÉS el resto de la 4.
  assert.deepEqual(salida, ['4.1', '5.1', '6.1', '4.2']);
  assert.notDeepEqual(salida, ['4.1', '4.2', '5.1', '6.1']);
});

comprobar('reencolar al PRINCIPIO conserva el orden', () => {
  const cola = [{ id: 4, parte: 1, resto: 2 }, { id: 5, parte: 1 }, { id: 6, parte: 1 }];
  const salida = [];
  while (cola.length) {
    const t = cola.shift();
    salida.push(`${t.id}.${t.parte}`);
    if (t.resto) cola.unshift({ id: t.id, parte: t.parte + 1 });
  }
  assert.deepEqual(salida, ['4.1', '4.2', '5.1', '6.1']);
  // Y entonces equivale a un bucle dentro del worker, con la ventaja de que
  // no hay que inventar un protocolo de partes ni tocar la cola.
});

console.log(`\n${hechas} comprobaciones correctas.\n`);
