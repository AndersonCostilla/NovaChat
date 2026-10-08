// test-cronometro.mjs
// Pruebas del cronómetro de latencia (cronometro.js).
//
// Lo importante que se comprueba: que los DOS desfases (desde el inicio de
// la frase y desde su final) se calculan bien y por separado. Esa distinción
// es justo la ambigüedad que el paso 0 tiene que resolver, y si el cálculo
// estuviera mal el diagnóstico entero saldría torcido.
//
// Uso: node livedub/tests/test-cronometro.mjs

import { crearCronometro, MOTIVO_CIERRE } from '../cronometro.js';

let pasadas = 0;
let fallidas = 0;

function comprobar(titulo, condicion, detalle = '') {
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
  comprobar('el historial está acotado', crono.total() <= 40, `${crono.total()}`);
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

console.log(`\n==========================================================`);
console.log(`Resultado: ${pasadas} pasadas, ${fallidas} fallidas`);
console.log(`==========================================================`);
process.exit(fallidas === 0 ? 0 : 1);
