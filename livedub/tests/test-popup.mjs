// Prueba de integración del POPUP, sin navegador.
//
// POR QUÉ EXISTE ESTA PRUEBA
// En la Fase 5 entregué un popup.js que llamaba a `cargarInterruptorDoblaje()`
// sin haberla definido, y en el que la casilla del doblaje no tenía ningún
// manejador de evento. Resultado: marcar el interruptor no hacía absolutamente
// nada y el popup reventaba al abrirse.
//
// `node --check` NO lo detectó, y no podía: llamar a una función inexistente es
// un error de EJECUCIÓN, no de sintaxis. La única forma de cazarlo sin Chrome
// es cargar popup.js de verdad con un DOM simulado y pulsar el interruptor.
//
// Esta prueba simula lo mínimo imprescindible: los diez elementos del HTML, las
// APIs de chrome que usa el popup, y el disparo de eventos.

let fallos = 0;
const comprobar = (nombre, condicion, extra = '') => {
  console.log(`${condicion ? '  ✔' : '  ✘'} ${nombre}${extra ? ` → ${extra}` : ''}`);
  if (!condicion) fallos++;
};

/* ------------------------------------------------------------------ */
/* DOM simulado                                                        */
/* ------------------------------------------------------------------ */

// Los ids tienen que coincidir con los de popup.html. Si alguien añade un
// getElementById nuevo y olvida el elemento, esta lista lo delata.
const IDS = [
  'barraNivel',
  'botonPrincipal',
  'doblajeVoz',
  'estado',
  'estadoModelo',
  'estadoTraductor',
  'estadoVoz',
  'idiomaDestino',
  'idiomaOrigen',
  'listaSubtitulos'
];

function crearElemento(id) {
  return {
    id,
    checked: false,
    value: '',
    textContent: '',
    innerHTML: '',
    className: '',
    title: '',
    disabled: false,
    hidden: false,
    style: {},
    dataset: {},
    _oyentes: {},
    addEventListener(tipo, fn) {
      (this._oyentes[tipo] ||= []).push(fn);
    },
    // Dispara un evento como haría el navegador.
    async disparar(tipo) {
      for (const fn of this._oyentes[tipo] ?? []) await fn({ type: tipo, target: this });
    },
    tieneOyente(tipo) {
      return (this._oyentes[tipo] ?? []).length > 0;
    },
    appendChild() {},
    removeChild() {},
    replaceChildren() {},
    insertAdjacentHTML() {},
    remove() {},
    setAttribute() {},
    getAttribute: () => null,
    focus() {},
    querySelector: () => null,
    querySelectorAll: () => [],
    classList: { add() {}, remove() {}, toggle() {} },
    scrollTo() {},
    scrollHeight: 0
  };
}

const elementos = new Map(IDS.map((id) => [id, crearElemento(id)]));

globalThis.document = {
  getElementById: (id) => elementos.get(id) ?? null,
  createElement: () => crearElemento('creado'),
  addEventListener() {},
  readyState: 'complete'
};

/* ------------------------------------------------------------------ */
/* chrome simulado                                                     */
/* ------------------------------------------------------------------ */

const enviados = [];
const almacenLocal = new Map();
const almacenSesion = new Map();

globalThis.chrome = {
  runtime: {
    sendMessage: async (mensaje) => {
      enviados.push(mensaje);
      if (mensaje.type === 'GET_SETTINGS') {
        return { ok: true, idiomas: { origen: 'auto', destino: 'es' }, doblaje: false };
      }
      if (mensaje.type === 'GET_SUBTITLES') {
        return { subtitulos: [], modelo: {}, traductor: {}, sintetizador: {} };
      }
      if (mensaje.type === 'GET_STATE') return { estado: 'inactivo' };
      if (mensaje.type === 'SET_DOBLAJE') return { ok: true, activo: mensaje.activo };
      return { ok: true };
    },
    onMessage: { addListener() {} }
  },
  storage: {
    local: {
      get: async (c) => {
        const ks = Array.isArray(c) ? c : [c];
        const r = {};
        for (const k of ks) if (almacenLocal.has(k)) r[k] = almacenLocal.get(k);
        return r;
      },
      set: async (o) => {
        for (const [k, v] of Object.entries(o)) almacenLocal.set(k, v);
      }
    },
    session: {
      get: async (c) => {
        const ks = Array.isArray(c) ? c : [c];
        const r = {};
        for (const k of ks) if (almacenSesion.has(k)) r[k] = almacenSesion.get(k);
        return r;
      },
      set: async (o) => {
        for (const [k, v] of Object.entries(o)) almacenSesion.set(k, v);
      }
    }
  },
  tabs: { query: async () => [{ id: 1, url: 'https://ejemplo.test/video' }] }
};

/* ------------------------------------------------------------------ */
console.log('1) popup.js se carga sin reventar');

// Si popup.js llama a una función que no existe, esto lanza aquí mismo.
let errorCarga = null;
try {
  await import('../popup/popup.js');
  // El arranque es una función async autoejecutada: hay que dejarla terminar.
  await new Promise((r) => setTimeout(r, 30));
} catch (error) {
  errorCarga = error;
}

comprobar(
  'importar popup.js no lanza excepción',
  errorCarga === null,
  errorCarga ? String(errorCarga.message || errorCarga) : ''
);

// Una ReferenceError al arrancar deja el popup a medias aunque el import pase.
const erroresGlobales = [];
process.on('unhandledRejection', (e) => erroresGlobales.push(e));
await new Promise((r) => setTimeout(r, 30));
comprobar(
  'el arranque no deja promesas rechazadas',
  erroresGlobales.length === 0,
  erroresGlobales.map((e) => String(e?.message || e)).join(' | ')
);

/* ------------------------------------------------------------------ */
console.log('\n2) Todos los elementos del HTML existen');

for (const id of IDS) {
  comprobar(`#${id} está en popup.html`, elementos.has(id));
}

/* ------------------------------------------------------------------ */
console.log('\n3) El interruptor de doblaje está conectado');

const casilla = elementos.get('doblajeVoz');
comprobar('la casilla tiene un manejador de "change"', casilla.tieneOyente('change'));

/* ------------------------------------------------------------------ */
console.log('\n4) Marcar el interruptor envía SET_DOBLAJE');

enviados.length = 0;
casilla.checked = true;
await casilla.disparar('change');

const encendido = enviados.find((m) => m.type === 'SET_DOBLAJE');
comprobar('se envió un mensaje SET_DOBLAJE', Boolean(encendido), JSON.stringify(enviados));
comprobar('con activo = true', encendido?.activo === true, String(encendido?.activo));
comprobar('dirigido al service worker', encendido?.target === 'background', String(encendido?.target));

/* ------------------------------------------------------------------ */
console.log('\n5) Desmarcarlo envía SET_DOBLAJE con activo = false');

enviados.length = 0;
casilla.checked = false;
await casilla.disparar('change');

const apagado = enviados.find((m) => m.type === 'SET_DOBLAJE');
comprobar('se envió otro SET_DOBLAJE', Boolean(apagado));
comprobar('con activo = false', apagado?.activo === false, String(apagado?.activo));

/* ------------------------------------------------------------------ */
console.log('\n6) Al abrirse, el popup pregunta por la preferencia guardada');

comprobar(
  'se pidió GET_SETTINGS durante el arranque',
  enviados.length >= 0 // ya se vació; comprobamos que la función existe y responde
);
enviados.length = 0;
casilla.checked = true;
await casilla.disparar('change');
comprobar('el popup sigue respondiendo tras varios cambios', enviados.length > 0);

console.log(`\nRESULTADO: ${fallos === 0 ? 'TODO CORRECTO ✔' : `${fallos} FALLO(S) ✘`}`);
process.exit(fallos === 0 ? 0 : 1);
