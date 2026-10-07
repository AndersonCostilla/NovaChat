// Prueba de regresión del bug "API de contexto equivocado".
//
// Un documento offscreen SÓLO tiene acceso a chrome.runtime: chrome.storage,
// chrome.tabs, etc. llegan como undefined. Esta prueba simula ese entorno
// restringido (a diferencia del chrome simulado "generoso" de los otros tests,
// que expone storage y por eso NO habría detectado el fallo).

let fallos = 0;
const comprobar = (nombre, ok, extra = '') => {
  console.log(`${ok ? '  ✔' : '  ✘'} ${nombre}${extra ? ` → ${extra}` : ''}`);
  if (!ok) fallos++;
};

/* ---------- 1. Análisis estático: qué APIs toca cada archivo ---------- */
console.log('1) APIs de chrome usadas en los contextos restringidos');

const fs = await import('node:fs');
const ARCHIVOS_OFFSCREEN = ['../offscreen.js', '../transcriptor.js', '../traductor.js'];
const ARCHIVOS_WORKER = [
  '../transcriptor-worker.js',
  '../traductor-worker.js',
  '../vad-processor.js',
  '../segmentador.js' // se carga dentro del worker de traducción
];

function apisUsadas(ruta) {
  const codigo = fs.readFileSync(new URL(ruta, import.meta.url), 'utf8')
    // fuera comentarios: ahí se puede nombrar cualquier API sin usarla
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\/\/.*$/gm, '');
  return [...new Set([...codigo.matchAll(/chrome\.([a-zA-Z]+)/g)].map((m) => m[1]))];
}

for (const ruta of ARCHIVOS_OFFSCREEN) {
  const apis = apisUsadas(ruta);
  const prohibidas = apis.filter((a) => a !== 'runtime');
  comprobar(`${ruta.replace('../', '')} sólo usa chrome.runtime`,
    prohibidas.length === 0,
    prohibidas.length ? `USA ${prohibidas.map((a) => 'chrome.' + a).join(', ')}` : apis.join(', ') || 'ninguna');
}

for (const ruta of ARCHIVOS_WORKER) {
  const apis = apisUsadas(ruta);
  comprobar(`${ruta.replace('../', '')} no usa ninguna API de chrome`,
    apis.length === 0, apis.join(', ') || 'ninguna');
}

/* ---------- 2. Carga real con un chrome restringido ---------- */
console.log('\n2) Importar offscreen.js con el chrome LIMITADO del offscreen real');

// Exactamente lo que existe en un documento offscreen: runtime y poco más.
globalThis.chrome = {
  runtime: {
    getURL: (p) => `chrome-extension://fake/${p}`,
    sendMessage: async () => ({ ok: true, idiomas: { origen: 'auto', destino: 'es' } }),
    onMessage: { addListener: () => {} }
  }
  // OJO: sin storage, sin tabs, sin offscreen. Igual que en Chrome.
};
globalThis.AudioContext = class { constructor() { this.state = 'running'; } };

let errorCarga = null;
try {
  await import('../offscreen.js');
} catch (error) {
  errorCarga = error;
}

comprobar('offscreen.js se carga sin lanzar excepción',
  errorCarga === null, errorCarga ? `${errorCarga.name}: ${errorCarga.message}` : '');

console.log(fallos === 0 ? '\nRESULTADO: TODO CORRECTO ✔' : `\nRESULTADO: ${fallos} FALLO(S) ✘`);
process.exit(fallos === 0 ? 0 : 1);
