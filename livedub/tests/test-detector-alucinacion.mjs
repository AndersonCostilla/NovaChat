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
import {
  analizarTrozos,
  sanearTrozos,
  TROZOS_MAXIMOS,
  TROZOS_AVISO,
  segundosDeHabla,
  repeticionInterna,
  esRepeticionInternaPatologica
} from '../detector-alucinacion.js';

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
  assert.equal(a.motivos.length, 4); // densidad, pocos únicos, repetición y duración

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
  assert.match(a.motivos[0], /no es habla/);
  assert.equal(a.superaElTopeDuro, true);

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
    // 12 s de habla seguida sin ningún punto. (La versión anterior de este
    // caso era "word" x60, y el detector la marcó: con razón, porque eso ES
    // una repetición. Una muestra degenerada no sirve de control.)
    'so what we are looking at here is a situation where the speaker simply ' +
      'does not pause for breath and keeps going without any punctuation at all'
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

comprobar('justo en el umbral de aviso (8) todavía pasa', () => {
  const trozos = trocear(
    Array.from({ length: TROZOS_AVISO }, (_, i) => `Oración ${i} aquí.`).join(' ')
  );
  assert.equal(trozos.length, TROZOS_AVISO);
  assert.equal(analizarTrozos(trozos, { segundosAudio: 12.03 }).esSospechosa, false);
});

console.log('\n── LA FRASE #3: lo que el umbral de 15 dejó pasar ──');

comprobar('12 trozos en 12,03 s: AHORA sí se avisa', () => {
  // En producción el detector la dejó pasar (12 < 15) y la traducción se
  // comió 30 s. Una oración por segundo sostenida no es habla.
  const trozos = trocear(
    Array.from({ length: 12 }, (_, i) => `This is sentence number ${i} of the batch.`).join(' ')
  );
  assert.equal(trozos.length, 12);
  const a = analizarTrozos(trozos, { segundosAudio: 12.03 });
  assert.equal(a.esSospechosa, true);
  assert.equal(a.oracionesPorSegundo, 1);
  assert.equal(a.ratioUnicos, 1); // no hay ninguna repetición: sólo densidad
});

comprobar('avisar NO implica cortar: el tope duro sigue en 15', () => {
  // Esto es lo que hace que bajar el umbral de aviso sea seguro.
  const trozos = trocear(
    Array.from({ length: 12 }, (_, i) => `This is sentence number ${i} of the batch.`).join(' ')
  );
  assert.equal(analizarTrozos(trozos).superaElTopeDuro, false);
  assert.deepEqual(sanearTrozos(trozos).trozos, trozos); // ni un carácter
});

comprobar('la repetición NO SEGUIDA también se caza ahora', () => {
  // "A. B. A. C. A. D. A. E.": ratio de únicos 0,63 y nunca dos seguidas.
  // Los dos criterios viejos la dejaban pasar entera.
  const trozos = ['A uno.', 'B.', 'A uno.', 'C.', 'A uno.', 'D.', 'A uno.', 'E.'];
  const a = analizarTrozos(trozos, { segundosAudio: 12.03 });
  assert.equal(a.repeticionSeguidaMaxima, 1);
  assert.ok(a.ratioUnicos > 0.4);
  assert.equal(a.repeticionTotalMaxima, 4);
  assert.equal(a.dominancia, 0.5);
  // Con 8 trozos ya salta por densidad; lo que se comprueba aquí es que el
  // motivo de la dominancia aparece y la describe bien.
  const conDominancia = analizarTrozos(
    ['A uno.', 'B.', 'A uno.', 'C.', 'A uno.', 'D.', 'A uno.'],
    { segundosAudio: 12.03 }
  );
  assert.equal(conDominancia.esSospechosa, true);
  assert.ok(conDominancia.motivos.some((m) => m.includes('aunque no seguidas')));
});

console.log('\n── LA FILA #23: pocos trozos, muchísimo habla ──');

// 8 trozos (por debajo del umbral de conteo) y 92 s de voz sobre 12,03 s de
// audio: 735 % de ocupación. Contar oraciones nunca iba a cazar esto, porque
// el número de oraciones no es el daño. El daño es el tiempo de altavoz.
const COMO_LA_23 = Array.from(
  { length: 8 },
  (_, i) =>
    `Sentence ${i} and then something else happened in the story which went ` +
    'on and on for a very long while indeed without ever stopping at any point.'
);

comprobar('8 trozos no pasan ningún tope de cantidad', () => {
  assert.equal(COMO_LA_23.length, 8);
  assert.ok(COMO_LA_23.length <= TROZOS_AVISO);
  assert.ok(COMO_LA_23.length <= TROZOS_MAXIMOS);
});

comprobar('y aun así se caza, por la duración del habla que genera', () => {
  const a = analizarTrozos(COMO_LA_23, { segundosAudio: 12.03 });
  assert.equal(a.esSospechosa, true);
  assert.ok(a.proporcionEstimada > 4, `${a.proporcionEstimada}x`);
  assert.equal(a.ratioUnicos, 1); // ninguna repetición: sólo volumen
  assert.equal(a.repeticionSeguidaMaxima, 1);
  assert.ok(a.motivos.some((m) => m.includes('de voz para')));
});

comprobar('y se recorta hasta que cabe en 4x el audio', () => {
  const s = sanearTrozos(COMO_LA_23, { segundosAudio: 12.03 });
  assert.ok(s.quitadosPorDuracion > 0);
  assert.equal(s.seCorto, true); // puede haberse perdido algo real: se avisa
  assert.ok(segundosDeHabla(s.trozos.join(' ').length) <= 12.03 * 4);
  assert.ok(s.trozos.length > 0); // nunca lo deja vacío
});

comprobar('la estimación de habla usa los 17,2 car/s MEDIDOS', () => {
  // 172 caracteres = 10 s a ritmo medido, x1,11 de inflación ES/EN.
  assert.ok(Math.abs(segundosDeHabla(172) - 11.1) < 0.05);
});

comprobar('una frase real de 12 s no se acerca ni de lejos al umbral', () => {
  // Ritmo real: proporción ES/EN 1,11 → unos 230 caracteres en 12,03 s.
  const real = ['This is what a normal twelve second sentence actually looks like when ' +
    'somebody is speaking at a comfortable pace in a documentary or a talk.'];
  const a = analizarTrozos(real, { segundosAudio: 12.03 });
  assert.equal(a.esSospechosa, false);
  assert.ok(a.proporcionEstimada < 2, `${a.proporcionEstimada}x`);
});

console.log('\n── Repetición DENTRO de un mismo trozo ──');

comprobar('"it is interesting" x12 sin puntuación: un solo trozo, y se caza', () => {
  // segmentador.js entregaría esto como UN trozo. Los tres criterios de
  // repetición entre oraciones no ven absolutamente nada.
  const unico = [Array(12).fill('it is interesting').join(' ') + '.'];
  const a = analizarTrozos(unico, { segundosAudio: 12.03 });
  assert.equal(a.total, 1);
  assert.equal(a.ratioUnicos, 1);
  assert.equal(a.repeticionSeguidaMaxima, 1);
  assert.equal(a.esSospechosa, true);
  assert.equal(a.repeticionInterna.veces, 12);
  assert.ok(a.motivos.some((m) => m.includes('dentro de una misma oración')));
});

comprobar('al sanearlo quedan tres copias, no una ni doce', () => {
  const unico = [Array(12).fill('it is interesting').join(' ') + '.'];
  const s = sanearTrozos(unico, { segundosAudio: 12.03 });
  const veces = (s.trozos.join(' ').match(/it is interesting/g) || []).length;
  assert.equal(veces, 3);
  assert.ok(s.quitadosPorRepeticionInterna > 0);
});

comprobar('el habla real no tiene repetición interna', () => {
  for (const t of [
    'This is a perfectly normal English sentence with no repetition at all.',
    'We went to the shop and then we went home.',
    'No, no, no, I will not do that.'
  ]) {
    const r = repeticionInterna(t);
    assert.ok(!r || r.veces <= 3, `${t} → ${JSON.stringify(r)}`);
  }
});

console.log('\n── Los dos números están justificados, no elegidos ──');

comprobar('8 oraciones en 12,03 s son 1,5 s por oración', () => {
  const segundosPorOracion = 12.03 / TROZOS_AVISO;
  assert.ok(segundosPorOracion > 1.5 && segundosPorOracion < 1.51);
  // Y es el doble del peor caso de habla real medido (3-4 trozos).
  assert.ok(TROZOS_AVISO >= 2 * 4);
});

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

console.log('\n── LA TANDA DE 64 FRASES: los cuatro cortes que no debían existir ──');

// #31 (3→3), #33 (2→2), #51 (1→1) y #59 (5→5) aparecieron como cortes y se
// contaron como pérdida sin que el número de oraciones bajara.
//
// CAUSA: a analizarTrozos() se le pasaba `duracionMs` —el tiempo que tardó
// WHISPER, mediana 4,31 s— como si fuera la duración del audio, que llega a
// 12,03 s. Dividir por un número unas 3 veces menor infla la proporción
// estimada, y una frase normal a 1,11x aparentaba más de 3x.

// Frase real de 12,03 s a ritmo normal: ~230 caracteres (19,1 car/s de
// origen, deducido de la proporción ES/EN medida de 1,11).
const FRASE_NORMAL = [
  'This is what a normal twelve second stretch of speech actually sounds like ' +
    'when a person is talking at a comfortable pace in a documentary about the ' +
    'history of the railways, with no pauses worth mentioning anywhere in it.'
];

comprobar('la muestra de control tiene el tamaño de una frase real de 12 s', () => {
  // 19,1 caracteres por segundo de origen, deducido de la proporción ES/EN
  // medida (1,11) y de los 17,2 car/s de la voz. 12,03 s → unos 230.
  const esperado = Math.round(12.03 * 19.1);
  assert.ok(
    Math.abs(FRASE_NORMAL[0].length - esperado) < 25,
    `${FRASE_NORMAL[0].length} caracteres, se esperaban ~${esperado}`
  );
});

comprobar('con la duración del audio CORRECTA, no se sospecha nada', () => {
  const a = analizarTrozos(FRASE_NORMAL, { segundosAudio: 12.03 });
  assert.equal(a.esSospechosa, false);
  assert.ok(a.proporcionEstimada < 2, `${a.proporcionEstimada}x`);
});

comprobar('con el tiempo de Whisper (4,31 s) se dispara: el falso positivo', () => {
  // Reproducción exacta del fallo. Esta comprobación es la que habría
  // cazado el bug antes de que llegara a una tanda real.
  const a = analizarTrozos(FRASE_NORMAL, { segundosAudio: 4.31 });
  assert.equal(a.esSospechosa, true);
  assert.ok(a.proporcionEstimada > 3, `${a.proporcionEstimada}x`);
  assert.ok(a.motivos.some((m) => m.includes('de voz para')));
});

comprobar('y aun disparándose, el saneado NO le quitaba nada', () => {
  // Por eso salían como "3 → 3" y "1 → 1": el aviso está en 3x pero el
  // corte en 4x, así que no llegaba a recortar. El daño fue de CONTABILIDAD,
  // no de contenido: esas frases se dijeron enteras.
  const s = sanearTrozos(FRASE_NORMAL, { segundosAudio: 4.31 });
  assert.deepEqual(s.trozos, FRASE_NORMAL);
  assert.equal(s.quitadosPorDuracion, 0);
  assert.equal(s.seCorto, false);
});

comprobar('sin duración del audio, los criterios de tiempo no se evalúan', () => {
  // Preferible a inventarse un número: si el dato no está, ese criterio
  // calla en vez de adivinar.
  const a = analizarTrozos(FRASE_NORMAL, { segundosAudio: null });
  assert.equal(a.esSospechosa, false);
  assert.equal(a.proporcionEstimada, null); // no se inventa un número
  // Y tampoco se corta por duración sin saber la duración.
  const enorme = Array(40).fill(FRASE_NORMAL[0]);
  assert.equal(sanearTrozos(enorme, { segundosAudio: null }).quitadosPorDuracion, 0);
});

console.log('\n── Falsos positivos de la repetición interna, buscados a propósito ──');

comprobar('"very very very very good" es habla, no alucinación', () => {
  // La primera versión marcaba cualquier bloque de 1 palabra repetido 4
  // veces. Eso es insistencia humana corriente.
  for (const t of [
    'very very very very good',
    'no no no no no',
    'ha ha ha ha ha ha',
    'I I I I think so',
    'and it was really really really important to them at the time'
  ]) {
    assert.equal(esRepeticionInternaPatologica(repeticionInterna(t)), false, t);
    assert.equal(analizarTrozos([t], { segundosAudio: 12.03 }).esSospechosa, false, t);
  }
});

comprobar('un bucle de FRASE sí se sigue cazando', () => {
  for (const t of [
    'it is interesting it is interesting it is interesting it is interesting',
    'thank you thank you thank you thank you thank you'
  ]) {
    assert.equal(esRepeticionInternaPatologica(repeticionInterna(t)), true, t);
  }
});

comprobar('una palabra repetida MUCHO sí es un bucle', () => {
  const t = Array(12).fill('yeah').join(' ');
  assert.equal(esRepeticionInternaPatologica(repeticionInterna(t)), true);
});

comprobar('un inciso repetido dentro de una oración larga NO se toca', () => {
  // Cobertura: el bloque repetido tiene que ocupar la mayor parte del
  // trozo. Tres palabras repetidas dentro de treinta son habla.
  const t =
    'so the committee decided that we should move forward move forward move forward ' +
    'with the plan that had been discussed during the previous meeting in the spring';
  assert.equal(esRepeticionInternaPatologica(repeticionInterna(t)), false);
});

console.log(`\n${hechas} comprobaciones correctas.\n`);
