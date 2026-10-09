// test-cronometro.mjs
// Pruebas del cronómetro de latencia (cronometro.js).
//
// Lo importante que se comprueba: que los DOS desfases (desde el inicio de
// la frase y desde su final) se calculan bien y por separado. Esa distinción
// es justo la ambigüedad que el paso 0 tiene que resolver, y si el cálculo
// estuviera mal el diagnóstico entero saldría torcido.
//
// Uso: node livedub/tests/test-cronometro.mjs

import assert from 'node:assert/strict';
import { crearCronometro, MOTIVO_CIERRE } from '../cronometro.js';

let pasadas = 0;
let fallidas = 0;

// Acepta DOS formas: un booleano (estilo original de este archivo) o una
// función con asserts dentro.
//
// LO SEGUNDO NO FUNCIONABA Y DABA VERDE. El 8-oct-2026 se añadieron siete
// comprobaciones escritas como funciones; `if (condicion)` con una función
// es SIEMPRE cierto, así que las siete pasaron sin ejecutarse ni una línea.
// Es el mismo tipo de fallo que el `node --check` verde sobre un módulo
// roto: una prueba que no puede fallar no es una prueba.
function comprobar(titulo, condicion, detalle = '') {
  if (typeof condicion === 'function') {
    try {
      condicion();
      condicion = true;
    } catch (error) {
      condicion = false;
      detalle = detalle || error.message;
    }
  }
  if (condicion) {
    console.log(`  ✔ ${titulo}`);
    pasadas++;
  } else {
    console.log(`  ✘ ${titulo}${detalle ? ' — ' + detalle : ''}`);
    fallidas++;
  }
}

const bloque = (t) => console.log(`\n── ${t} ──`);

// Reloj falso: así los tiempos son exactos y las pruebas no dependen de
// cuánto tarde la máquina en ejecutarlas.
function relojFalso(inicio = 1_000_000) {
  let t = inicio;
  return {
    ahora: () => t,
    avanzar: (ms) => {
      t += ms;
      return t;
    },
    fijar: (v) => {
      t = v;
      return t;
    },
    valor: () => t
  };
}

bloque('Una frase completa: las dos cifras de desfase salen bien');
{
  const reloj = relojFalso();
  const crono = crearCronometro({ ahora: reloj.ahora });

  // La frase duró 12 s y se cerró al llegar al tope.
  const tInicio = reloj.valor();
  reloj.avanzar(12000);
  crono.abrir(1, { tInicioHabla: tInicio, segundosAudio: 12, motivoCierre: MOTIVO_CIERRE.TOPE });

  reloj.avanzar(2500); // Whisper
  crono.marcar(1, 'tFinAsr', { texto: 'hello world' });

  reloj.avanzar(1500); // traductor
  crono.marcar(1, 'tFinMt', { traduccion: 'hola mundo' });

  reloj.avanzar(300); // cola
  crono.marcar(1, 'tInicioVoz');

  reloj.avanzar(9000); // la voz habla
  crono.marcar(1, 'tFinVoz');
  crono.cerrar(1);

  const r = crono.resumen();

  comprobar('cuenta 1 frase doblada', r.dobladas === 1);
  comprobar(
    'DESFASE desde que TERMINA la frase = 4,3 s (2,5 + 1,5 + 0,3)',
    r['DESFASE desde que TERMINA la frase (mediana, s)'] === 4.3,
    String(r['DESFASE desde que TERMINA la frase (mediana, s)'])
  );
  comprobar(
    'DESFASE desde que EMPIEZA la frase = 16,3 s (12 + 4,3)',
    r['DESFASE desde que EMPIEZA la frase (mediana, s)'] === 16.3,
    String(r['DESFASE desde que EMPIEZA la frase (mediana, s)'])
  );
  comprobar(
    'LA DIFERENCIA ENTRE AMBAS ES LA DURACIÓN DE LA FRASE',
    r['DESFASE desde que EMPIEZA la frase (mediana, s)'] -
      r['DESFASE desde que TERMINA la frase (mediana, s)'] === 12
  );
  comprobar('Whisper se atribuye bien', r['Whisper (mediana, s)'] === 2.5);
  comprobar('la traducción se atribuye bien', r['traducción (mediana, s)'] === 1.5);
  comprobar('la espera en cola se atribuye bien', r['espera en cola antes de hablar (mediana, s)'] === 0.3);
  comprobar('registra que cerró por el tope', r['cerradas por el tope de 12 s'] === '1 de 1');

  const fila = crono.filas()[0];
  comprobar('la tabla separa las dos cifras', fila['DESFASE desde FIN (s)'] === 4.3 && fila['DESFASE desde INICIO (s)'] === 16.3);
  comprobar('y marca la frase como doblada', fila.resultado === 'doblada');
}

bloque('El diagnóstico automático distingue los dos escenarios');
{
  // Escenario A: procesamiento rápido, frases largas. El culpable es el VAD.
  const reloj = relojFalso();
  const crono = crearCronometro({ ahora: reloj.ahora });
  for (let i = 1; i <= 5; i++) {
    const t0 = reloj.valor();
    reloj.avanzar(12000);
    crono.abrir(i, { tInicioHabla: t0, segundosAudio: 12, motivoCierre: MOTIVO_CIERRE.TOPE });
    reloj.avanzar(2000);
    crono.marcar(i, 'tFinAsr');
    reloj.avanzar(1000);
    crono.marcar(i, 'tFinMt');
    reloj.avanzar(200);
    crono.marcar(i, 'tInicioVoz');
    crono.cerrar(i);
  }
  const exp = crono.explicacion();
  comprobar(
    'con frases largas y proceso rápido, culpa a la DURACIÓN DE LA FRASE',
    /DURACIÓN DE LA PROPIA FRASE/.test(exp),
    exp.split('\n').pop()
  );
}

{
  // Escenario B: frases cortas pero procesamiento lentísimo. Otro culpable.
  const reloj = relojFalso();
  const crono = crearCronometro({ ahora: reloj.ahora });
  for (let i = 1; i <= 5; i++) {
    const t0 = reloj.valor();
    reloj.avanzar(3000);
    crono.abrir(i, { tInicioHabla: t0, segundosAudio: 3, motivoCierre: MOTIVO_CIERRE.SILENCIO });
    reloj.avanzar(7000); // Whisper lentísimo
    crono.marcar(i, 'tFinAsr');
    reloj.avanzar(4000);
    crono.marcar(i, 'tFinMt');
    reloj.avanzar(1000);
    crono.marcar(i, 'tInicioVoz');
    crono.cerrar(i);
  }
  const exp = crono.explicacion();
  comprobar(
    'con proceso lento, culpa al PROCESAMIENTO y no al VAD',
    /cuello de botella NO es la espera del VAD/.test(exp),
    exp.split('\n').pop()
  );
}

bloque('Las frases perdidas no falsean el recuento');
{
  const reloj = relojFalso();
  const crono = crearCronometro({ ahora: reloj.ahora });

  const t0 = reloj.valor();
  reloj.avanzar(5000);
  crono.abrir(1, { tInicioHabla: t0, segundosAudio: 5, motivoCierre: MOTIVO_CIERRE.SILENCIO });
  reloj.avanzar(2000);
  crono.marcar(1, 'tFinAsr');
  reloj.avanzar(1000);
  crono.marcar(1, 'tFinMt');
  reloj.avanzar(100);
  crono.marcar(1, 'tInicioVoz');
  crono.cerrar(1);

  // Esta se pierde: nunca llega a sonar.
  const t1 = reloj.valor();
  reloj.avanzar(5000);
  crono.abrir(2, { tInicioHabla: t1, segundosAudio: 5, motivoCierre: MOTIVO_CIERRE.SILENCIO });
  crono.abandonar(2, 'descartada por ir muy retrasada');

  const r = crono.resumen();
  comprobar('cuenta las 2 frases', r.frases === 2);
  comprobar('pero sólo 1 doblada', r.dobladas === 1);
  comprobar('y declara 1 perdida', r.perdidas === 1);
  comprobar(
    'el desfase NO se calcula con la perdida',
    r['DESFASE desde que TERMINA la frase (mediana, s)'] === 3.1,
    String(r['DESFASE desde que TERMINA la frase (mediana, s)'])
  );

  const perdida = crono.filas().find((f) => f['#'] === 2);
  comprobar('la perdida aparece en la tabla con su motivo', perdida.resultado === 'descartada por ir muy retrasada');
  comprobar('y sin desfase inventado', perdida['DESFASE desde FIN (s)'] === null);
}

bloque('Robustez');
{
  const crono = crearCronometro();
  comprobar('sin datos, el resumen lo dice', crono.resumen().frases === 0);
  comprobar('sin datos, la explicación lo dice', /Sin datos/.test(crono.explicacion()));
  comprobar('marcar un id inexistente no revienta', crono.marcar(999, 'tFinAsr') === false);
  comprobar('cerrar un id inexistente devuelve null', crono.cerrar(999) === null);
  comprobar('abrir sin id no revienta', crono.abrir(null, {}) === undefined);
  comprobar('la tabla vacía es una lista vacía', crono.filas().length === 0);
}

{
  // El historial no crece sin límite: es memoria de un documento de larga vida.
  const reloj = relojFalso();
  const crono = crearCronometro({ ahora: reloj.ahora });
  for (let i = 1; i <= 100; i++) {
    const t0 = reloj.valor();
    reloj.avanzar(3000);
    crono.abrir(i, { tInicioHabla: t0, segundosAudio: 3, motivoCierre: MOTIVO_CIERRE.SILENCIO });
    reloj.avanzar(1000);
    crono.marcar(i, 'tInicioVoz');
    crono.cerrar(i);
  }
  // El tope subió de 40 a 200 el 8-oct-2026: con 40, una tanda de cinco
  // minutos perdía de vista su primera mitad.
  comprobar('el historial está acotado', crono.total() <= 200, `${crono.total()}`);
  comprobar('y conserva las ÚLTIMAS, no las primeras', crono.filas().at(-1)['#'] === 100);
  comprobar('no quedan frases vivas colgadas', crono.vivas() === 0);

  crono.reiniciar();
  comprobar('reiniciar lo deja a cero', crono.total() === 0);
}

bloque('CAPACIDAD: ¿cabe el doblaje en el hueco entre frases?');

// Simula la tubería de verdad: el audio SIGUE LLEGANDO mientras la voz
// habla. Es la diferencia clave — si las frases esperasen a que terminara
// el doblaje, nunca habría atasco y la medida no serviría de nada.
function simularTuberia({ duracionFrase, duracionVoz, computo, frases }) {
  const reloj = relojFalso(0);
  const crono = crearCronometro({ ahora: reloj.ahora });
  let vozLibreEn = 0;

  for (let i = 1; i <= frases; i++) {
    const tFinHabla = i * duracionFrase;

    reloj.fijar(tFinHabla);
    crono.abrir(i, {
      tInicioHabla: tFinHabla - duracionFrase,
      segundosAudio: duracionFrase / 1000,
      motivoCierre: MOTIVO_CIERRE.TOPE
    });

    reloj.fijar(tFinHabla + computo);
    crono.marcar(i, 'tFinAsr');
    crono.marcar(i, 'tFinMt');

    const inicioVoz = Math.max(tFinHabla + computo, vozLibreEn);
    reloj.fijar(inicioVoz);
    crono.marcar(i, 'tInicioVoz');

    vozLibreEn = inicioVoz + duracionVoz;
    reloj.fijar(vozLibreEn);
    crono.marcar(i, 'tFinVoz');
    crono.cerrar(i);
  }
  return crono;
}

{
  // El doblaje dura 1,11 veces el original: el caso que la simulación
  // señala como responsable del pico de la frase #14.
  const crono = simularTuberia({
    duracionFrase: 12030,
    duracionVoz: 13350,
    computo: 6230,
    frases: 10
  });

  const r = crono.resumen();
  comprobar(
    'mide el hueco real entre frases (12,03 s)',
    r['hueco entre frases (mediana, s)'] === 12.03,
    String(r['hueco entre frases (mediana, s)'])
  );
  comprobar(
    'detecta que el doblaje NO cabe en ese hueco',
    r['OCUPACIÓN del canal de voz (%)'] >= 100,
    `${r['OCUPACIÓN del canal de voz (%)']} %`
  );
  comprobar('y lo dice sin rodeos', /NO DA ABASTO/.test(r.VEREDICTO), r.VEREDICTO);
  comprobar(
    'calcula la expansión español/original',
    r['el español dura x veces el original'] === 1.11,
    String(r['el español dura x veces el original'])
  );
  comprobar(
    'avisa de que acortar las frases NO lo arregla',
    /PROPORCIÓN/.test(crono.explicacion())
  );

  // LA COMPROBACIÓN QUE IMPORTA: la espera crece frase a frase.
  const esperas = crono.filas().map((f) => f['espera hasta hablar (ms)']);
  comprobar(
    'la espera CRECE con cada frase (atasco acumulativo)',
    esperas.at(-1) > esperas[0] + 5000,
    `primera ${esperas[0]} ms, última ${esperas.at(-1)} ms`
  );
}

{
  // Mismo montaje pero con el doblaje más corto que el original: cabe.
  const crono = simularTuberia({
    duracionFrase: 12030,
    duracionVoz: 9000,
    computo: 6230,
    frases: 10
  });
  const r = crono.resumen();
  comprobar('con holgura, la ocupación baja del 85 %', r['OCUPACIÓN del canal de voz (%)'] < 85,
    `${r['OCUPACIÓN del canal de voz (%)']} %`);
  comprobar('y el veredicto lo refleja', /HAY MARGEN/.test(r.VEREDICTO), r.VEREDICTO);

  const esperas = crono.filas().map((f) => f['espera hasta hablar (ms)']);
  comprobar('y la espera NO crece', esperas.at(-1) <= esperas[0] + 100,
    `primera ${esperas[0]} ms, última ${esperas.at(-1)} ms`);
}

{
  // Justo en el límite: cabe de media, pero sin margen.
  const crono = simularTuberia({
    duracionFrase: 12030,
    duracionVoz: 11000,
    computo: 6230,
    frases: 8
  });
  const r = crono.resumen();
  comprobar('el caso límite se marca como AL LÍMITE', /AL LÍMITE/.test(r.VEREDICTO), r.VEREDICTO);
}

bloque('Whisper: ¿coste fijo por frase o proporcional a la duración?');
{
  const reloj = relojFalso();
  const crono = crearCronometro({ ahora: reloj.ahora });
  let t = reloj.valor();

  // Frases cortas y largas con el MISMO coste de Whisper: eso delataría un
  // coste fijo por frase (la ventana de 30 s se rellena igual).
  const casos = [3, 3, 3, 12, 12, 12];
  casos.forEach((dur, i) => {
    const t0 = t;
    reloj.avanzar(dur * 1000);
    crono.abrir(i + 1, { tInicioHabla: t0, segundosAudio: dur, motivoCierre: MOTIVO_CIERRE.SILENCIO });
    reloj.avanzar(4200); // mismo coste para todas
    crono.marcar(i + 1, 'tFinAsr');
    crono.marcar(i + 1, 'tFinMt');
    crono.marcar(i + 1, 'tInicioVoz');
    reloj.avanzar(1000);
    crono.marcar(i + 1, 'tFinVoz');
    crono.cerrar(i + 1);
    t = reloj.valor();
  });

  const r = crono.resumen();
  comprobar(
    'separa el coste de Whisper en frases cortas',
    /4\.2 s \(3\)/.test(r['Whisper en frases cortas (<6 s)']),
    r['Whisper en frases cortas (<6 s)']
  );
  comprobar(
    'y en frases largas',
    /4\.2 s \(3\)/.test(r['Whisper en frases largas (≥11 s)']),
    r['Whisper en frases largas (≥11 s)']
  );
  comprobar('sin muestras, lo dice en vez de inventar',
    crearCronometro().resumen().frases === 0);
}

bloque('PUNTO 3: una frase fallida no descuadra el hueco de la siguiente');
{
  // Reproduce el -117 % de la fila #22: la frase que falla se cierra al
  // instante, mientras la anterior sigue hablando y se cierra después.
  const reloj = relojFalso(0);
  const crono = crearCronometro({ ahora: reloj.ahora });

  // Frase A llega en t=12000 y hablará largo.
  reloj.fijar(12000);
  crono.abrir(1, { tInicioHabla: 0, segundosAudio: 12, motivoCierre: MOTIVO_CIERRE.TOPE });
  reloj.fijar(18000);
  crono.marcar(1, 'tFinAsr');
  crono.marcar(1, 'tFinMt');
  crono.marcar(1, 'tInicioVoz');

  // Frase B llega en t=24000 y FALLA al instante: se cierra la primera.
  reloj.fijar(24000);
  crono.abrir(2, { tInicioHabla: 12000, segundosAudio: 12, motivoCierre: MOTIVO_CIERRE.TOPE });
  reloj.fijar(24100);
  crono.abandonar(2, 'NO se intentó traducir: el texto no parece inglés');

  // Y AHORA se cierra la A, después de la B.
  reloj.fijar(31000);
  crono.marcar(1, 'tFinVoz');
  crono.cerrar(1);

  const filas = crono.filas();
  const a1 = filas.find((f) => f['#'] === 1);
  const b1 = filas.find((f) => f['#'] === 2);

  comprobar('el historial quedó desordenado (la fallida cerró antes)',
    filas[0]['#'] === 2 && filas[1]['#'] === 1);
  comprobar(
    'aun así el hueco de la frase 2 es POSITIVO',
    b1['hueco disponible (s)'] === 12,
    String(b1['hueco disponible (s)'])
  );
  comprobar(
    'y la ocupación de la frase 1 NO sale negativa',
    a1['ocupación (%)'] === null || a1['ocupación (%)'] > 0,
    String(a1['ocupación (%)'])
  );
  comprobar(
    'la primera frase no tiene hueco (no hay anterior)',
    a1['hueco disponible (s)'] === null
  );
}

bloque('PUNTO 4: el límite teórico con Whisper y traducción a 0 ms');
{
  const crono = simularTuberia({
    duracionFrase: 12030,
    duracionVoz: 13350,
    computo: 6230,
    frases: 10
  });
  const r = crono.resumen();

  comprobar(
    'la ocupación a 0 ms es IDÉNTICA a la real',
    r['ocupación si Whisper y traducción costaran 0 ms (%)'] === r['OCUPACIÓN del canal de voz (%)'],
    `${r['ocupación si Whisper y traducción costaran 0 ms (%)']} vs ${r['OCUPACIÓN del canal de voz (%)']}`
  );
  comprobar(
    'y sigue por encima del 100 %',
    r['ocupación si Whisper y traducción costaran 0 ms (%)'] > 100
  );
  comprobar(
    'calcula cuánto se acumula por frase',
    r['atraso que se acumula por frase (s)'] === 1.32,
    String(r['atraso que se acumula por frase (s)'])
  );
  comprobar(
    'el veredicto dice que acelerar el proceso NO evita la pérdida',
    /ninguna optimización de Whisper o de la traducción puede evitar la pérdida/.test(
      crono.veredictoLimiteTeorico()
    ),
    crono.veredictoLimiteTeorico().slice(0, 80)
  );

  // Y el caso contrario: si cabe, acelerar sí sirve.
  const holgado = simularTuberia({
    duracionFrase: 12030,
    duracionVoz: 8000,
    computo: 6230,
    frases: 10
  });
  comprobar(
    'si el doblaje cabe, el veredicto dice que acelerar sí ayuda',
    /no habría pérdida/.test(holgado.veredictoLimiteTeorico()),
    holgado.veredictoLimiteTeorico().slice(0, 80)
  );
}

bloque('PUNTO 1: la pérdida de contenido se cuenta y se puede consultar');
{
  const crono = crearCronometro();
  comprobar('sin pérdidas, lo dice', crono.resumenPerdidas()['frases perdidas'] === 0);

  crono.anotarPerdida({ id: 5, segundos: 12.03, etapa: 'transcripción', detalle: 'cola llena' });
  crono.anotarPerdida({ id: 9, segundos: 11.5, etapa: 'cola de voz', detalle: 'iba retrasado' });
  crono.anotarPerdida({ id: 12, segundos: 12.0, etapa: 'transcripción', detalle: 'cola llena' });

  const r = crono.resumenPerdidas();
  comprobar('cuenta las 3 pérdidas', r['frases perdidas'] === 3);
  comprobar(
    'suma los segundos de vídeo sin doblar',
    r['segundos de vídeo sin doblar'] === 35.5,
    String(r['segundos de vídeo sin doblar'])
  );
  comprobar('las agrupa por etapa', r['por etapa']['transcripción'] === 2 && r['por etapa']['cola de voz'] === 1);
  comprobar('y guarda el detalle', r.detalle.length === 3);
}

{
  // Una pérdida de una frase ABIERTA la cierra con el motivo real.
  const reloj = relojFalso(0);
  const crono = crearCronometro({ ahora: reloj.ahora });
  reloj.fijar(5000);
  crono.abrir(1, { tInicioHabla: 0, segundosAudio: 5, motivoCierre: MOTIVO_CIERRE.SILENCIO });
  crono.anotarPerdida({ id: 1, segundos: 5, etapa: 'cola de voz', detalle: 'se tiró la más antigua' });

  comprobar('la frase abierta se cierra', crono.vivas() === 0);
  const fila = crono.filas()[0];
  comprobar(
    'y aparece en la tabla marcada como PERDIDA',
    /PERDIDA en cola de voz/.test(fila.resultado),
    fila.resultado
  );
  comprobar('sin desfase inventado', fila['DESFASE desde FIN (s)'] === null);
}


/* ------------------------------------------------------------------ */
/* Columna de recorte y comparación on/off (8-oct-2026)                */
/* ------------------------------------------------------------------ */
//
// Existe porque DOS tandas seguidas quedaron inservibles al no constar si el
// recorte estaba activo. El dato va ahora en cada frase.

{
  const reloj = { t: 0 };
  const c = crearCronometro({ ahora: () => reloj.t });

  // 6 frases sin recorte y 6 con recorte, con doblajes de distinta duración.
  const meter = (id, recorteOn, segundosAudio, duracionVozMs) => {
    c.abrir(id, { tInicioHabla: reloj.t, segundosAudio, motivoCierre: 'tope' });
    c.anotarRecorte(id, { activo: recorteOn, reduccion: recorteOn ? 0.1 : null });
    c.marcar(id, 'tFinAsr');
    c.marcar(id, 'tFinMt');
    c.marcar(id, 'tInicioVoz');
    reloj.t += duracionVozMs;
    c.marcar(id, 'tFinVoz');
    c.cerrar(id, { motivoFinal: 'doblada' });
    reloj.t += 1000;
  };

  for (let i = 1; i <= 6; i++) meter(i, false, 10, 11100); // 1,11x
  for (let i = 7; i <= 12; i++) meter(i, true, 10, 9800); // 0,98x

  const filas = c.filas();
  comprobar('la tabla dice si el recorte estaba on u off en cada frase', () => {
    assert.equal(filas[0].recorte, 'off');
    assert.equal(filas[11].recorte, 'on');
  });

  comprobar('la tabla trae la proporción ES/EN por frase', () => {
    assert.equal(filas[0]['proporción ES/EN'], 1.11);
    assert.equal(filas[11]['proporción ES/EN'], 0.98);
  });

  const cmp = c.compararRecorte();
  comprobar('compararRecorte separa los dos grupos solo', () => {
    assert.equal(cmp['con recorte (on)'].frases, 6);
    assert.equal(cmp['sin recorte (off)'].frases, 6);
    assert.equal(cmp['con recorte (on)']['proporción ES/EN (mediana)'], 0.98);
    assert.equal(cmp['sin recorte (off)']['proporción ES/EN (mediana)'], 1.11);
  });

  comprobar('el veredicto lo escribe el programa, no el que lo cuenta', () => {
    assert.match(cmp.veredicto, /^EL RECORTE BASTA/);
  });

  comprobar('si el recorte no baja de 1, el veredicto lo dice sin adornos', () => {
    const r2 = { t: 0 };
    const d = crearCronometro({ ahora: () => r2.t });
    for (let i = 1; i <= 12; i++) {
      const on = i > 6;
      d.abrir(i, { tInicioHabla: r2.t, segundosAudio: 10, motivoCierre: 'tope' });
      d.anotarRecorte(i, { activo: on, reduccion: on ? 0.035 : null });
      d.marcar(i, 'tInicioVoz');
      r2.t += on ? 10710 : 11100; // 1,11 x (1 - 0,035) = 1,071
      d.marcar(i, 'tFinVoz');
      d.cerrar(i, { motivoFinal: 'doblada' });
      r2.t += 1000;
    }
    const v = d.compararRecorte();
    assert.equal(v['con recorte (on)']['proporción ES/EN (mediana)'], 1.071);
    assert.match(v.veredicto, /^EL RECORTE NO BASTA/);
    assert.match(v.veredicto, /búfer/);
  });

  comprobar('con pocas frases NO se pronuncia: dice que no se puede comparar', () => {
    const r3 = { t: 0 };
    const e = crearCronometro({ ahora: () => r3.t });
    e.abrir(1, { tInicioHabla: 0, segundosAudio: 10, motivoCierre: 'tope' });
    e.anotarRecorte(1, { activo: true });
    e.marcar(1, 'tInicioVoz');
    r3.t += 9000;
    e.marcar(1, 'tFinVoz');
    e.cerrar(1, { motivoFinal: 'doblada' });
    assert.match(e.compararRecorte().veredicto, /^NO SE PUEDE COMPARAR/);
  });

  comprobar('las frases viejas sin marca quedan fuera, no se inventan', () => {
    const r4 = { t: 0 };
    const g = crearCronometro({ ahora: () => r4.t });
    g.abrir(1, { tInicioHabla: 0, segundosAudio: 10, motivoCierre: 'tope' });
    g.marcar(1, 'tInicioVoz');
    r4.t += 9000;
    g.marcar(1, 'tFinVoz');
    g.cerrar(1, { motivoFinal: 'doblada' });
    assert.equal(g.filas()[0].recorte, '?');
    assert.equal(g.compararRecorte()['frases sin marcar (medidas antes de existir la columna)'], 1);
  });
}


/* ------------------------------------------------------------------ */
/* simularRecorte: comparación sin que el contenido contamine          */
/* ------------------------------------------------------------------ */
{
  // Recortador falso y determinista: quita el 20 % de los caracteres.
  const recorte20 = (t) => ({ texto: t.slice(0, Math.ceil(t.length * 0.8)) });
  const sinRecorte = (t) => ({ texto: t });

  const montar = (recortarFn) => {
    const reloj = { t: 0 };
    const c = crearCronometro({ ahora: () => reloj.t });
    for (let i = 1; i <= 8; i++) {
      const texto = 'x'.repeat(100);
      c.abrir(i, { tInicioHabla: reloj.t, segundosAudio: 10, motivoCierre: 'tope' });
      c.anotarRecorte(i, { activo: false });
      c.marcar(i, 'tFinMt', { traduccion: texto });
      c.marcar(i, 'tInicioVoz');
      reloj.t += 11000; // 100 caracteres en 11 s -> 1,10x
      c.marcar(i, 'tFinVoz');
      c.cerrar(i, { motivoFinal: 'doblada' });
      reloj.t += 1000;
    }
    return c.simularRecorte(recortarFn);
  };

  comprobar('sin recorte, las dos columnas son idénticas', () => {
    const r = montar(sinRecorte);
    assert.equal(r['proporción ES/EN SIN recorte (mediana)'], 1.1);
    assert.equal(r['proporción ES/EN CON recorte (mediana)'], 1.1);
    assert.equal(r['recorte AGREGADO (caracteres totales)'], '0.0 %');
  });

  comprobar('un recorte del 20 % baja la proporción de 1,10 a 0,88', () => {
    const r = montar(recorte20);
    assert.equal(r['proporción ES/EN SIN recorte (mediana)'], 1.1);
    assert.equal(r['proporción ES/EN CON recorte (mediana)'], 0.88);
    assert.match(r.veredicto, /^EL RECORTE BASTA/);
  });

  comprobar('dice cuánto recorte HARÍA FALTA, no solo cuánto hay', () => {
    const r = montar(sinRecorte);
    // 1 - 1/1,10 = 9,1 %
    assert.equal(r['recorte necesario para bajar de 1'], '9.1 %');
    assert.match(r.veredicto, /^EL RECORTE NO BASTA/);
  });

  comprobar('con menos de 5 frases no se pronuncia', () => {
    const reloj = { t: 0 };
    const c = crearCronometro({ ahora: () => reloj.t });
    c.abrir(1, { tInicioHabla: 0, segundosAudio: 10, motivoCierre: 'tope' });
    c.marcar(1, 'tFinMt', { traduccion: 'hola' });
    c.marcar(1, 'tInicioVoz');
    reloj.t += 1000;
    c.marcar(1, 'tFinVoz');
    c.cerrar(1, { motivoFinal: 'doblada' });
    assert.match(c.simularRecorte(sinRecorte).veredicto, /^NO HAY BASTANTES FRASES/);
  });

  comprobar('usa el texto REALMENTE hablado para el ritmo, no el previo', () => {
    const reloj = { t: 0 };
    const c = crearCronometro({ ahora: () => reloj.t });
    for (let i = 1; i <= 6; i++) {
      c.abrir(i, { tInicioHabla: reloj.t, segundosAudio: 10, motivoCierre: 'tope' });
      c.marcar(i, 'tFinMt', { traduccion: 'y'.repeat(100) });
      // El recorte dejó 80 caracteres, y ésos son los que se pronunciaron.
      c.anotarRecorte(i, {
        activo: true,
        reduccion: 0.2,
        sinRecortar: 'y'.repeat(100),
        hablada: 'y'.repeat(80)
      });
      c.marcar(i, 'tInicioVoz');
      reloj.t += 8800; // 80 caracteres en 8,8 s = 110 ms/carácter
      c.marcar(i, 'tFinVoz');
      c.cerrar(i, { motivoFinal: 'doblada' });
      reloj.t += 1000;
    }
    const r = c.simularRecorte(sinRecorte);
    // 100 caracteres x 110 ms = 11 s sobre 10 s de audio -> 1,10, NO 0,88.
    assert.equal(r['proporción ES/EN SIN recorte (mediana)'], 1.1);
  });
}


/* ------------------------------------------------------------------ */
/* REGRESIÓN: el tope del historial contaba como fuga (8-oct-2026)     */
/* ------------------------------------------------------------------ */
//
// En una tanda de 61 frases SIN NINGUNA PÉRDIDA REAL, verificacionCruzada()
// decía "21 frases desaparecieron sin que ningún contador las recogiera".
// Las 21 eran 61 - 40: las que el tope del historial tiraba por viejas.
{
  const sinPerder = (n) => {
    const c = crearCronometro();
    for (let i = 1; i <= n; i++) {
      c.abrir(i, { tInicioHabla: 0, segundosAudio: 5, motivoCierre: 'silencio' });
      c.cerrar(i, { motivoFinal: 'doblada' });
    }
    return c;
  };

  comprobar('61 frases sin perder ninguna: el contador CUADRA', () => {
    const v = sinPerder(61).verificacionCruzada();
    assert.match(v['¿cuadra el contador?'], /^SÍ/);
    assert.equal(v['ids sin explicar'].length, 0);
  });

  comprobar('una tanda larga tampoco inventa fugas', () => {
    const v = sinPerder(250).verificacionCruzada();
    assert.match(v['¿cuadra el contador?'], /^SÍ/);
    assert.ok(v['frases retiradas de la tabla por antigüedad'] > 0);
  });

  comprobar('pero una fuga DE VERDAD se sigue viendo', () => {
    const c = crearCronometro();
    for (let i = 1; i <= 250; i++) {
      c.abrir(i, { tInicioHabla: 0, segundosAudio: 5, motivoCierre: 'silencio' });
      c.cerrar(i, { motivoFinal: 'doblada' });
    }
    // Un salto en la numeración: las frases 251-299 nunca llegaron a abrirse.
    c.abrir(300, { tInicioHabla: 0, segundosAudio: 5, motivoCierre: 'silencio' });
    c.cerrar(300, { motivoFinal: 'doblada' });
    const v = c.verificacionCruzada();
    assert.match(v['¿cuadra el contador?'], /^NO/);
    assert.equal(v['ids sin explicar'].length, 49);
  });

  comprobar('la tabla guarda una tanda de 5 minutos entera', () => {
    // Con el tope anterior (40) una tanda de 60-70 frases perdía de vista la
    // primera mitad y las medianas sólo describían el final.
    assert.equal(sinPerder(70).filas().length, 70);
  });

  comprobar('el diagnóstico de alucinación llega a la tabla', () => {
    const c = crearCronometro();
    c.abrir(57, { tInicioHabla: 0, segundosAudio: 12.03, motivoCierre: 'tope' });
    c.anotarAlucinacion(57, { total: 111, esSospechosa: true });
    c.cerrar(57, { motivoFinal: 'doblada' });
    assert.equal(c.filas()[0]['¿alucinación?'], 'SOSPECHOSA');
  });
}


/* ------------------------------------------------------------------ */
/* deriva(): ¿el sistema se degrada con el tiempo?                     */
/* ------------------------------------------------------------------ */
{
  // Sesión sintética: n frases, con el coste de Whisper que se le diga.
  const sesion = (n, msWhisper, segundosAudio = () => 5) => {
    let t = 0;
    const c = crearCronometro({ ahora: () => t });
    for (let i = 1; i <= n; i++) {
      t += 1000;
      c.abrir(i, { tInicioHabla: t - 5000, segundosAudio: segundosAudio(i, n), motivoCierre: 'silencio' });
      t += msWhisper(i, n);
      c.marcar(i, 'tFinAsr');
      t += 2000;
      c.marcar(i, 'tFinMt');
      c.cerrar(i, { motivoFinal: 'doblada' });
    }
    return c;
  };

  comprobar('con pocas frases NO inventa un veredicto', () => {
    const d = sesion(5, () => 4000).deriva();
    assert.match(d['¿se puede responder?'], /^NO/);
  });

  comprobar('máquina estable: dice que NO hay deriva', () => {
    const d = sesion(30, () => 4000).deriva();
    assert.match(d['¿se degrada con el tiempo?'], /^NO/);
    assert.equal(d.tramos.length, 3);
  });

  comprobar('el caso de Anderson (3-5 s → 16-25 s) SÍ se detecta', () => {
    const d = sesion(30, (i, n) => (i > (2 * n) / 3 ? 20000 : 4000)).deriva();
    assert.match(d['¿se degrada con el tiempo?'], /^SÍ/);
    assert.match(d['¿se degrada con el tiempo?'], /x5/);
    assert.equal(d.tramos[0]['Whisper mediana (ms)'], 4000);
    assert.equal(d.tramos[2]['Whisper mediana (ms)'], 20000);
  });

  comprobar('no confunde "frases más largas" con degradación', () => {
    // Whisper sube x5 pero las frases también se han alargado mucho.
    const d = sesion(
      30,
      (i, n) => (i > (2 * n) / 3 ? 20000 : 4000),
      (i, n) => (i > (2 * n) / 3 ? 12 : 3)
    ).deriva();
    assert.match(d['¿se degrada con el tiempo?'], /^OJO/);
  });

  comprobar('el grupo MT más caro llega a la tabla y a la deriva', () => {
    const c = crearCronometro();
    c.abrir(3, { tInicioHabla: 0, segundosAudio: 12.03, motivoCierre: 'tope' });
    c.anotarGrupos(3, [4200, 11840, 3900]);
    c.cerrar(3, { motivoFinal: 'doblada' });
    assert.equal(c.filas()[0]['grupo MT más caro (ms)'], 11840);
  });
}


/* ------------------------------------------------------------------ */
/* eventosCatastroficos(): el criterio de "resuelto", en código        */
/* ------------------------------------------------------------------ */
{
  // Cada umbral viene de un fallo vivido. Que sea código y no impresión es
  // justo el punto: "no hubo eventos" tiene que ser comprobable.
  const frase = (c, id, { asr = 4000, mt = 2000, voz = 5000, audio = 5, trozos = 2, grupos = null } = {}) => {
    let t = c.__t || 0;
    const reloj = () => t;
    void reloj;
    c.abrir(id, { tInicioHabla: 0, segundosAudio: audio, motivoCierre: 'silencio' });
    c.anotarLote(id, { trozos });
    if (grupos) c.anotarGrupos(id, grupos);
    return { asr, mt, voz };
  };
  void frase;

  // Se construye con un reloj controlado para poder fijar las duraciones.
  const tanda = (frases) => {
    let t = 0;
    const c = crearCronometro({ ahora: () => t });
    frases.forEach((f, i) => {
      const id = i + 1;
      t += 1000;
      c.abrir(id, { tInicioHabla: t - (f.audio ?? 5) * 1000, segundosAudio: f.audio ?? 5, motivoCierre: 'silencio' });
      c.anotarLote(id, { trozos: f.trozos ?? 2 });
      t += f.asr ?? 4000;
      c.marcar(id, 'tFinAsr');
      t += f.mt ?? 2000;
      c.marcar(id, 'tFinMt');
      if (f.grupos) c.anotarGrupos(id, f.grupos);
      c.marcar(id, 'tInicioVoz');
      t += f.voz ?? 5000;
      c.marcar(id, 'tFinVoz');
      c.cerrar(id, { motivoFinal: 'doblada' });
    });
    return c.eventosCatastroficos();
  };

  comprobar('una tanda sana se declara LIMPIA', () => {
    const e = tanda(Array(20).fill({}));
    assert.match(e['¿tanda limpia?'], /^SÍ/);
    assert.equal(e.sucesos.length, 0);
    assert.equal(e['frases en la tanda'], 20);
  });

  comprobar('la #3 (traducción de 30002 ms) se caza', () => {
    const e = tanda([{}, {}, { mt: 30002 }, {}]);
    assert.match(e['¿tanda limpia?'], /^NO/);
    assert.ok(e.sucesos.some((s) => s.qué === 'traducción de 30 s o más'));
  });

  comprobar('el Whisper degradado (16-25 s) se caza', () => {
    const e = tanda([{}, { asr: 16735 }]);
    assert.ok(e.sucesos.some((s) => s.qué === 'Whisper de 16 s o más'));
  });

  comprobar('el lote de 12 trozos se caza', () => {
    const e = tanda([{}, { trozos: 12 }]);
    assert.ok(e.sucesos.some((s) => s.qué === 'lote de trozos disparado'));
  });

  comprobar('un grupo de generate() por encima del presupuesto se caza', () => {
    const e = tanda([{}, { grupos: [3000, 32000] }]);
    assert.ok(e.sucesos.some((s) => s.qué === 'un grupo de generate() pasó del presupuesto'));
  });

  comprobar('la #23 (92 s de voz para 12,03 s de audio) se caza', () => {
    const e = tanda([{}, { audio: 12.03, voz: 92000 }]);
    const s = e.sucesos.find((x) => x.qué === 'el doblaje ocupó más de 3x el audio');
    assert.ok(s);
    assert.match(s.valor, /7\.6/);
  });

  comprobar('el habla normal (proporción 1,11) NO se marca', () => {
    // 12,03 s de audio → unos 13,4 s de doblaje. Es lo medido, no un evento.
    const e = tanda(Array(10).fill({ audio: 12.03, voz: 13400 }));
    assert.match(e['¿tanda limpia?'], /^SÍ/);
  });
}


/* ------------------------------------------------------------------ */
/* costeWhisper(): separar el encoder (fijo) del decoder (por texto)   */
/* ------------------------------------------------------------------ */
{
  // La #13 tardó 21.014 ms con 90 oraciones cuando la mediana eran 4.310.
  // "Whisper es coste fijo" no puede explicar eso. La hipótesis es que el
  // encoder es fijo y el decoder va por token; esto comprueba que el ajuste
  // sabe recuperar esas dos partes cuando de verdad están ahí.
  const sesionSintetica = (fijo, porCaracter, tamanos) => {
    let t = 0;
    const c = crearCronometro({ ahora: () => t });
    tamanos.forEach((chars, i) => {
      const id = i + 1;
      t += 1000;
      c.abrir(id, { tInicioHabla: 0, segundosAudio: 10, motivoCierre: 'silencio' });
      t += Math.round(fijo + chars * porCaracter);
      c.marcar(id, 'tFinAsr', { texto: 'x'.repeat(chars), caracteres: chars });
      c.cerrar(id, { motivoFinal: 'doblada' });
    });
    return c.costeWhisper();
  };

  const variados = [...Array(30)].map((_, i) => 230 + ((i * 37) % 120) - 60);

  comprobar('con pocas frases NO se inventa una recta', () => {
    const r = sesionSintetica(1800, 10, [100, 200, 300]);
    assert.match(r['¿se puede responder?'], /^NO/);
  });

  comprobar('recupera el coste fijo y el coste por carácter', () => {
    const r = sesionSintetica(1826, 10.7, [...variados, 1500]);
    assert.ok(Math.abs(r['coste FIJO del encoder (ms)'] - 1826) <= 5);
    assert.ok(Math.abs(r['coste por carácter del decoder (ms)'] - 10.7) < 0.2);
    assert.equal(r['R² (0 a 1)'], 1);
    assert.match(r['¿se puede fiar uno?'], /^SÍ/);
  });

  comprobar('señala la frase más cara, que es la que hay que mirar', () => {
    const r = sesionSintetica(1826, 10.7, [...variados, 1500]);
    assert.match(r['frase más cara'], /1500 caracteres/);
  });

  comprobar('si el tiempo NO depende del texto, lo dice en vez de fingir', () => {
    // Coste puramente fijo con ruido: la recta no debe presumir de nada.
    let t = 0;
    const c = crearCronometro({ ahora: () => t });
    variados.forEach((chars, i) => {
      const id = i + 1;
      t += 1000;
      c.abrir(id, { tInicioHabla: 0, segundosAudio: 10, motivoCierre: 'silencio' });
      t += 4300 + ((i * 991) % 2000) - 1000; // ruido, sin relación con chars
      c.marcar(id, 'tFinAsr', { texto: 'x'.repeat(chars), caracteres: chars });
      c.cerrar(id, { motivoFinal: 'doblada' });
    });
    const r = c.costeWhisper();
    assert.ok(r['R² (0 a 1)'] < 0.6, `R² = ${r['R² (0 a 1)']}`);
    assert.match(r['¿se puede fiar uno?'], /^NO/);
  });

  comprobar('lleva el aviso de que es un ajuste, no una ley', () => {
    const r = sesionSintetica(1826, 10.7, [...variados, 1500]);
    assert.match(r.aviso, /no es una ley|no una ley/);
  });
}

/* ------------------------------------------------------------------ */
/* segundosAudioDe(): el dato que el detector estaba sin recibir       */
/* ------------------------------------------------------------------ */
{
  comprobar('devuelve la duración del AUDIO de una frase viva', () => {
    const c = crearCronometro();
    c.abrir(13, { tInicioHabla: 0, segundosAudio: 9.02, motivoCierre: 'tope' });
    assert.equal(c.segundosAudioDe(13), 9.02);
  });

  comprobar('sigue estando después de cerrarla', () => {
    const c = crearCronometro();
    c.abrir(13, { tInicioHabla: 0, segundosAudio: 9.02, motivoCierre: 'tope' });
    c.cerrar(13, { motivoFinal: 'doblada' });
    assert.equal(c.segundosAudioDe(13), 9.02);
  });

  comprobar('devuelve null si no sabe, en vez de un número inventado', () => {
    const c = crearCronometro();
    assert.equal(c.segundosAudioDe(999), null);
  });
}

console.log(`\n==========================================================`);
console.log(`Resultado: ${pasadas} pasadas, ${fallidas} fallidas`);
console.log(`==========================================================`);
process.exit(fallidas === 0 ? 0 : 1);