// test-voz-sistema.mjs
// Pruebas del motor de voz del sistema (voz-sistema.js) y de la fachada
// (motor-voz.js), con un speechSynthesis FALSO.
//
// Qué se comprueba, y por qué cada cosa:
//   1. Nunca se usa una voz de red. Es la promesa de privacidad del proyecto.
//   2. Nunca hablan dos frases a la vez. Es el arreglo de colas aplicado aquí.
//   3. Si el evento `end` no llega, el vigilante libera igualmente. Si no, el
//      audio original se quedaría agachado para siempre.
//   4. El texto largo se trocea sin perder ni una palabra. Trocear no es
//      resumir: el usuario prohibió expresamente omitir contenido.
//   5. El ducking baja y sube, y vuelve siempre.
//
// Uso: node livedub/tests/test-voz-sistema.mjs

import { crearVozSistema, trocearParaHablar, ESTADO_VOZ_SISTEMA } from '../voz-sistema.js';
import { crearDucking } from '../ducking.js';
import { crearMotorVoz } from '../motor-voz.js';
import { VOZ_SISTEMA, DUCKING, MOTOR_VOZ } from '../messages.js';

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
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

// ─────────────────────────────────────────────────────────────────────
// speechSynthesis falso
// ─────────────────────────────────────────────────────────────────────

const VOCES_EQUIPO_REAL = [
  // Las dos que Anderson tiene instaladas (paso 0, 7-oct-2026).
  { name: 'Microsoft Raul - Spanish (Mexico)', lang: 'es-MX', localService: true },
  { name: 'Microsoft Sabina - Spanish (Mexico)', lang: 'es-MX', localService: true },
  // Las de red que vio en la tabla y que NO se deben usar jamás.
  { name: 'Google español', lang: 'es-ES', localService: false },
  { name: 'Google español de Estados Unidos', lang: 'es-US', localService: false },
  { name: 'Microsoft David - English (United States)', lang: 'en-US', localService: true }
];

function crearSintesisFalsa({ voces = VOCES_EQUIPO_REAL, nuncaTermina = false, msPorCaracter = 1 } = {}) {
  const estado = { vivas: 0, maxVivas: 0, habladas: [], cancelaciones: 0 };

  return {
    estado,
    getVoices: () => voces,
    cancel() {
      estado.cancelaciones++;
      // El navegador real dispara `error: canceled` en lo que estaba sonando.
      const pend = estado.enCurso;
      estado.enCurso = null;
      if (pend) {
        estado.vivas--;
        clearTimeout(pend.temporizador);
        pend.locucion.onerror?.({ error: 'canceled' });
      }
    },
    speak(locucion) {
      estado.vivas++;
      estado.maxVivas = Math.max(estado.maxVivas, estado.vivas);
      estado.habladas.push({ texto: locucion.text, voz: locucion.voice?.name, rate: locucion.rate });

      locucion.onstart?.();

      if (nuncaTermina) {
        // Simula el fallo documentado: habla y no avisa nunca.
        estado.enCurso = { locucion, temporizador: null };
        return;
      }

      const temporizador = setTimeout(() => {
        if (estado.enCurso?.locucion !== locucion) return;
        estado.enCurso = null;
        estado.vivas--;
        locucion.onend?.();
      }, Math.max(1, locucion.text.length * msPorCaracter));

      estado.enCurso = { locucion, temporizador };
    }
  };
}

class LocucionFalsa {
  constructor(texto) {
    this.text = texto;
  }
}

// ─────────────────────────────────────────────────────────────────────

bloque('PRIVACIDAD: jamás una voz de red');
{
  const sintesis = crearSintesisFalsa();
  const voz = crearVozSistema({ sintesis, Locucion: LocucionFalsa });
  const r = await voz.iniciar();

  comprobar('arranca con las voces del equipo real', r.ok, JSON.stringify(r));
  comprobar(
    'elige una voz LOCAL',
    r.voz === 'Microsoft Raul - Spanish (Mexico)',
    `eligió "${r.voz}"`
  );
  comprobar('cuenta las 2 voces locales', r.locales === 2, `locales=${r.locales}`);
  comprobar('declara haber ignorado las 2 de red', r.remotasIgnoradas === 2);

  await voz.hablar('Hola.');
  const usadas = new Set(sintesis.estado.habladas.map((h) => h.voz));
  comprobar(
    'ninguna locución salió por una voz de red',
    ![...usadas].some((n) => /^Google/.test(n || '')),
    [...usadas].join(', ')
  );
  voz.destruir();
}

{
  // Sólo voces de red disponibles: debe NEGARSE, no caer en ellas.
  const soloRed = VOCES_EQUIPO_REAL.filter((v) => !v.localService);
  const sintesis = crearSintesisFalsa({ voces: soloRed });
  let errorAvisado = null;
  const voz = crearVozSistema({
    sintesis,
    Locucion: LocucionFalsa,
    onError: (m) => (errorAvisado = m)
  });
  const r = await voz.iniciar();

  comprobar('con sólo voces de red, NO arranca', !r.ok, JSON.stringify(r));
  comprobar('el estado queda en error', voz.obtenerEstado() === ESTADO_VOZ_SISTEMA.ERROR);
  comprobar('avisa al usuario en vez de callarse', Boolean(errorAvisado));
  comprobar(
    'el motivo explica que enviaría el texto fuera',
    /fuera del equipo/.test(errorAvisado || ''),
    errorAvisado
  );

  const hablado = await voz.hablar('Esto no debería sonar.');
  comprobar('y no habla nada', !hablado.hablado && sintesis.estado.habladas.length === 0);
  voz.destruir();
}

{
  const sintesis = crearSintesisFalsa({ voces: [] });
  const voz = crearVozSistema({ sintesis, Locucion: LocucionFalsa });
  const r = await voz.iniciar();
  comprobar('sin ninguna voz instalada, tampoco arranca', !r.ok);
  voz.destruir();
}

bloque('COLA: nunca dos voces a la vez (el arreglo del commit 96b8633)');
{
  const sintesis = crearSintesisFalsa({ msPorCaracter: 2 });
  const voz = crearVozSistema({ sintesis, Locucion: LocucionFalsa });
  await voz.iniciar();

  const frases = ['Primera frase.', 'Segunda frase.', 'Tercera frase.'];
  const promesas = frases.map((f) => voz.hablar(f));

  comprobar('con una hablando, las demás esperan', voz.enCola() >= 1, `cola=${voz.enCola()}`);

  const res = await Promise.all(promesas);
  comprobar(
    'NUNCA hubo dos locuciones vivas a la vez',
    sintesis.estado.maxVivas === 1,
    `máximo simultáneo: ${sintesis.estado.maxVivas}`
  );
  comprobar('todas las promesas se resolvieron', res.length === 3);
  comprobar('la cola queda vacía al final', voz.enCola() === 0);
  comprobar('y el motor queda libre', !voz.estaHablando());
  voz.destruir();
}

{
  // Desbordar la cola: se descarta lo VIEJO y se avisa. Nunca en silencio.
  const sintesis = crearSintesisFalsa({ msPorCaracter: 5 });
  const voz = crearVozSistema({ sintesis, Locucion: LocucionFalsa });
  await voz.iniciar();

  const avisos = [];
  const warn = console.warn;
  console.warn = (...a) => avisos.push(a.join(' '));

  const promesas = [];
  for (let i = 1; i <= 6; i++) promesas.push(voz.hablar(`Frase número ${i}.`));
  const res = await Promise.all(promesas);
  console.warn = warn;

  comprobar(
    `la cola nunca pasó de ${VOZ_SISTEMA.MAX_EN_COLA}`,
    voz.enCola() <= VOZ_SISTEMA.MAX_EN_COLA
  );
  comprobar('ninguna promesa quedó colgada', res.length === 6);
  const descartadas = res.filter((r) => r.descartada).length;
  comprobar('hubo descartes (la cola estaba desbordada)', descartadas > 0, `${descartadas}`);
  comprobar(
    'CADA descarte se avisó por consola',
    avisos.filter((a) => /descartada/.test(a)).length === descartadas,
    `avisos=${avisos.filter((a) => /descartada/.test(a)).length}, descartes=${descartadas}`
  );
  comprobar(
    'y el aviso dice qué texto se perdió',
    avisos.some((a) => /Texto:/.test(a))
  );
  voz.destruir();
}

bloque('VIGILANTE: si `end` no llega nunca, no se bloquea el doblaje');
{
  const sintesis = crearSintesisFalsa({ nuncaTermina: true });
  let hablando = null;
  const voz = crearVozSistema({
    sintesis,
    Locucion: LocucionFalsa,
    onHablando: (v) => (hablando = v)
  });
  await voz.iniciar();

  const t0 = Date.now();
  const r = await voz.hablar('Frase corta.');
  const tardo = Date.now() - t0;

  comprobar('la promesa se resuelve igualmente', r !== undefined);
  comprobar('el motivo dice que fue el vigilante', /vigilante/.test(r.motivo || ''), r.motivo);
  comprobar(
    `no tardó más del mínimo del vigilante (${VOZ_SISTEMA.VIGILANTE_MINIMO_MS} ms)`,
    tardo < VOZ_SISTEMA.VIGILANTE_MINIMO_MS + 2000,
    `${tardo} ms`
  );
  comprobar('avisó de que ya no está hablando', hablando === false);
  comprobar('el hueco quedó libre', !voz.estaHablando());
  comprobar('canceló la locución colgada', sintesis.estado.cancelaciones > 0);

  // Y lo importante: después de eso, el doblaje sigue funcionando.
  const sintesis2 = crearSintesisFalsa();
  const voz2 = crearVozSistema({ sintesis: sintesis2, Locucion: LocucionFalsa });
  await voz2.iniciar();
  const r2 = await voz2.hablar('La siguiente sí suena.');
  comprobar('una frase posterior vuelve a sonar', r2.hablado === true);
  voz2.destruir();
  voz.destruir();
}

bloque('TROCEADO: se dice TODO, sólo que en partes');
{
  const corto = 'Una frase corta.';
  comprobar('un texto corto no se trocea', trocearParaHablar(corto).length === 1);

  const largo =
    'Esta es la primera oración de un párrafo bastante largo. ' +
    'Esta es la segunda oración, que también ocupa lo suyo. ' +
    '¿Y esta tercera, que es una pregunta? ' +
    'La cuarta cierra el asunto con unas cuantas palabras más de relleno. ' +
    'Y una quinta por si acaso no era suficiente con las anteriores.';

  const trozos = trocearParaHablar(largo);
  comprobar('un texto largo sí se trocea', trozos.length > 1, `${trozos.length} trozos`);
  comprobar(
    `ningún trozo pasa de ${VOZ_SISTEMA.MAX_CARACTERES_LOCUCION} caracteres`,
    trozos.every((t) => t.length <= VOZ_SISTEMA.MAX_CARACTERES_LOCUCION),
    trozos.map((t) => t.length).join(', ')
  );

  // LA COMPROBACIÓN IMPORTANTE: no se pierde ni una palabra.
  const palabrasAntes = largo.split(/\s+/).filter(Boolean);
  const palabrasDespues = trozos.join(' ').split(/\s+/).filter(Boolean);
  comprobar(
    'NO se pierde ni una palabra al trocear',
    palabrasAntes.length === palabrasDespues.length,
    `antes ${palabrasAntes.length}, después ${palabrasDespues.length}`
  );
  comprobar(
    'y van en el mismo orden',
    palabrasAntes.join(' ') === palabrasDespues.join(' ')
  );

  // Oración única larguísima, sin puntos: hay que partirla igual.
  const sinPuntos = 'palabra '.repeat(60).trim();
  const t2 = trocearParaHablar(sinPuntos);
  comprobar(
    'una oración sin puntos también se parte',
    t2.every((t) => t.length <= VOZ_SISTEMA.MAX_CARACTERES_LOCUCION),
    t2.map((t) => t.length).join(', ')
  );
  comprobar(
    'sin cortar ninguna palabra por la mitad',
    t2.join(' ').split(/\s+/).every((p) => p === 'palabra')
  );
  comprobar('texto vacío devuelve lista vacía', trocearParaHablar('   ').length === 0);
}

{
  // El troceado llega de verdad al motor: todo el texto se pronuncia.
  const sintesis = crearSintesisFalsa();
  const voz = crearVozSistema({ sintesis, Locucion: LocucionFalsa });
  await voz.iniciar();

  const largo =
    'Primera oración del texto que vamos a doblar ahora mismo. ' +
    'Segunda oración que continúa la idea anterior sin pausa. ' +
    'Tercera y última oración para cerrar este párrafo de prueba tan largo.';

  await voz.hablar(largo);
  const dicho = sintesis.estado.habladas.map((h) => h.texto).join(' ');
  comprobar(
    'se pronunciaron todas las palabras del texto largo',
    largo.split(/\s+/).length === dicho.split(/\s+/).length,
    `original ${largo.split(/\s+/).length}, dicho ${dicho.split(/\s+/).length}`
  );
  comprobar('aun troceado, hubo una sola locución viva a la vez', sintesis.estado.maxVivas === 1);
  voz.destruir();
}

bloque('VELOCIDAD: se pide 1, porque `rate` no funcionó al medirlo');
{
  const sintesis = crearSintesisFalsa();
  const voz = crearVozSistema({ sintesis, Locucion: LocucionFalsa });
  await voz.iniciar();
  await voz.hablar('Comprobando la velocidad.');
  comprobar(
    'la locución pide rate = 1',
    sintesis.estado.habladas[0].rate === 1,
    `rate=${sintesis.estado.habladas[0].rate}`
  );
  comprobar('y la constante lo refleja', VOZ_SISTEMA.VELOCIDAD === 1);
  voz.destruir();
}

bloque('DUCKING: baja, sube y vuelve siempre');
{
  const ganancia = { gain: { value: 1, setTargetAtTime(v) { this.value = v; }, cancelScheduledValues() {} } };
  const contexto = { currentTime: 0 };
  const ducking = crearDucking({ obtenerCadena: () => ({ contexto, ganancia }) });

  ducking.agachar();
  comprobar(`agacha el original a ${DUCKING.NIVEL * 100} %`, ganancia.gain.value === DUCKING.NIVEL);
  comprobar('y lo registra', ducking.estaAgachado());

  ducking.levantar();
  comprobar('lo devuelve a su volumen', ganancia.gain.value === 1);
  comprobar('y lo registra', !ducking.estaAgachado());
}

{
  // Respeta un volumen que el usuario hubiese bajado con setGain.
  const ganancia = { gain: { value: 0.5, setTargetAtTime(v) { this.value = v; }, cancelScheduledValues() {} } };
  const ducking = crearDucking({ obtenerCadena: () => ({ contexto: { currentTime: 0 }, ganancia }) });
  ducking.agachar();
  ducking.levantar();
  comprobar('restaura el volumen que había, no 100 %', ganancia.gain.value === 0.5, `${ganancia.gain.value}`);
}

{
  // Sin cadena de audio no revienta.
  const ducking = crearDucking({ obtenerCadena: () => null });
  let exploto = false;
  try {
    ducking.agachar();
    ducking.levantar();
    ducking.restaurarDeEmergencia();
  } catch (_) {
    exploto = true;
  }
  comprobar('sin captura activa no lanza ninguna excepción', !exploto);
}

{
  const ganancia = { gain: { value: 1, setTargetAtTime(v) { this.value = v; }, cancelScheduledValues() {} } };
  const ducking = crearDucking({ obtenerCadena: () => ({ contexto: { currentTime: 0 }, ganancia }) });
  ducking.agachar();
  ducking.restaurarDeEmergencia();
  comprobar('la restauración de emergencia devuelve el volumen', ganancia.gain.value === 1);
  comprobar('y limpia el estado', !ducking.estaAgachado());
}

bloque('FACHADA: elige motor y agacha el audio al hablar');
{
  const ganancia = { gain: { value: 1, setTargetAtTime(v) { this.value = v; }, cancelScheduledValues() {} } };
  const sintesis = crearSintesisFalsa({ msPorCaracter: 2 });

  const motor = crearMotorVoz({
    obtenerCadena: () => ({ contexto: { currentTime: 0 }, ganancia }),
    fabricas: {
      crearVozSistema: (op) => crearVozSistema({ ...op, sintesis, Locucion: LocucionFalsa })
    }
  });

  const r = await motor.iniciar();
  comprobar('elige la voz del sistema por defecto', r.motor === MOTOR_VOZ.SISTEMA, r.motor);

  const promesa = motor.doblar('Comprobando el ducking desde la fachada.');
  await esperar(10);
  comprobar('mientras habla, el audio original está agachado', ganancia.gain.value === DUCKING.NIVEL,
    `${ganancia.gain.value}`);

  await promesa;
  comprobar('al terminar, el audio original vuelve', ganancia.gain.value === 1, `${ganancia.gain.value}`);
  comprobar('y no queda nada en cola', motor.enCola() === 0);

  motor.destruir();
}

{
  // Si no hay voz local, la fachada cae sola a la reserva y lo dice.
  const sintesis = crearSintesisFalsa({ voces: [] });
  let aviso = null;
  let reservaArrancada = false;

  const motor = crearMotorVoz({
    obtenerCadena: () => null,
    onError: (m) => (aviso = m),
    fabricas: {
      crearVozSistema: (op) => crearVozSistema({ ...op, sintesis, Locucion: LocucionFalsa }),
      crearSintetizador: () => {
        reservaArrancada = true;
        return {
          iniciar: () => {},
          sintetizar: async () => ({ audio: null, motivo: 'falso' }),
          obtenerEstado: () => 'listo',
          destruir: () => {}
        };
      },
      crearReproductorDoblaje: () => ({
        reproducir: () => true,
        parar: () => {},
        silenciar: () => {},
        estaHablando: () => false,
        enCola: () => 0
      })
    }
  });

  const r = await motor.iniciar();
  comprobar('sin voz local, cae al motor de reserva', r.motor === MOTOR_VOZ.MMS, r.motor);
  comprobar('y arranca MMS-TTS de verdad', reservaArrancada);
  comprobar('avisando por qué, no en silencio', /No hay voz española/.test(aviso || ''), aviso);
  motor.destruir();
}

{
  // Silenciar corta de inmediato y devuelve el volumen.
  const ganancia = { gain: { value: 1, setTargetAtTime(v) { this.value = v; }, cancelScheduledValues() {} } };
  const sintesis = crearSintesisFalsa({ msPorCaracter: 10 });
  const motor = crearMotorVoz({
    obtenerCadena: () => ({ contexto: { currentTime: 0 }, ganancia }),
    fabricas: {
      crearVozSistema: (op) => crearVozSistema({ ...op, sintesis, Locucion: LocucionFalsa })
    }
  });
  await motor.iniciar();

  const p = motor.doblar('Una frase larga que vamos a cortar por la mitad sin contemplaciones.');
  await esperar(10);
  motor.silenciar(true);
  await p;

  comprobar('al apagar el doblaje, el volumen vuelve al instante', ganancia.gain.value === 1);
  comprobar('y deja de estar hablando', !motor.estaHablando());

  const r = await motor.doblar('Esto ya no debería sonar.');
  comprobar('con el doblaje apagado no se habla', !r.hablado, r.motivo);
  motor.destruir();
}

console.log(`\n==========================================================`);
console.log(`Resultado: ${pasadas} pasadas, ${fallidas} fallidas`);
console.log(`==========================================================`);
process.exit(fallidas === 0 ? 0 : 1);
