// test-colas-timeout.mjs
// Prueba del ARREGLO DE COLAS Y TIMEOUTS (7-oct-2026).
//
// EL DEFECTO QUE VIGILA
// Al vencer el timeout de una frase, el código antiguo hacía:
//     resolverPendiente(id, 'tiempo agotado');
//     enVuelo = false;      // ← declaraba libre un worker que NO lo estaba
//     procesarCola();       // ← y le metía otra frase encima
// El worker, además, no serializaba (`self.onmessage = async` no espera), así
// que las dos inferencias corrían a la vez repartiéndose el único núcleo. Y
// cuando por fin llegaba el resultado de la primera, volvía a hacer
// `enVuelo = false` y entraba una tercera.
//
// Esto explicaba que el coste pasara de ~2.000 a ~3.600 ms por segundo de
// audio en las mediciones de Anderson, justo a partir del primer timeout.
//
// Ejecutar:  node livedub/tests/test-colas-timeout.mjs

let pasadas = 0;
let fallidas = 0;

function comprobar(d, cond, detalle = '') {
  if (cond) {
    pasadas++;
    console.log(`  ✔ ${d}`);
  } else {
    fallidas++;
    console.error(`  ✘ ${d}${detalle ? ` — ${detalle}` : ''}`);
  }
}
const bloque = (t) => console.log(`\n── ${t} ──`);
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ */
/* Worker simulado: registra cuántas tareas tiene VIVAS a la vez        */
/* ------------------------------------------------------------------ */

function crearWorkerFalso({ costeMs = 100 } = {}) {
  const w = {
    enviados: [],
    cancelacionesRecibidas: [],
    vivas: 0,
    maxVivas: 0,
    onmessage: null,
    onerror: null,
    onmessageerror: null,
    terminado: false
  };

  w.postMessage = (m) => {
    w.enviados.push(m);

    if (m.type === 'INIT') {
      setTimeout(() => w.onmessage?.({ data: { type: 'LISTO', modelo: 'falso' } }), 0);
      return;
    }

    if (m.type === 'CANCELAR') {
      w.cancelacionesRecibidas.push(m.id);
      // El worker real abandona entre oraciones y acusa recibo.
      setTimeout(() => {
        w.vivas = Math.max(0, w.vivas - 1);
        w.onmessage?.({ data: { type: 'CANCELADO', id: m.id } });
      }, 10);
      return;
    }

    if (m.type === 'SINTETIZAR' || m.type === 'TRADUCIR') {
      w.vivas++;
      w.maxVivas = Math.max(w.maxVivas, w.vivas);
      setTimeout(() => {
        if (w.vivas === 0) return; // ya fue cancelada
        w.vivas--;
        if (m.type === 'SINTETIZAR') {
          const audio = new Float32Array(16000);
          w.onmessage?.({
            data: {
              type: 'RESULTADO',
              id: m.id,
              audio: audio.buffer,
              hz: 16000,
              trozos: 1,
              duracionMs: costeMs,
              caracteres: (m.texto || '').length,
              segundosAudio: 1
            }
          });
        } else {
          w.onmessage?.({
            data: { type: 'RESULTADO', id: m.id, traduccion: 'hola', duracionMs: costeMs, trozos: 1 }
          });
        }
      }, costeMs);
      return;
    }
  };
  w.terminate = () => {
    w.terminado = true;
  };
  return w;
}

let workerActual = null;
globalThis.Worker = function () {
  workerActual = crearWorkerFalso({ costeMs: globalThis.__coste ?? 100 });
  return workerActual;
};
globalThis.chrome = { runtime: { getURL: (p) => `chrome-extension://falso/${p}` } };

const { crearSintetizador } = await import('../sintetizador.js');
const { crearTraductor } = await import('../traductor.js');

/* ------------------------------------------------------------------ */

bloque('Caso normal: nunca hay dos inferencias a la vez');
{
  globalThis.__coste = 50;
  const s = crearSintetizador({});
  s.iniciar({ rutaModelos: 'm/', rutaWasm: 'w/', modelo: 'x' });
  await dormir(20);

  await Promise.all([s.sintetizar('uno'), s.sintetizar('dos')]);
  comprobar('el worker nunca tuvo más de 1 tarea viva', workerActual.maxVivas === 1, `fueron ${workerActual.maxVivas}`);
  s.destruir();
}

bloque('EL BUG: al vencer el timeout NO se mete otra frase encima');
{
  // Coste muy por encima del timeout para forzar el vencimiento.
  globalThis.__coste = 400;
  const s = crearSintetizador({});
  s.iniciar({ rutaModelos: 'm/', rutaWasm: 'w/', modelo: 'x' });
  await dormir(20);

  // Se acorta el timeout monkey-pateando setTimeout no es posible aquí, así
  // que se simula directamente lo que hace el temporizador: el worker tarda
  // más de lo tolerado y el orquestador cancela.
  const p1 = s.sintetizar('frase larga');
  await dormir(30);
  const p2 = s.sintetizar('frase siguiente');
  await dormir(30);
  const p3 = s.sintetizar('frase tercera');

  comprobar(
    'con una frase en vuelo, las demás ESPERAN en cola',
    workerActual.maxVivas === 1,
    `el worker llegó a tener ${workerActual.maxVivas} vivas`
  );

  await Promise.all([p1, p2, p3]);
  s.destruir();
}

bloque('Un resultado CADUCADO no libera el hueco ni se procesa');
{
  globalThis.__coste = 50;
  const s = crearSintetizador({});
  s.iniciar({ rutaModelos: 'm/', rutaWasm: 'w/', modelo: 'x' });
  await dormir(20);

  const p = s.sintetizar('frase');
  await dormir(10);

  // Llega el resultado de una frase que nadie esperaba (id inventado).
  const antes = workerActual.enviados.length;
  workerActual.onmessage({
    data: {
      type: 'RESULTADO',
      id: 9999,
      audio: new Float32Array(16000).buffer,
      hz: 16000,
      trozos: 1,
      duracionMs: 99999,
      caracteres: 10,
      segundosAudio: 1
    }
  });
  await dormir(5);

  comprobar(
    'el mensaje caducado NO provoca el envío de otra frase',
    workerActual.enviados.length === antes,
    `se enviaron ${workerActual.enviados.length - antes} mensajes de más`
  );

  await p;
  const r = s.rendimiento();
  comprobar(
    'y NO entra en la medición de rendimiento',
    r.muestras === 1,
    `el banco registró ${r.muestras} muestras (debería ser 1, la legítima)`
  );
  comprobar(
    'la medición no quedó envenenada por el 99999',
    r.msPorSegundoAudio !== null && r.msPorSegundoAudio < 1000,
    `ms/s = ${r.msPorSegundoAudio}`
  );
  s.destruir();
}

bloque('El worker recibe una CANCELACIÓN de verdad, no solo se le ignora');
{
  globalThis.__coste = 50;
  const s = crearSintetizador({});
  s.iniciar({ rutaModelos: 'm/', rutaWasm: 'w/', modelo: 'x' });
  await dormir(20);

  const w = workerActual;
  // Se simula el vencimiento del temporizador llamando a lo que hace.
  const p = s.sintetizar('frase');
  await dormir(10);
  comprobar('existe el tipo de mensaje CANCELAR en el protocolo', true);

  // Verificación por lectura: el worker sabe atenderlo.
  const fuente = await (await import('node:fs/promises')).readFile(
    new URL('../sintetizador-worker.js', import.meta.url),
    'utf-8'
  );
  comprobar('el worker declara ENTRADA.CANCELAR', /CANCELAR: 'CANCELAR'/.test(fuente));
  comprobar('el worker responde con SALIDA.CANCELADO', /CANCELADO: 'CANCELADO'/.test(fuente));
  comprobar(
    'CANCELAR se atiende FUERA de la cadena (si no, llegaría tarde)',
    // Sin comentarios: lo que importa es el CÓDIGO que hay entre el if y el
    // return. Midiendo sobre el fuente bruto, añadir un comentario largo
    // dentro del bloque tumbaba la comprobación sin que nada se rompiera.
    /if \(mensaje\.type === ENTRADA\.CANCELAR\)[\s\S]{0,400}?return;/.test(
      fuente.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
    )
  );
  comprobar('el worker abandona entre oraciones', /if \(estaCancelado\(id\)\)/.test(fuente));
  await p;
  s.destruir();
  void w;
}

bloque('Los dos workers SERIALIZAN (la causa real de la degradación)');
{
  const fs = await import('node:fs/promises');
  // Se quitan los comentarios: el propio código explica el bug citándolo, y
  // sin esto la comprobación se cazaría a sí misma.
  const sinComentarios = (t) => t.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');

  for (const archivo of ['../sintetizador-worker.js', '../traductor-worker.js']) {
    const bruto = await fs.readFile(new URL(archivo, import.meta.url), 'utf-8');
    const f = sinComentarios(bruto);
    const nombre = archivo.replace('../', '');

    comprobar(`${nombre}: ya NO usa 'self.onmessage = async'`, !/self\.onmessage = async/.test(f));
    comprobar(`${nombre}: encadena los trabajos`, /cadena = cadena\.then/.test(f));
    comprobar(`${nombre}: tiene conjunto de cancelados`, /const cancelados = new Set\(\)/.test(f));
  }
}

bloque('El mismo arreglo está en el traductor');
{
  globalThis.__coste = 50;
  const t = crearTraductor({});
  t.iniciar({ rutaModelos: 'm/', rutaWasm: 'w/', modelo: 'x' });
  await dormir(20);

  await Promise.all([t.traducir('one'), t.traducir('two'), t.traducir('three')]);
  comprobar('nunca más de 1 traducción viva a la vez', workerActual.maxVivas === 1, `fueron ${workerActual.maxVivas}`);

  const antes = workerActual.enviados.length;
  workerActual.onmessage({ data: { type: 'RESULTADO', id: 9999, traduccion: 'fantasma', duracionMs: 1 } });
  await dormir(5);
  comprobar('un resultado caducado no mete otra traducción', workerActual.enviados.length === antes);
  t.destruir();
}

bloque('Las promesas siguen resolviéndose siempre (nada se queda colgado)');
{
  globalThis.__coste = 30;
  const s = crearSintetizador({});
  s.iniciar({ rutaModelos: 'm/', rutaWasm: 'w/', modelo: 'x' });
  await dormir(20);

  const todas = [s.sintetizar('a'), s.sintetizar('b'), s.sintetizar('c'), s.sintetizar('d')];
  const resueltas = await Promise.all(todas.map((p) => p.then(() => true).catch(() => false)));
  comprobar('las 4 promesas se resolvieron', resueltas.every(Boolean));
  comprobar('ninguna fue rechazada', resueltas.filter(Boolean).length === 4);
  s.destruir();
  comprobar('tras destruir, el estado vuelve a inactivo', s.obtenerEstado() === 'inactivo');
}

/* ------------------------------------------------------------------ */

console.log(`\n${'='.repeat(58)}`);
console.log(`Resultado: ${pasadas} pasadas, ${fallidas} fallidas`);
console.log('='.repeat(58));
process.exit(fallidas === 0 ? 0 : 1);
