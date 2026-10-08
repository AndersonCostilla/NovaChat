// Prueba del doblaje por voz y del ducking (Fase 5), sin navegador.
//
// Cubre:
//   1. sintetizador.js con un Worker simulado (cola, estados, caída del modelo)
//   2. el vigilante de carga de 90 s
//   3. reproductor-doblaje.js: ducking, cola de reproducción y restauración
//   4. que un fallo de la voz NO afecta a los otros módulos

let fallos = 0;
const comprobar = (nombre, condicion, extra = '') => {
  console.log(`${condicion ? '  ✔' : '  ✘'} ${nombre}${extra ? ` → ${extra}` : ''}`);
  if (!condicion) fallos++;
};

/* ------------------------------------------------------------------ */
/* Reloj falso                                                         */
/* ------------------------------------------------------------------ */
const temporizadores = new Map();
let siguienteT = 1;
let ahora = 0;
const setTimeoutReal = globalThis.setTimeout;

globalThis.setTimeout = (fn, ms) => {
  const id = siguienteT++;
  temporizadores.set(id, { fn, cuando: ahora + ms });
  return id;
};
globalThis.clearTimeout = (id) => temporizadores.delete(id);

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
/* 1. sintetizador.js con worker simulado                              */
/* ------------------------------------------------------------------ */
console.log('1) sintetizador.js (Worker simulado)');

globalThis.chrome = { runtime: { getURL: (p) => `chrome-extension://fake/${p}` } };

let modoWorker = 'bueno';
globalThis.Worker = class {
  constructor() {
    this.onmessage = null;
    this.onerror = null;
    this.onmessageerror = null;
  }
  postMessage(m) {
    if (modoWorker === 'mudo') return;
    if (m.type === 'INIT') {
      if (modoWorker === 'rotoAlCargar') {
        queueMicrotask(() =>
          this.onmessage({
            data: { type: 'ERROR', fase: 'carga', error: 'Faltan archivos del modelo de voz' }
          })
        );
        return;
      }
      queueMicrotask(() => this.onmessage({ data: { type: 'LISTO', modelo: m.modelo } }));
    }
    if (m.type === 'SINTETIZAR') {
      // 0,5 s de audio a 16 kHz
      const audio = new Float32Array(8000).fill(0.1);
      queueMicrotask(() =>
        this.onmessage({
          data: {
            type: 'RESULTADO',
            id: m.id,
            audio: audio.buffer,
            hz: 16000,
            trozos: 1,
            duracionMs: 320
          }
        })
      );
    }
  }
  terminate() {}
};

const { crearSintetizador, ESTADO_SINTETIZADOR } = await import('../sintetizador.js');

const estados = [];
const voz = crearSintetizador({ onEstado: (i) => estados.push(i.estado) });
voz.iniciar({ rutaModelos: 'm/', rutaWasm: 'w/', modelo: 'mms-tts-spa' });
await new Promise((r) => queueMicrotask(r));

comprobar('pasa a "listo"', voz.obtenerEstado() === ESTADO_SINTETIZADOR.LISTO, voz.obtenerEstado());

const r1 = await voz.sintetizar('Hola, esto es una prueba.');
comprobar('devuelve una onda', r1.audio instanceof Float32Array, `${r1.audio?.length} muestras`);
comprobar('informa la frecuencia', r1.hz === 16000, String(r1.hz));

const vacio = await voz.sintetizar('');
comprobar('texto vacío no rompe', vacio.audio === null && /vac/i.test(vacio.motivo), vacio.motivo);

/* ------------------------------------------------------------------ */
console.log('\n2) El modelo de voz falla al cargar');

modoWorker = 'rotoAlCargar';
const vozRota = crearSintetizador({});
vozRota.iniciar({ rutaModelos: 'm/', rutaWasm: 'w/', modelo: 'mms-tts-spa' });
await new Promise((r) => queueMicrotask(r));

comprobar('queda en "error"', vozRota.obtenerEstado() === ESTADO_SINTETIZADOR.ERROR);

const trasFallo = await vozRota.sintetizar('algo');
comprobar('sintetizar responde al instante', trasFallo.audio === null);
comprobar('explica el motivo', /no disponible/i.test(trasFallo.motivo || ''), trasFallo.motivo);

/* ------------------------------------------------------------------ */
console.log('\n3) Vigilante de carga: worker mudo');

modoWorker = 'mudo';
const vozMuda = crearSintetizador({});
vozMuda.iniciar({ rutaModelos: 'm/', rutaWasm: 'w/', modelo: 'mms-tts-spa' });
comprobar('arranca en "cargando"', vozMuda.obtenerEstado() === ESTADO_SINTETIZADOR.CARGANDO);

const encoladas = [1, 2, 3, 4].map((n) => vozMuda.sintetizar(`frase ${n}`));

await avanzar(60000);
comprobar('a los 60 s sigue cargando', vozMuda.obtenerEstado() === ESTADO_SINTETIZADOR.CARGANDO);

await avanzar(31000);
comprobar('a los 90 s pasa a "error"', vozMuda.obtenerEstado() === ESTADO_SINTETIZADOR.ERROR);

const resueltas = await Promise.all(
  encoladas.map((p) => Promise.race([p, new Promise((r) => queueMicrotask(() => r('COLGADA')))]))
);
comprobar(
  'ninguna promesa queda colgada',
  resueltas.every((r) => r !== 'COLGADA'),
  `${resueltas.filter((r) => r !== 'COLGADA').length}/4`
);

/* ------------------------------------------------------------------ */
/* 4. reproductor-doblaje.js: ducking                                  */
/* ------------------------------------------------------------------ */
console.log('\n4) reproductor-doblaje.js (ducking)');

const { crearReproductorDoblaje, fijarVelocidadDoblaje, obtenerVelocidadDoblaje } = await import(
  '../reproductor-doblaje.js'
);
const { DUCKING, VOZ } = await import('../messages.js');
const { crearDucking } = await import('../ducking.js');

// AudioContext simulado, suficiente para observar las rampas de ganancia.
const rampas = [];
let fuentesCreadas = [];

function crearCadenaFalsa() {
  const ganancia = {
    gain: {
      value: 1,
      setTargetAtTime(destino) {
        this.value = destino; // el simulador aplica la rampa al instante
        rampas.push(destino);
      }
    }
  };
  const contexto = {
    currentTime: 0,
    destination: { id: 'destino' },
    createBuffer: (canales, largo, hz) => ({
      _datos: new Float32Array(largo),
      sampleRate: hz,
      getChannelData() {
        return this._datos;
      }
    }),
    createBufferSource: () => {
      const f = {
        buffer: null,
        onended: null,
        conectado: false,
        parado: false,
        // Fase 5.1: el reproductor acelera el doblaje para compensar que el
        // español dura más que el original. El nodo real trae un AudioParam.
        playbackRate: { value: 1 },
        connect() {
          this.conectado = true;
        },
        disconnect() {
          this.conectado = false;
        },
        start() {
          this.iniciado = true;
        },
        stop() {
          this.parado = true;
        }
      };
      fuentesCreadas.push(f);
      return f;
    }
  };
  return { contexto, ganancia };
}

const cadena = crearCadenaFalsa();
const hablando = [];

// OJO AL CAMBIO: el ducking ya NO vive dentro del reproductor, se mudó a
// ducking.js porque lo necesitan los dos motores de voz (la voz del sistema
// no reproduce muestras, pero sí tiene que agachar el original).
//
// Aquí se montan igual que los monta motor-voz.js en producción, así que
// estas pruebas siguen cubriendo exactamente lo que se ejecuta: el
// reproductor avisa de cuándo habla y el ducking reacciona.
const ducking = crearDucking({ obtenerCadena: () => cadena });
const repro = crearReproductorDoblaje({
  obtenerCadena: () => cadena,
  onHablando: (h) => {
    hablando.push(h);
    if (h) ducking.agachar();
    else ducking.levantar();
  }
});

comprobar('el volumen original parte de 1', cadena.ganancia.gain.value === 1);

const onda = new Float32Array(8000).fill(0.2);
repro.reproducir(onda, 16000);

comprobar('al empezar a hablar, el original se agacha', cadena.ganancia.gain.value === DUCKING.NIVEL, String(cadena.ganancia.gain.value));
comprobar('el nivel de ducking está entre el 15 % y el 20 %', DUCKING.NIVEL >= 0.15 && DUCKING.NIVEL <= 0.2, String(DUCKING.NIVEL));
comprobar('avisa de que está hablando', hablando[0] === true);
comprobar('la fuente se conectó y arrancó', fuentesCreadas[0]?.conectado && fuentesCreadas[0]?.iniciado);

// Fase 5.1. El doblaje se reproduce acelerado: el español traducido dura más
// que el fragmento original, así que sin esto se retrasaría aunque la síntesis
// fuese instantánea.
comprobar(
  'el doblaje se reproduce acelerado',
  fuentesCreadas[0]?.playbackRate.value === VOZ.VELOCIDAD,
  `playbackRate = ${fuentesCreadas[0]?.playbackRate.value}`
);
comprobar(
  'la velocidad por defecto es mayor que 1 pero no caricaturesca',
  VOZ.VELOCIDAD > 1 && VOZ.VELOCIDAD <= 1.3,
  String(VOZ.VELOCIDAD)
);
comprobar('se puede bajar la velocidad en caliente', fijarVelocidadDoblaje(1.05) === 1.05);
comprobar('no se puede pasar del máximo', fijarVelocidadDoblaje(99) === VOZ.VELOCIDAD_MAX);
comprobar('ni bajar del mínimo', fijarVelocidadDoblaje(0.1) === VOZ.VELOCIDAD_MIN);
comprobar('un valor absurdo no rompe nada', fijarVelocidadDoblaje('hola') === VOZ.VELOCIDAD_MIN);
fijarVelocidadDoblaje(VOZ.VELOCIDAD); // restaurar para el resto de la prueba
comprobar('se restauró la velocidad por defecto', obtenerVelocidadDoblaje() === VOZ.VELOCIDAD);

// Fin de la reproducción
fuentesCreadas[0].onended();
comprobar('al terminar, el volumen vuelve a 1', cadena.ganancia.gain.value === 1, String(cadena.ganancia.gain.value));
comprobar('avisa de que dejó de hablar', hablando[hablando.length - 1] === false);
comprobar('no está hablando', repro.estaHablando() === false);

/* ------------------------------------------------------------------ */
console.log('\n5) Dos frases seguidas: sin efecto bombeo');

fuentesCreadas = [];
rampas.length = 0;
repro.reproducir(onda, 16000);
repro.reproducir(onda, 16000);

comprobar('sólo suena una a la vez', fuentesCreadas.length === 1, `${fuentesCreadas.length} fuente(s)`);
comprobar('hay una frase esperando', repro.enCola() === 1, String(repro.enCola()));

fuentesCreadas[0].onended(); // encadena con la siguiente
comprobar('encadena la segunda', fuentesCreadas.length === 2);
comprobar(
  'NO sube el volumen entre las dos',
  cadena.ganancia.gain.value === DUCKING.NIVEL,
  String(cadena.ganancia.gain.value)
);

fuentesCreadas[1].onended();
comprobar('al acabar las dos, vuelve a 1', cadena.ganancia.gain.value === 1);

/* ------------------------------------------------------------------ */
console.log('\n6) Parar y silenciar restauran el volumen');

fuentesCreadas = [];
repro.reproducir(onda, 16000);
comprobar('está agachado', cadena.ganancia.gain.value === DUCKING.NIVEL);

repro.parar();
comprobar('parar() restaura el volumen', cadena.ganancia.gain.value === 1, String(cadena.ganancia.gain.value));
comprobar('parar() detiene la fuente', fuentesCreadas[0]?.parado === true);
comprobar('parar() vacía la cola', repro.enCola() === 0);

repro.silenciar(true);
const aceptada = repro.reproducir(onda, 16000);
comprobar('con el doblaje apagado no se reproduce nada', aceptada === false);
comprobar('y el volumen sigue a 1', cadena.ganancia.gain.value === 1);

repro.silenciar(false);
comprobar('al reactivar vuelve a aceptar audio', repro.reproducir(onda, 16000) === true);
repro.parar();

/* ------------------------------------------------------------------ */
console.log('\n7) Sin captura activa no se rompe');

const sinCadena = crearReproductorDoblaje({ obtenerCadena: () => null });
void sinCadena;
let reventó = false;
try {
  sinCadena.reproducir(onda, 16000);
  sinCadena.parar();
} catch (_) {
  reventó = true;
}
comprobar('no lanza excepción', reventó === false);

/* ------------------------------------------------------------------ */
console.log('\n8) Las tres claves de estado son distintas');

const { CLAVE_MODELO, CLAVE_TRADUCTOR, CLAVE_SINTETIZADOR, MODULO } = await import('../messages.js');
const claves = [CLAVE_MODELO, CLAVE_TRADUCTOR, CLAVE_SINTETIZADOR];
comprobar(
  'transcripción, traducción y voz usan claves separadas',
  new Set(claves).size === 3,
  claves.join(' / ')
);
comprobar('existe el módulo de síntesis', MODULO.SINTESIS === 'sintesis');

globalThis.setTimeout = setTimeoutReal;
console.log(`\nRESULTADO: ${fallos === 0 ? 'TODO CORRECTO ✔' : `${fallos} FALLO(S) ✘`}`);
process.exit(fallos === 0 ? 0 : 1);
