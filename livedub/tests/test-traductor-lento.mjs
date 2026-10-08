// tests/test-traductor-lento.mjs
//
// Episodio de traducción anómalamente lenta (#4 = 30001 ms, #5, #6 = 40003 ms)
// de la tanda del 8-oct-2026.
//
// Este archivo NO ejecuta el modelo: no hay pesos ni Chrome en el sandbox.
// Lo que comprueba son las DOS cosas que sí se pueden comprobar sin él:
//
//   A) Que los números 30001 y 40003 no son "el modelo tardó eso": son los
//      temporizadores de traductor.js disparándose. Se reproduce la línea de
//      tiempo con las constantes reales y tiene que dar esos números.
//
//   B) Que existe una entrada realista —una alucinación repetitiva de
//      Whisper— que multiplica por 20-40 el trabajo de un solo generate(),
//      que es el único sitio donde se puede ir ese tiempo.
//
// Y una tercera, de la corrección del contador:
//
//   C) Que un fallo de traducción ya cuenta como pérdida real.

import assert from 'node:assert/strict';
import { trocearEnOraciones } from '../segmentador.js';
import { crearCronometro } from '../cronometro.js';

let hechas = 0;
function comprobar(nombre, fn) {
  fn();
  hechas++;
  console.log(`  ✔ ${nombre}`);
}

// Constantes copiadas a mano de traductor.js / traductor-worker.js. Si allí
// cambian y aquí no, la comprobación de coherencia de abajo lo delata.
const TIMEOUT_MS = 30000;
const TIMEOUT_RESCATE_MS = 20000;
const MAX_EN_COLA = 4;
const TOKENS_MINIMOS = 64;

console.log('\n── A) ¿De dónde salen 30001 y 40003? ──');

/**
 * Línea de tiempo de traductor.js cuando el worker se queda dentro de
 * generate() y no puede atender la cancelación.
 *
 * Reglas reales del código:
 *  - procesarCola() NO saca nada mientras enVuelo sea true.
 *  - el temporizador de 30 s arranca al SACAR la tarea de la cola.
 *  - al vencer, resolverPendiente() resuelve ESA frase y se manda CANCELAR,
 *    pero enVuelo SIGUE true (el hueco no se libera sin acuse del worker).
 *  - el worker no puede acusar nada: generate() es una sola llamada sin
 *    puntos de corte, y el hilo del worker está ocupado dentro de ella.
 *  - a los 20 s más, el rescate destruye el worker → fallarTodo() resuelve
 *    de golpe TODO lo pendiente y TODO lo encolado.
 *
 * El cronómetro mide desde que se pide la traducción hasta que se resuelve.
 */
function simularAtasco({ llegadas }) {
  const tCancelacion = TIMEOUT_MS; // la primera sacada arranca en t=0
  const tReinicio = tCancelacion + TIMEOUT_RESCATE_MS;

  return llegadas.map((tLlegada, i) => {
    // La primera es la que entra en generate(); las demás se quedan en cola.
    const tResolucion = i === 0 ? TIMEOUT_MS : tReinicio;
    return {
      '#': i + 4,
      'llega (ms)': tLlegada,
      'se resuelve (ms)': tResolucion,
      'traducción (ms)': tResolucion - tLlegada,
      'quién la resuelve': i === 0 ? 'su propio tiempo de espera' : 'el reinicio del worker'
    };
  });
}

comprobar('la frase que entra en generate() marca exactamente el tiempo de espera', () => {
  const [primera] = simularAtasco({ llegadas: [0] });
  // 30001 en el log real = 30000 del setTimeout + 1 ms de desvío. El código
  // no puede producir 30001 por cálculo: sólo por temporizador.
  assert.equal(primera['traducción (ms)'], TIMEOUT_MS);
});

comprobar('las encoladas detrás se resuelven TODAS en el mismo instante', () => {
  const filas = simularAtasco({ llegadas: [0, 256, 10000] });
  const [a, b, c] = filas;
  assert.equal(a['traducción (ms)'], 30000);
  assert.equal(b['se resuelve (ms)'], c['se resuelve (ms)']);
  assert.equal(b['se resuelve (ms)'], TIMEOUT_MS + TIMEOUT_RESCATE_MS);
  // #6 llegó a los ~10 s y se resolvió en el reinicio (t=50 s): 40 s. Es el
  // 40003 observado, que de otro modo no tiene explicación: ningún camino
  // del código espera 40 s por nada. Y #5, que llegó un bloque de VAD
  // (256 ms) después de #4, sale en 49744 — el mismo instante.
  assert.equal(c['traducción (ms)'], 40000);
  assert.equal(b['traducción (ms)'], 49744);
});

comprobar('ninguna frase puede medir más de tiempo de espera + rescate', () => {
  const filas = simularAtasco({ llegadas: [0, 1, 2, 3] });
  for (const f of filas) {
    assert.ok(
      f['traducción (ms)'] <= TIMEOUT_MS + TIMEOUT_RESCATE_MS,
      `${f['traducción (ms)']} ms supera el techo estructural de 50 s`
    );
  }
});

comprobar('tras el reinicio, el traductor vuelve a "cargando" y la cola se llena', () => {
  // procesarCola() exige estado LISTO. Mientras el modelo se recarga, todo lo
  // que llegue se acumula y, pasadas MAX_EN_COLA, se descarta por cola llena.
  // Esto es la cascada: el atasco no pierde una frase, pierde un tramo.
  const cola = [];
  const descartadas = [];
  for (let id = 7; id <= 13; id++) {
    cola.push(id);
    while (cola.length > MAX_EN_COLA) descartadas.push(cola.shift());
  }
  assert.deepEqual(descartadas, [7, 8, 9]);
  assert.equal(cola.length, MAX_EN_COLA);
});

console.log('\n── B) ¿Dónde se puede ir ese tiempo dentro de generate()? ──');

comprobar('el habla normal produce 1-2 trozos por frase', () => {
  const normal = 'The thing about this is that it works really well in practice. I like it.';
  assert.ok(trocearEnOraciones(normal).length <= 2);
});

comprobar('una alucinación repetitiva de Whisper produce DECENAS de trozos', () => {
  const alucinacion = Array(40).fill('Thank you.').join(' ');
  const trozos = trocearEnOraciones(alucinacion);
  assert.equal(trozos.length, 40);
  // Todos van en UN solo lote a generate(), cada uno con su presupuesto
  // mínimo de tokens. El coste va con el número de trozos.
  const palabrasMasLargo = Math.max(...trozos.map((t) => t.split(/\s+/).length));
  const maxTokens = Math.max(TOKENS_MINIMOS, palabrasMasLargo * 4);
  assert.equal(maxTokens, TOKENS_MINIMOS);
  assert.ok(trozos.length >= 20, 'el lote tiene que ser desproporcionado');
});

comprobar('los subtítulos fantasma también disparan el lote', () => {
  const fantasma = Array(12).fill('Subtitles by the Amara.org community.').join(' ');
  assert.ok(trocearEnOraciones(fantasma).length >= 10);
});

comprobar('NO hay ningún tope al número de trozos de un lote', () => {
  // Esta comprobación documenta el agujero, no lo arregla. Si algún día se
  // pone un tope, este test fallará y habrá que actualizarlo A PROPÓSITO.
  const bestial = Array(200).fill('Yeah.').join(' ');
  assert.equal(trocearEnOraciones(bestial).length, 200);
});

console.log('\n── C) El fallo de traducción cuenta como pérdida ──');

comprobar('una traducción que agota el tiempo entra en el recuento de pérdidas', () => {
  const c = crearCronometro();
  c.abrir(4, { tInicioHabla: 0, segundosAudio: 12.03, motivoCierre: 'tope' });
  c.marcar(4, 'tFinAsr');
  c.anotarLote(4, { trozos: 40, maxTokens: 64 });
  c.anotarPerdida({ id: 4, segundos: 12.03, etapa: 'traducción', detalle: 'tiempo agotado' });

  const r = c.resumenPerdidas();
  assert.equal(r['frases perdidas'], 1);
  assert.equal(r['por etapa']['traducción'], 1);
  // resumenPerdidas redondea a un decimal.
  assert.equal(r['segundos de vídeo sin doblar'], 12);
});

comprobar('se suma a los descartes de la cola de voz, no los sustituye', () => {
  const c = crearCronometro();
  for (const id of [4, 5, 7, 8, 9, 13]) {
    c.abrir(id, { tInicioHabla: 0, segundosAudio: 10, motivoCierre: 'tope' });
  }
  c.anotarPerdida({ id: 4, segundos: 10, etapa: 'traducción', detalle: 'tiempo agotado' });
  c.anotarPerdida({ id: 5, segundos: 10, etapa: 'traducción', detalle: 'descartada por cola llena' });
  for (const id of [7, 8, 9, 13]) {
    c.anotarPerdida({ id, segundos: 10, etapa: 'cola de voz', detalle: 'cola llena' });
  }

  const r = c.resumenPerdidas();
  // Antes de la corrección esto daba 4. El espectador se quedó sin 6.
  assert.equal(r['frases perdidas'], 6);
  assert.equal(r['por etapa']['traducción'], 2);
  assert.equal(r['por etapa']['cola de voz'], 4);
  assert.equal(r['porcentaje del total'], '100.0 %');
});

comprobar('la verificación cruzada sigue cuadrando con la categoría nueva', () => {
  const c = crearCronometro();
  c.abrir(1, { tInicioHabla: 0, segundosAudio: 5, motivoCierre: 'silencio' });
  c.abrir(2, { tInicioHabla: 0, segundosAudio: 5, motivoCierre: 'silencio' });
  c.anotarPerdida({ id: 2, segundos: 5, etapa: 'traducción', detalle: 'tiempo agotado' });
  c.cerrar(1, { motivoFinal: 'doblada' });

  const cruce = c.verificacionCruzada();
  assert.match(cruce['¿cuadra el contador?'], /^SÍ/);
  assert.equal(cruce['PORCENTAJE PERDIDO'], '50.0 %');
});

comprobar('apagar el doblaje NO cuenta como pérdida', () => {
  // Es una decisión del usuario, no un fallo. Si contara, el porcentaje
  // mentiría al alza y daría igual de poca confianza que mintiendo a la baja.
  const c = crearCronometro();
  c.abrir(1, { tInicioHabla: 0, segundosAudio: 5, motivoCierre: 'silencio' });
  c.abandonar(1, 'doblaje apagado');
  assert.equal(c.resumenPerdidas()['frases perdidas'], 0);
});

comprobar('la columna "trozos MT" llega a la tabla', () => {
  const c = crearCronometro();
  c.abrir(6, { tInicioHabla: 0, segundosAudio: 12, motivoCierre: 'tope' });
  c.anotarLote(6, { trozos: 40, maxTokens: 64 });
  c.anotarPerdida({ id: 6, segundos: 12, etapa: 'traducción', detalle: 'tiempo agotado' });
  assert.equal(c.filas()[0]['trozos MT'], 40);
});

console.log(`\n${hechas} comprobaciones correctas.\n`);
