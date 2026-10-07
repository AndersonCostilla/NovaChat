// Prueba del camino de datos de la TRADUCCIÓN (Fase 4), sin navegador.
// Cubre: el facade traductor.js con un Worker simulado, la heurística de
// idioma y la persistencia del subtítulo con original + traducción.

let fallos = 0;
const comprobar = (nombre, condicion, extra = '') => {
  console.log(`${condicion ? '  ✔' : '  ✘'} ${nombre}${extra ? ` → ${extra}` : ''}`);
  if (!condicion) fallos++;
};

/* ---------- 1. Heurística de idioma (sólo se usa en modo 'auto') ---------- */
console.log('1) Heurística de idioma');
const { detectarIdioma } = await import('../detector-idioma.js');

const casos = [
  ['inglés', 'The thing is that you have to understand what they are doing with this', 'en'],
  ['francés', "C'est pour vous dire que nous ne sommes pas dans les temps", 'fr'],
  ['español', 'Lo que pasa es que no hay una forma muy clara para esto', 'es'],
  ['alemán', 'Das ist nicht die Sache und ich sie mit ein eine', 'de']
];
for (const [nombre, texto, esperado] of casos) {
  const r = detectarIdioma(texto);
  comprobar(`detecta ${nombre}`, r.idioma === esperado, `obtuvo "${r.idioma}"`);
}
comprobar('texto vacío no se marca como inglés', detectarIdioma('').esIngles === false);
comprobar('texto sin pistas no se marca como inglés', detectarIdioma('hmm ok').esIngles === false);

/* ---------- 2. traductor.js con un Worker simulado ---------- */
console.log('\n2) traductor.js (Worker simulado)');

const estados = [];
let instanciaWorker = null;

globalThis.chrome = { runtime: { getURL: (p) => `chrome-extension://fake/${p}` } };
globalThis.Worker = class {
  constructor() { instanciaWorker = this; this.enviados = []; }
  postMessage(m) {
    this.enviados.push(m);
    // Simulamos el worker real: INIT -> LISTO, TRADUCIR -> RESULTADO.
    if (m.type === 'INIT') queueMicrotask(() => this.onmessage({ data: { type: 'LISTO', modelo: m.modelo } }));
    if (m.type === 'TRADUCIR') {
      queueMicrotask(() => this.onmessage({
        data: { type: 'RESULTADO', id: m.id, traduccion: `[es] ${m.texto}`, duracionMs: 420 }
      }));
    }
  }
  terminate() { this.terminado = true; }
};

const { crearTraductor, ESTADO_TRADUCTOR } = await import('../traductor.js');
const traductor = crearTraductor({ onEstado: (i) => estados.push(i.estado) });

comprobar('antes de iniciar no traduce',
  (await traductor.traducir('hello')).motivo === 'traductor no iniciado');

traductor.iniciar({ rutaModelos: 'm/', rutaWasm: 'w/', modelo: 'opus-mt-en-es' });
await new Promise((r) => setTimeout(r, 10));

comprobar('pasa a LISTO tras cargar', traductor.obtenerEstado() === ESTADO_TRADUCTOR.LISTO);
comprobar('publicó estados cargando -> listo', estados.join(',') === 'cargando,listo', estados.join(','));

const r1 = await traductor.traducir('the cat is on the table');
comprobar('devuelve la traducción', r1.traduccion === '[es] the cat is on the table', r1.traduccion);
comprobar('reporta la duración', r1.duracionMs === 420);

// Tres textos a la vez: ninguno se queda colgado.
const varias = await Promise.all(['one', 'two', 'three'].map((t) => traductor.traducir(t)));
comprobar('traduce varias seguidas sin colgarse', varias.every((v) => v.traduccion.startsWith('[es]')));

/* ---------- 3. Caída del modelo: nadie se queda esperando ---------- */
console.log('\n3) Degradación cuando el modelo falla');
const promesaPendiente = traductor.traducir('this will never finish');
instanciaWorker.onmessage({ data: { type: 'ERROR', fase: 'carga', error: 'Failed to fetch' } });
const caida = await promesaPendiente;
comprobar('la promesa pendiente se resuelve (no se cuelga)', typeof caida.traduccion === 'string');
comprobar('estado del traductor = error', traductor.obtenerEstado() === ESTADO_TRADUCTOR.ERROR);
comprobar('mensaje de error traducido al español',
  estados.at(-1) === 'error');
const trasCaida = await traductor.traducir('hello again');
comprobar('tras el fallo responde sin traducir', trasCaida.motivo === 'traductor no disponible');

/* ---------- 4. Persistencia del subtítulo con traducción ---------- */
console.log('\n4) Persistencia (background.js real, chrome simulado)');
const almacen = new Map();
const alPopup = [];
let escucha = null;

globalThis.chrome = {
  runtime: {
    onMessage: { addListener: (fn) => { escucha = fn; } },
    sendMessage: async (m) => { if (m.target === 'popup') alPopup.push(m); },
    getContexts: async () => []
  },
  storage: { session: {
    get: async (c) => { const ks = Array.isArray(c) ? c : [c]; const r = {};
      for (const k of ks) if (almacen.has(k)) r[k] = almacen.get(k); return r; },
    set: async (o) => { for (const [k, v] of Object.entries(o)) almacen.set(k, v); }
  } },
  tabs: { get: async () => ({ url: '' }), onRemoved: { addListener() {} } },
  offscreen: { createDocument: async () => {}, closeDocument: async () => {} },
  tabCapture: { getMediaStreamId: async () => 'x' }
};

await import('../background.js');
const { MSG, MODULO, CLAVE_MODELO, CLAVE_TRADUCTOR } = await import('../messages.js');
const enviar = (m) => new Promise((res) => escucha(m, {}, res));

await enviar({ type: MSG.SUBTITLE_ADD, target: 'background', subtitulo: {
  texto: 'hello world', traduccion: 'hola mundo', aviso: '', idioma: 'en',
  duracionMs: 1900, duracionTraduccionMs: 400, totalMs: 2300, t: Date.now() } });

await enviar({ type: MSG.MODEL_STATUS_SET, target: 'background',
  modulo: MODULO.TRANSCRIPCION, modelo: { estado: 'listo', detalle: 'Modelo listo' } });
await enviar({ type: MSG.MODEL_STATUS_SET, target: 'background',
  modulo: MODULO.TRADUCCION, modelo: { estado: 'error', detalle: 'Faltan los archivos del traductor' } });

const panel = await enviar({ type: MSG.GET_SUBTITLES, target: 'background' });
comprobar('el subtítulo guarda original y traducción',
  panel.subtitulos[0].texto === 'hello world' && panel.subtitulos[0].traduccion === 'hola mundo');
comprobar('guarda los tiempos por separado',
  panel.subtitulos[0].duracionMs === 1900 && panel.subtitulos[0].duracionTraduccionMs === 400);
comprobar('estados de los dos módulos son independientes',
  panel.modelo.estado === 'listo' && panel.traductor.estado === 'error',
  `${panel.modelo.estado} / ${panel.traductor.estado}`);
comprobar('cada módulo usa su propia clave de storage',
  almacen.has(CLAVE_MODELO) && almacen.has(CLAVE_TRADUCTOR));

console.log(fallos === 0 ? '\nRESULTADO: TODO CORRECTO ✔' : `\nRESULTADO: ${fallos} FALLO(S) ✘`);
process.exit(fallos === 0 ? 0 : 1);
