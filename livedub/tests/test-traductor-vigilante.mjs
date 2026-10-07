// Prueba del VIGILANTE DE CARGA del traductor (Fase 4).
//
// Reproduce el fallo que apareció en Chrome: el worker de traducción se queda
// cargando indefinidamente y NUNCA manda 'LISTO' ni 'ERROR'. Antes del
// vigilante, el estado se quedaba en 'cargando' para siempre, el badge giraba
// sin fin y cada frase nueva se descartaba "por cola llena" sin que nada
// explicara por qué.
//
// Aquí se simula exactamente ese worker mudo y se comprueba que el sistema
// acaba declarando 'error' por su cuenta.

let fallos = 0;
const comprobar = (nombre, condicion, extra = '') => {
  console.log(`${condicion ? '  ✔' : '  ✘'} ${nombre}${extra ? ` → ${extra}` : ''}`);
  if (!condicion) fallos++;
};

/* ------------------------------------------------------------------ */
/* Reloj falso: los timeouts reales son de 90 s, no vamos a esperarlos  */
/* ------------------------------------------------------------------ */

const temporizadores = new Map();
let siguienteTemporizador = 1;
let ahora = 0;

globalThis.setTimeout = (fn, ms) => {
  const id = siguienteTemporizador++;
  temporizadores.set(id, { fn, cuando: ahora + ms });
  return id;
};
globalThis.clearTimeout = (id) => temporizadores.delete(id);

// Avanza el reloj disparando lo que toque, y cede el turno para que se
// resuelvan las microtareas pendientes.
async function avanzar(ms) {
  ahora += ms;
  for (const [id, t] of [...temporizadores]) {
    if (t.cuando <= ahora) {
      temporizadores.delete(id);
      t.fn();
    }
  }
  await new Promise((r) => queueMicrotask(r));
}

/* ------------------------------------------------------------------ */
/* Worker MUDO: acepta el INIT y no contesta jamás                      */
/* ------------------------------------------------------------------ */

const mensajesEnviados = [];
globalThis.chrome = { runtime: { getURL: (p) => `chrome-extension://fake/${p}` } };
globalThis.Worker = class {
  constructor() {
    this.onmessage = null;
    this.onerror = null;
    this.onmessageerror = null;
  }
  postMessage(m) {
    mensajesEnviados.push(m);
    /* silencio absoluto: es justo el bug que estamos reproduciendo */
  }
  terminate() {}
};

const { crearTraductor, ESTADO_TRADUCTOR } = await import('../traductor.js');

console.log('1) Worker que nunca responde al INIT');

const estados = [];
const traductor = crearTraductor({ onEstado: (info) => estados.push(info.estado) });

traductor.iniciar({
  rutaModelos: 'chrome-extension://fake/models/',
  rutaWasm: 'chrome-extension://fake/libs/transformers/',
  modelo: 'opus-mt-en-es'
});

comprobar('tras iniciar queda en "cargando"', traductor.obtenerEstado() === ESTADO_TRADUCTOR.CARGANDO);
comprobar('se envió el INIT al worker', mensajesEnviados[0]?.type === 'INIT');

// A los 60 s todavía es razonable estar cargando: no debe cortar antes de tiempo.
await avanzar(60000);
comprobar(
  'a los 60 s sigue en "cargando" (no corta antes de tiempo)',
  traductor.obtenerEstado() === ESTADO_TRADUCTOR.CARGANDO,
  traductor.obtenerEstado()
);

// Encolamos frases mientras "carga": antes del arreglo, se quedaban colgadas.
const promesas = [1, 2, 3, 4, 5, 6].map((n) => traductor.traducir(`frase ${n}`));

await avanzar(31000); // total 91 s > TIMEOUT_CARGA_MS (90 s)

console.log('\n2) El vigilante corta por lo sano');
comprobar(
  'pasados 90 s el estado pasa a "error"',
  traductor.obtenerEstado() === ESTADO_TRADUCTOR.ERROR,
  traductor.obtenerEstado()
);
comprobar('la transición quedó registrada en onEstado', estados.includes(ESTADO_TRADUCTOR.ERROR));

console.log('\n3) Ninguna promesa se queda colgada');
const resueltas = await Promise.all(
  promesas.map((p) => Promise.race([p, new Promise((r) => queueMicrotask(() => r('COLGADA')))]))
);
comprobar(
  'las 6 frases encoladas se resolvieron',
  resueltas.every((r) => r !== 'COLGADA'),
  `${resueltas.filter((r) => r !== 'COLGADA').length}/6`
);
comprobar(
  'ninguna devuelve traducción inventada',
  resueltas.every((r) => r.traduccion === ''),
  JSON.stringify(resueltas[0])
);

console.log('\n4) Con el traductor en error, traducir no cuelga ni inventa');
const posterior = await traductor.traducir('otra frase');
comprobar('responde al instante', posterior.traduccion === '');
comprobar('explica el motivo', /no disponible/i.test(posterior.motivo || ''), posterior.motivo);

console.log('\n5) Un worker que SÍ responde no dispara el vigilante');
globalThis.Worker = class {
  constructor() { this.onmessage = null; this.onerror = null; this.onmessageerror = null; }
  postMessage(m) {
    if (m.type === 'INIT') queueMicrotask(() => this.onmessage({ data: { type: 'LISTO', modelo: m.modelo } }));
    if (m.type === 'TRADUCIR') {
      queueMicrotask(() =>
        this.onmessage({ data: { type: 'RESULTADO', id: m.id, traduccion: `[es] ${m.texto}`, duracionMs: 12 } })
      );
    }
  }
  terminate() {}
};

const bueno = crearTraductor({});
bueno.iniciar({ rutaModelos: 'x/', rutaWasm: 'y/', modelo: 'opus-mt-en-es' });
await new Promise((r) => queueMicrotask(r));
comprobar('pasa a "listo"', bueno.obtenerEstado() === ESTADO_TRADUCTOR.LISTO, bueno.obtenerEstado());

await avanzar(200000); // mucho más allá del vigilante
comprobar(
  'sigue "listo" pasados 200 s: el vigilante se desarmó',
  bueno.obtenerEstado() === ESTADO_TRADUCTOR.LISTO,
  bueno.obtenerEstado()
);
const r = await bueno.traducir('hello world');
comprobar('y traduce con normalidad', r.traduccion === '[es] hello world', r.traduccion);

console.log(`\nRESULTADO: ${fallos === 0 ? 'TODO CORRECTO ✔' : `${fallos} FALLO(S) ✘`}`);
process.exit(fallos === 0 ? 0 : 1);
