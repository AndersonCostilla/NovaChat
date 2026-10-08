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

console.log(`\n==========================================================`);
console.log(`Resultado: ${pasadas} pasadas, ${fallidas} fallidas`);
console.log(`==========================================================`);
process.exit(fallidas === 0 ? 0 : 1);
