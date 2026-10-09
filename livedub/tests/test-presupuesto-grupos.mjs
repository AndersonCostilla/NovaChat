// tests/test-presupuesto-grupos.mjs
//
// REGRESIÓN de la frase #3 (8-oct-2026, tarde).
//
// Lo que pasó en producción:
//
//   Fila #3: 12 trozos MT · Whisper 16735 ms · traducción 30002 ms
//            → PERDIDA en traducción: tiempo agotado
//   Filas #4-#5: descartada por cola llena
//   Filas #6-#9: traductor detenido (rescate)
//   Total de la sesión: 16 pérdidas de 34 frases = 47,1 %
//
// El arreglo del lote-con-continuación estaba puesto. NO FALLÓ: no llegó a
// entrar en juego. Con grupos de 8, 12 trozos son 8 + 4, y la comprobación
// del presupuesto estaba en i = 8, es decir DESPUÉS del primer grupo. El
// primer grupo se comió los 30 s del orquestador él solo y el presupuesto
// nunca se miró ni una vez.
//
// LA LECCIÓN: el tamaño del grupo es la RESOLUCIÓN del presupuesto. Un
// presupuesto de 12 s comprobado cada 8 oraciones no es un presupuesto.
//
// Aquí se reproduce el bucle real de traductor-worker.js —mismas reglas,
// mismo orden de comprobaciones— con un reloj y un coste simulados, para
// poder enfrentar la configuración vieja y la nueva sobre el mismo caso.

import assert from 'node:assert/strict';

let hechas = 0;
function comprobar(nombre, fn) {
  fn();
  hechas++;
  console.log(`  ✔ ${nombre}`);
}

const PRESUPUESTO_MS = 12000;
const TIMEOUT_MS = 30000; // el del orquestador, traductor.js

/**
 * Copia fiel del bucle de grupos de traducirTexto(), con reloj simulado.
 *
 * @param {object} o
 * @param {number} o.trozos         cuántas oraciones trae la frase
 * @param {number} o.msPorTrozo     coste de cada oración en este momento
 * @param {number} o.trozosPorGrupo tamaño de grupo a evaluar
 * @param {boolean} o.predictivo    ¿se estima el grupo que viene antes de entrar?
 */
function simularTraduccion({ trozos, msPorTrozo, trozosPorGrupo, predictivo }) {
  let reloj = 0;
  const grupos = [];
  let traducidos = 0;
  let abandonadoEn = -1;
  let vecesQueSeMiroElPresupuesto = 0;
  let msPrimeraComprobacion = null;

  for (let i = 0; i < trozos; i += trozosPorGrupo) {
    const transcurrido = reloj;

    if (i > 0) {
      vecesQueSeMiroElPresupuesto++;
      if (msPrimeraComprobacion === null) msPrimeraComprobacion = transcurrido;
      if (transcurrido > PRESUPUESTO_MS) {
        abandonadoEn = i;
        break;
      }
    }

    const grupoQueViene = Math.min(trozosPorGrupo, trozos - i);

    if (predictivo && i > 0) {
      const porTrozo = transcurrido / i;
      if (transcurrido + porTrozo * grupoQueViene > PRESUPUESTO_MS) {
        abandonadoEn = i;
        break;
      }
    }

    // generate(): no se puede interrumpir. Pase lo que pase, se paga entero.
    const coste = grupoQueViene * msPorTrozo;
    reloj += coste;
    grupos.push(coste);
    traducidos += grupoQueViene;
  }

  return {
    msTotal: reloj,
    grupos,
    traducidos,
    abandonadoEn,
    vecesQueSeMiroElPresupuesto,
    msPrimeraComprobacion,
    // El orquestador se cansa a los 30 s: si el worker tarda más, la frase
    // se pierde ENTERA y además arrastra el rescate y la cola.
    seAgotoElTiempo: reloj > TIMEOUT_MS,
    // Peor caso de ceguera: lo que dura el grupo más largo, porque durante
    // ese rato el worker no puede atender un CANCELAR.
    cegueraMaximaMs: grupos.length ? Math.max(...grupos) : 0
  };
}

// Coste por trozo durante el tramo degradado. Es una COTA INFERIOR deducida
// del log, no un número inventado: el primer grupo de 8 no había terminado a
// los 30002 ms, luego 30002 / 8 = 3750 ms por trozo como mínimo.
const MS_POR_TROZO_DEGRADADO = 4000;
const MS_POR_TROZO_NORMAL = 1000; // 1-2 trozos en ~1,96 s medidos
const TROZOS_DE_LA_3 = 12;

console.log('\n── Reproducción del fallo con la configuración vieja (grupos de 8) ──');

const vieja = simularTraduccion({
  trozos: TROZOS_DE_LA_3,
  msPorTrozo: MS_POR_TROZO_DEGRADADO,
  trozosPorGrupo: 8,
  predictivo: false
});

comprobar('el presupuesto no se mira ni una vez antes de perder la frase', () => {
  // No es que el presupuesto fallara: es que la primera oportunidad de
  // mirarlo llegaba a los 32 s, cuando el orquestador ya se había cansado a
  // los 30 y la frase ya estaba contada como pérdida.
  assert.equal(vieja.msPrimeraComprobacion, 32000);
  assert.ok(vieja.msPrimeraComprobacion > TIMEOUT_MS);
  assert.ok(vieja.msPrimeraComprobacion > PRESUPUESTO_MS * 2);
});

comprobar('la frase agota los 30 s del orquestador y se pierde entera', () => {
  assert.equal(vieja.seAgotoElTiempo, true);
  assert.ok(vieja.msTotal > TIMEOUT_MS, `${vieja.msTotal} ms`);
  // Abandona en i = 8, pero ya da igual: a los 32 s la frase está perdida.
  assert.equal(vieja.abandonadoEn, 8);
});

comprobar('el primer grupo él solo ya se pasa del presupuesto', () => {
  assert.equal(vieja.grupos[0], 8 * MS_POR_TROZO_DEGRADADO); // 32000 ms
  assert.ok(vieja.grupos[0] > PRESUPUESTO_MS);
  assert.ok(vieja.grupos[0] > TIMEOUT_MS);
});

console.log('\n── La misma frase con la configuración nueva (grupos de 3 + predicción) ──');

const nueva = simularTraduccion({
  trozos: TROZOS_DE_LA_3,
  msPorTrozo: MS_POR_TROZO_DEGRADADO,
  trozosPorGrupo: 3,
  predictivo: true
});

comprobar('se abandona a tiempo y el worker queda libre', () => {
  assert.ok(nueva.abandonadoEn > 0, 'tiene que abandonar, no terminar');
  assert.equal(nueva.seAgotoElTiempo, false);
  assert.ok(nueva.msTotal <= PRESUPUESTO_MS, `${nueva.msTotal} ms`);
});

comprobar('devuelve traducción PARCIAL en vez de nada', () => {
  assert.ok(nueva.traducidos > 0);
  assert.ok(nueva.traducidos < TROZOS_DE_LA_3);
});

comprobar('la ceguera máxima baja de 32 s a 12 s', () => {
  assert.equal(vieja.cegueraMaximaMs, 32000);
  assert.equal(nueva.cegueraMaximaMs, 12000);
});

console.log('\n── Qué aporta cada mitad del arreglo ──');

comprobar('bajar el grupo a 3 YA evita el timeout, sin predicción', () => {
  const soloGrupos = simularTraduccion({
    trozos: TROZOS_DE_LA_3,
    msPorTrozo: MS_POR_TROZO_DEGRADADO,
    trozosPorGrupo: 3,
    predictivo: false
  });
  assert.equal(soloGrupos.seAgotoElTiempo, false);
  assert.ok(soloGrupos.vecesQueSeMiroElPresupuesto > 0);
  // Pero se pasa del presupuesto: mira el reloj a los 12 s justos, ve que
  // aún no se ha pasado, y entra en un grupo que cuesta otros 12.
  assert.ok(soloGrupos.msTotal > PRESUPUESTO_MS, `${soloGrupos.msTotal} ms`);
});

comprobar('la nueva mira el presupuesto mucho antes de que nadie se canse', () => {
  assert.equal(nueva.msPrimeraComprobacion, 12000);
  assert.ok(nueva.msPrimeraComprobacion < TIMEOUT_MS);
});

comprobar('la predicción es la que hace que el presupuesto se respete', () => {
  assert.ok(nueva.msTotal <= PRESUPUESTO_MS);
});

console.log('\n── Y el habla real no se entera de nada ──');

comprobar('1 y 2 trozos siguen siendo UN solo grupo, igual que antes', () => {
  for (const trozos of [1, 2, 3]) {
    const r = simularTraduccion({
      trozos,
      msPorTrozo: MS_POR_TROZO_NORMAL,
      trozosPorGrupo: 3,
      predictivo: true
    });
    assert.equal(r.grupos.length, 1, `${trozos} trozos`);
    assert.equal(r.traducidos, trozos);
    assert.equal(r.abandonadoEn, -1);
  }
});

comprobar('una frase larga pero legítima (4 trozos) se traduce entera', () => {
  // 4 trozos a ritmo normal son 4 s: cabe de sobra en el presupuesto.
  const r = simularTraduccion({
    trozos: 4,
    msPorTrozo: MS_POR_TROZO_NORMAL,
    trozosPorGrupo: 3,
    predictivo: true
  });
  assert.equal(r.traducidos, 4);
  assert.equal(r.abandonadoEn, -1);
  assert.deepEqual(r.grupos, [3000, 1000]);
});

comprobar('la predicción no se dispara con la máquina sana', () => {
  // 12 trozos a ritmo normal: 12 s justos. Aquí sí recorta, y debe hacerlo.
  const r = simularTraduccion({
    trozos: 12,
    msPorTrozo: MS_POR_TROZO_NORMAL,
    trozosPorGrupo: 3,
    predictivo: true
  });
  assert.ok(r.traducidos >= 9, `tradujo ${r.traducidos} de 12`);
  assert.equal(r.seAgotoElTiempo, false);
});

console.log('\n── El tamaño del grupo ES la resolución del presupuesto ──');

comprobar('con el reloj degradado, la ceguera crece lineal con el grupo', () => {
  for (const g of [1, 2, 3, 8]) {
    const r = simularTraduccion({
      trozos: 24,
      msPorTrozo: MS_POR_TROZO_DEGRADADO,
      trozosPorGrupo: g,
      predictivo: true
    });
    assert.equal(r.cegueraMaximaMs, g * MS_POR_TROZO_DEGRADADO);
  }
  // Por eso ningún presupuesto puede ser más fino que un grupo, y por eso
  // 8 era demasiado: 8 x 4000 = 32 s > 30 s de tiempo de espera.
});

console.log(`\n${hechas} comprobaciones correctas.\n`);
