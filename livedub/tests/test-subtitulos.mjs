// Prueba del camino corregido: offscreen -> background -> storage.session + popup
const almacen = new Map();
const mensajesAlPopup = [];
let listener = null;

globalThis.chrome = {
  runtime: {
    onMessage: { addListener: (fn) => { listener = fn; } },
    sendMessage: async (m) => { if (m.target === 'popup') mensajesAlPopup.push(m); return undefined; },
    getContexts: async () => []
  },
  storage: {
    session: {
      get: async (claves) => {
        const ks = Array.isArray(claves) ? claves : [claves];
        const r = {}; for (const k of ks) if (almacen.has(k)) r[k] = almacen.get(k); return r;
      },
      set: async (obj) => { for (const [k, v] of Object.entries(obj)) almacen.set(k, v); }
    },
    local: { get: async () => ({}) },
    // El service worker SÍ tiene storage.onChanged (el offscreen no).
    onChanged: { addListener: () => {} }
  },
  tabs: { get: async () => ({ url: '' }), onRemoved: { addListener() {} } },
  offscreen: { createDocument: async () => {}, closeDocument: async () => {} },
  tabCapture: { getMediaStreamId: async () => 'fake' }
};

await import('/home/user/NovaChat/livedub/background.js');
const { MSG, CLAVE_SUBTITULOS, CLAVE_MODELO, MAX_SUBTITULOS } =
  await import('/home/user/NovaChat/livedub/messages.js');

const enviar = (m) => new Promise((res) => { listener(m, {}, res); });

// 1) 25 subtítulos seguidos (prueba también el recorte y la serialización)
const envios = [];
for (let i = 1; i <= 25; i++) {
  envios.push(enviar({ type: MSG.SUBTITLE_ADD, target: 'background',
    subtitulo: { texto: `frase ${i}`, idioma: 'en', duracionMs: 1900, t: Date.now() } }));
}
await Promise.all(envios);

const hist = almacen.get(CLAVE_SUBTITULOS) || [];
console.log(`1) guardados en storage.session: ${hist.length} (esperado ${MAX_SUBTITULOS})`);
console.log(`   primero="${hist[0]?.texto}" último="${hist.at(-1)?.texto}" (esperado "frase 6" / "frase 25")`);
console.log(`   avisos SUBTITLE al popup: ${mensajesAlPopup.filter(m => m.type === MSG.SUBTITLE).length} (esperado 25)`);

// 2) estado del modelo
await enviar({ type: MSG.MODEL_STATUS_SET, target: 'background', modelo: { estado: 'listo', detalle: 'Modelo listo' } });
console.log(`2) storage[${CLAVE_MODELO}] =`, JSON.stringify(almacen.get(CLAVE_MODELO)));
console.log(`   avisos MODEL_STATUS al popup: ${mensajesAlPopup.filter(m => m.type === MSG.MODEL_STATUS).length} (esperado 1)`);

// 3) lo que recibe el popup al abrirse
const panel = await enviar({ type: MSG.GET_SUBTITLES, target: 'background' });
console.log(`3) GET_SUBTITLES -> ${panel.subtitulos.length} subtítulos, modelo="${panel.modelo.estado}"`);

// 4) veredicto
const ok = hist.length === MAX_SUBTITULOS && hist.at(-1).texto === 'frase 25' &&
  hist[0].texto === 'frase 6' && panel.subtitulos.length === MAX_SUBTITULOS &&
  panel.modelo.estado === 'listo' &&
  mensajesAlPopup.filter(m => m.type === MSG.SUBTITLE).length === 25;
console.log(ok ? '\nRESULTADO: TODO CORRECTO ✔' : '\nRESULTADO: FALLA ✘');
process.exit(ok ? 0 : 1);
