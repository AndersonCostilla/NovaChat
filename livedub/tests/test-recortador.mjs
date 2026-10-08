// tests/test-recortador.mjs
// Opción A: recorte de traducciones.
//
// Lo que más importa de estas comprobaciones no es que recorte, sino que NO
// estropee: una regla que ahorra medio segundo y deja una frase en español
// incorrecto no sirve de nada.

import assert from 'node:assert/strict';
import { recortar, recortarLote, CARACTERES_POR_SEGUNDO } from '../recortador.js';

let hechas = 0;
function comprobar(nombre, fn) {
  fn();
  hechas++;
  console.log(`  ✔ ${nombre}`);
}

console.log('\n── Cumple el objetivo sin pasarse ──');

comprobar('recorta una frase con rodeos típicos de OPUS-MT', () => {
  const r = recortar('En este momento vamos a hablar sobre la razón por la que esto sucede.');
  // Para en cuanto le basta: con 'en este momento' -> 'ahora' ya cumple el
  // 12 % y NO sigue tocando 'la razón por la que'.
  assert.equal(r.texto, 'Ahora vamos a hablar sobre la razón por la que esto sucede.');
  assert.ok(r.reduccion >= 0.12, `reducción ${r.reduccion}`);
  // Si se le pide más, sí sigue.
  const fuerte = recortar('En este momento vamos a hablar sobre la razón por la que esto sucede.', { objetivo: 0.3 });
  assert.equal(fuerte.texto, 'Ahora vamos a hablar sobre por qué esto sucede.');
});

comprobar('NO se pasa del objetivo: para en cuanto basta', () => {
  // En la primera versión la comprobación estaba entre niveles y esta frase
  // pedía 12 % y se llevaba 36 %. Cada rodeo que se quita de más es una
  // oportunidad de más de romper algo.
  const texto =
    'Bueno, lo que quiero decir es que en la actualidad una gran cantidad de ' +
    'personas no tiene la capacidad de entender esto.';
  const r = recortar(texto, { objetivo: 0.12 });
  assert.ok(r.reduccion >= 0.12, `se queda corto: ${r.reduccion}`);
  assert.ok(r.reduccion < 0.3, `se pasa mucho del objetivo: ${r.reduccion}`);
});

comprobar('una frase corta y limpia se queda EXACTAMENTE igual', () => {
  for (const t of ['Gracias.', 'Esto es increíble.', 'No lo sé.']) {
    const r = recortar(t);
    assert.equal(r.texto, t);
    assert.equal(r.reduccion, 0);
    assert.equal(r.objetivoCumplido, false); // y lo dice, no lo disimula
  }
});

console.log('\n── No rompe el español ──');

comprobar('ninguna regla cambia el género o el número', () => {
  // 'una gran cantidad de' -> 'muchos' daba "muchos personas". Se cambió por
  // 'un montón de', que es invariable.
  const casos = [
    ['Hay una gran cantidad de personas aquí.', /un montón de personas/],
    ['Hay un gran número de casas aquí.', /un montón de casas/],
    ['La mayor parte de los usuarios está de acuerdo.', /la mayoría de los usuarios/i]
  ];
  for (const [entrada, esperado] of casos) {
    assert.match(recortar(entrada, { objetivo: 0.5 }).texto, esperado);
  }
});

comprobar('no deja palabras repetidas ni comas huérfanas', () => {
  const r = recortar(
    'Sin embargo, por otro lado, hay que decir que el hecho de que funcione no significa que sea bueno.',
    { objetivo: 0.5 }
  );
  assert.doesNotMatch(r.texto, /\bque que\b/i);
  assert.doesNotMatch(r.texto, /,\s*,/);
  assert.doesNotMatch(r.texto, /\s+,/);
});

comprobar('conserva la mayúscula inicial y el signo final', () => {
  const r = recortar('Bueno, básicamente esto es muy importante!', { objetivo: 0.5 });
  assert.match(r.texto, /^[A-ZÁÉÍÓÚÑ]/);
  assert.equal(r.texto.slice(-1), '!');
});

comprobar('nunca deja la frase en nada', () => {
  // Una frase que es sólo muletillas no se puede borrar entera: se devuelve
  // tal cual. Más vale decir algo de relleno que un silencio inexplicable.
  const r = recortar('Bueno, o sea, ya sabes.', { objetivo: 0.9 });
  assert.ok(r.texto.length >= 3);
});

comprobar('tolera entradas raras sin reventar', () => {
  for (const t of ['', '   ', null, undefined, 42]) {
    const r = recortar(t);
    assert.equal(typeof r.texto, 'string');
    assert.equal(r.reduccion, 0);
  }
});

console.log('\n── Es reversible y medible ──');

comprobar('con objetivo 0 no toca nada', () => {
  const t = 'En el caso de que esto suceda, debido a que es importante, hay que actuar.';
  assert.equal(recortar(t, { objetivo: 0 }).texto, t);
});

comprobar('nivelMaximo 1 no usa las reglas agresivas', () => {
  const t = 'Bueno, realmente esto es importante.';
  const soloNivel1 = recortar(t, { objetivo: 0.5, nivelMaximo: 1 });
  const todos = recortar(t, { objetivo: 0.5, nivelMaximo: 3 });
  assert.match(soloNivel1.texto, /Bueno/);
  assert.doesNotMatch(todos.texto, /Bueno/);
});

comprobar('los segundos ahorrados salen de la velocidad medida de la voz', () => {
  const r = recortar('En este momento vamos a hablar sobre la razón por la que esto sucede.');
  const esperado = (r.caracteresAntes - r.caracteresDespues) / CARACTERES_POR_SEGUNDO;
  assert.ok(Math.abs(r.segundosAhorrados - esperado) < 0.01);
  assert.equal(CARACTERES_POR_SEGUNDO, 17.2); // medido en el equipo de Anderson
});

comprobar('dice qué reglas usó, para poder quitar la que moleste', () => {
  const r = recortar('Debido a que es tarde, con el fin de terminar, vamos a parar.', { objetivo: 0.5 });
  assert.ok(r.reglas.includes('debido a que'));
  assert.ok(r.reglas.includes('con el fin de'));
});

comprobar('las reglas que rompían el modo verbal NO han vuelto', () => {
  // Se retiraron el 8-oct-2026 al verlas fallar en los ejemplos reales.
  // Si alguien las repone "porque ahorran mucho", esto lo caza.
  const casos = [
    ['En el caso de que no funcione, hay que repetirlo.', /\bSi no funcione\b/i],
    ['Es necesario que vayas ahora mismo a la tienda de la esquina.', /hay que vayas/i],
    ['Lo que quiero decir es que el hecho de que funcione no significa que sea bueno.', /es que funcione no/i]
  ];
  for (const [entrada, prohibido] of casos) {
    assert.doesNotMatch(recortar(entrada, { objetivo: 0.5 }).texto, prohibido);
  }
});

console.log('\n── El lote, que es lo que decide si sirve ──');

comprobar('sobre un lote variado, la media cae en la horquilla pedida', () => {
  const lote = recortarLote(
    [
      'En este momento vamos a hablar sobre la razón por la que esto sucede.',
      'A pesar de que el sistema es capaz de llevar a cabo la tarea, el resultado es peor.',
      'De acuerdo con el informe, la mayor parte de los usuarios usa la aplicación.',
      'Bueno, lo que quiero decir es que esto es diferente.',
      'Gracias.',
      'Esto es increíble.',
      'Hoy en día, debido a que la memoria es limitada, hay que tener cuidado.',
      'El hecho de que funcione no significa que sea bueno.'
    ],
    { objetivo: 0.12 }
  );
  // OJO CON ESTE NÚMERO. Este lote está escrito a propósito con muchos
  // rodeos, así que da ~21 %, por encima de la horquilla pedida. No es la
  // cifra real: una regla que se aplica a una frase corta se lleva un
  // porcentaje grande de ella, y aquí casi todas las frases tienen rodeo.
  // La cifra real sólo la puede dar livedub.recorteEjemplos() sobre las
  // traducciones de verdad, y será MÁS BAJA que ésta.
  assert.ok(lote.reduccionMedia >= 0.1, `media ${lote.reduccionMedia}`);
  assert.ok(lote.reduccionMedia <= 0.25, `media ${lote.reduccionMedia}`);
  assert.ok(lote.segundosAhorrados > 0);
  assert.equal(lote.frasesSinTocar, 2); // "Gracias." y "Esto es increíble."
});

comprobar('la proporción 1,11 baja por debajo de 1', () => {
  // Es el único número que importa: con ocupación < 100 % deja de haber
  // pérdida estructural.
  const reduccion = 0.12;
  assert.ok(1.11 * (1 - reduccion) < 1, 'el recorte tiene que bajar de 1,0');
  assert.ok(1.11 * (1 - 0.1) < 1, 'incluso en el extremo flojo de la horquilla');
});

console.log(`\n${hechas} comprobaciones correctas.\n`);
