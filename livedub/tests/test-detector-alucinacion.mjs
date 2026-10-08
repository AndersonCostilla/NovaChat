// tests/test-detector-alucinacion.mjs
//
// La frase #57 del 8-oct-2026 y sus parientes.
//
// Lo que más importa aquí NO es que cace la alucinación —eso es fácil—, sino
// que NO toque el habla real. Un detector que de vez en cuando corta una
// frase legítima es peor que no tener detector, porque la pérdida pasa a ser
// invisible.

import assert from 'node:assert/strict';
import { trocearEnOraciones } from '../segmentador.js';
import { analizarTrozos, sanearTrozos, TROZOS_MAXIMOS } from '../detector-alucinacion.js';

let hechas = 0;
function comprobar(nombre, fn) {
  fn();
  hechas++;
  console.log(`  ✔ ${nombre}`);
}

const trocear = (t) => trocearEnOraciones(t);

console.log('\n── Caza la alucinación real ──');

comprobar('la #57 exacta: 111 x "Es interesante." sobre 12,03 s', () => {
  const trozos = trocear(Array(111).fill('Es interesante.').join(' '));
  assert.equal(trozos.length, 111);

  const a = analizarTrozos(trozos, { segundosAudio: 12.03 });
  assert.equal(a.esSospechosa, true);
  assert.equal(a.unicos, 1);
  assert.equal(a.repeticionSeguidaMaxima, 111);
  assert.equal(a.oracionesPorSegundo, 9.23);
  assert.equal(a.motivos.length, 3); // los tres criterios la señalan

  const s = sanearTrozos(trozos);
  assert.equal(s.trozos.length, 3);
  assert.equal(s.quitadosPorRepeticion, 108);
  assert.equal(s.quitadosPorTope, 0); // no hizo falta el tope duro
  assert.equal(s.seCorto, false);
});

comprobar('los subtítulos fantasma también', () => {
  const trozos = trocear(Array(12).fill('Subtitles by the Amara.org community.').join(' '));
  assert.equal(analizarTrozos(trozos, { segundosAudio: 12.03 }).esSospechosa, true);
  assert.equal(sanearTrozos(trozos).trozos.length, 3);
});

comprobar('una fuga no repetitiva la para el tope duro', () => {
  // 40 oraciones distintas en 12 s: no es repetición, pero tampoco es habla.
  const trozos = trocear(
    Array.from({ length: 40 }, (_, i) => `Frase número ${i} de la lista.`).join(' ')
  );
  const a = analizarTrozos(trozos, { segundosAudio: 12.03 });
  assert.equal(a.esSospechosa, true);
  assert.equal(a.ratioUnicos, 1); // no hay repetición ninguna
  assert.match(a.motivos[0], /tope plausible/);

  const s = sanearTrozos(trozos);
  assert.equal(s.trozos.length, TROZOS_MAXIMOS);
  assert.equal(s.quitadosPorRepeticion, 0);
  assert.equal(s.seCorto, true); // y AVISA de que ha cortado contenido
});

console.log('\n── Y, sobre todo, NO toca el habla real ──');

comprobar('habla normal: ni sospecha ni cambia nada', () => {
  const reales = [
    'This is the first point. And here is the second one. Finally, the third thing.',
    'The thing about this is that it works really well in practice.',
    'Yes. Okay. Right. Sure. Got it. Fine. Yeah.',
    'Se siente muy bien y de manera similar.',
    Array(60).fill('word').join(' ') // 12 s sin puntuación
  ];
  for (const texto of reales) {
    const trozos = trocear(texto);
    const a = analizarTrozos(trozos, { segundosAudio: 12.03 });
    assert.equal(a.esSospechosa, false, `falso positivo en: ${texto.slice(0, 40)}`);
    assert.deepEqual(sanearTrozos(trozos).trozos, trozos);
  }
});

comprobar('la insistencia humana se respeta: "No. No. No. No lo haré."', () => {
  // Desduplicar a una sola copia habría cambiado una frase legítima. Se
  // conservan hasta tres repeticiones seguidas.
  const trozos = trocear('No. No. No. I will not do that.');
  assert.equal(analizarTrozos(trozos, { segundosAudio: 6 }).esSospechosa, false);
  assert.deepEqual(sanearTrozos(trozos).trozos, trozos);
});

comprobar('con pocas oraciones no se evalúa la repetición', () => {
  // "Sí. Sí." no puede ser sospechoso de nada.
  const trozos = trocear('Sí. Sí.');
  assert.equal(analizarTrozos(trozos, { segundosAudio: 2 }).esSospechosa, false);
});

comprobar('justo en el tope (15) todavía pasa', () => {
  const trozos = trocear(
    Array.from({ length: TROZOS_MAXIMOS }, (_, i) => `Oración ${i} aquí.`).join(' ')
  );
  assert.equal(trozos.length, TROZOS_MAXIMOS);
  assert.equal(analizarTrozos(trozos, { segundosAudio: 12.03 }).esSospechosa, false);
});

console.log('\n── El número 15 está justificado, no elegido ──');

comprobar('15 oraciones en 12,03 s son 0,80 s por oración', () => {
  const segundosPorOracion = 12.03 / TROZOS_MAXIMOS;
  assert.ok(segundosPorOracion < 0.81 && segundosPorOracion > 0.79);
  // Una oración hablada más corta que eso, sostenida toda la frase, no es
  // habla natural. Por eso este tope no puede recortar contenido real.
});

console.log('\n── Entradas raras ──');

comprobar('no revienta con basura', () => {
  for (const v of [null, undefined, [], ['', '   '], 'texto suelto']) {
    const a = analizarTrozos(v);
    assert.equal(typeof a.esSospechosa, 'boolean');
    assert.ok(Array.isArray(sanearTrozos(v).trozos));
  }
});

console.log(`\n${hechas} comprobaciones correctas.\n`);
