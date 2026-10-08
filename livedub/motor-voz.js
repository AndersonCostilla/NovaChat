// motor-voz.js
// Fachada única del doblaje. Decide qué motor habla y le da al resto del
// programa una sola forma de pedir voz, sea cual sea el que esté activo.
//
// POR QUÉ EXISTE ESTE ARCHIVO
// Los dos motores no se parecen en nada por dentro:
//
//   · Voz del sistema → habla ella sola por los altavoces. No nos devuelve
//     audio: sólo eventos de inicio y fin.
//   · MMS-TTS         → nos devuelve un Float32Array que tenemos que
//     reproducir nosotros por el AudioContext.
//
// Sin esta capa, offscreen.js tendría que saber cuál está activo y tratar
// cada caso por separado en cada sitio. Con ella, offscreen.js llama a
// doblar(texto) y se desentiende.
//
// ELECCIÓN DEL MOTOR
// Se intenta SIEMPRE primero la voz del sistema. Si el equipo no tiene
// ninguna voz española local instalada, se cae automáticamente a MMS-TTS y
// se avisa por consola. El usuario no tiene que elegir nada, pero puede
// forzar un motor desde la consola con livedub.setMotorVoz('mms').
//
// MMS-TTS NO SE BORRA. Es el único recurso para quien no tenga voz española
// en su Windows. Queda como reserva, no como opción recomendada.

import { MOTOR_VOZ } from './messages.js';
import { crearVozSistema } from './voz-sistema.js';
import { crearSintetizador } from './sintetizador.js';
import { crearReproductorDoblaje } from './reproductor-doblaje.js';
import { crearDucking } from './ducking.js';

const LOG = '[LiveDub][motor-voz]';

/**
 * @param {object} opciones
 * @param {() => ({contexto: AudioContext, ganancia: GainNode}|null)} opciones.obtenerCadena
 * @param {(info: object) => void} [opciones.onEstado]      estado para la UI
 * @param {(hablando: boolean) => void} [opciones.onHablando]
 * @param {(mensaje: string) => void} [opciones.onError]
 * @param {object} [opciones.rutas] {rutaModelos, rutaWasm, modelo} para MMS
 * @param {string} [opciones.motorPedido] fuerza un motor concreto
 * @param {object} [opciones.fabricas] inyección para las pruebas
 */
export function crearMotorVoz({
  obtenerCadena,
  onEstado,
  onHablando,
  onError,
  rutas = {},
  motorPedido = null,
  fabricas = {}
} = {}) {
  const hacerVozSistema = fabricas.crearVozSistema || crearVozSistema;
  const hacerSintetizador = fabricas.crearSintetizador || crearSintetizador;
  const hacerReproductor = fabricas.crearReproductorDoblaje || crearReproductorDoblaje;
  const hacerDucking = fabricas.crearDucking || crearDucking;

  // El ducking es COMÚN a los dos motores: lo único que comparten.
  const ducking = hacerDucking({ obtenerCadena });

  let motorActivo = null;
  let vozSistema = null;
  let sintetizador = null;
  let reproductor = null;
  let silenciado = false;
  let hablando = false;

  // Una sola función de "está sonando o no" para los dos motores. Aquí es
  // donde se agacha y se levanta el audio original, en un único sitio, para
  // que no pueda quedar descuadrado según quién hable.
  function marcarHablando(valor) {
    const nuevo = Boolean(valor);
    if (nuevo === hablando) return;
    hablando = nuevo;

    if (hablando) ducking.agachar();
    else ducking.levantar();

    onHablando?.(hablando);
  }

  // ─── Arranque ────────────────────────────────────────────────────────

  async function iniciar() {
    const preferido = motorPedido || MOTOR_VOZ.SISTEMA;

    if (preferido === MOTOR_VOZ.SISTEMA) {
      vozSistema = hacerVozSistema({
        onEstado: (info) => onEstado?.({ ...info, motor: MOTOR_VOZ.SISTEMA }),
        onHablando: marcarHablando,
        onError
      });

      const resultado = await vozSistema.iniciar();
      if (resultado.ok) {
        motorActivo = MOTOR_VOZ.SISTEMA;
        console.log(`${LOG} motor activo: voz del sistema (${resultado.voz}).`);
        return { ok: true, motor: motorActivo, detalle: resultado };
      }

      // Caída automática a la reserva. Se dice por qué, en voz alta: que el
      // doblaje cambie de motor sin explicación sería un fallo silencioso.
      console.warn(
        `${LOG} la voz del sistema no está disponible (${resultado.motivo}). ` +
          'Se pasa al motor de reserva MMS-TTS, que es bastante más lento.'
      );
      onError?.(
        'No hay voz española instalada en Windows. Se usa el motor de reserva, más lento. ' +
          (resultado.detalle || '')
      );
      vozSistema.destruir();
      vozSistema = null;
    }

    return iniciarReserva();
  }

  function iniciarReserva() {
    motorActivo = MOTOR_VOZ.MMS;

    // El reproductor sólo hace falta con MMS-TTS: es quien convierte las
    // muestras en sonido. La voz del sistema no pasa por aquí.
    reproductor = hacerReproductor({
      ducking,
      onHablando: marcarHablando
    });
    reproductor.silenciar(silenciado);

    sintetizador = hacerSintetizador({
      onEstado: (info) => onEstado?.({ ...info, motor: MOTOR_VOZ.MMS }),
      onError
    });
    sintetizador.iniciar(rutas);

    console.log(`${LOG} motor activo: MMS-TTS (reserva).`);
    return { ok: true, motor: motorActivo, reserva: true };
  }

  // ─── Doblar ──────────────────────────────────────────────────────────

  /**
   * Dobla una frase. Resuelve cuando ha terminado de sonar.
   * Nunca lanza: si no se puede doblar, devuelve el motivo para que quede
   * dicho por consola en vez de desaparecer en silencio.
   */
  async function doblar(texto, { segundosOrigen = null } = {}) {
    if (silenciado) return { hablado: false, motivo: 'doblaje desactivado' };

    if (motorActivo === MOTOR_VOZ.SISTEMA && vozSistema) {
      return vozSistema.hablar(texto, { segundosOrigen });
    }

    if (motorActivo === MOTOR_VOZ.MMS && sintetizador) {
      const resultado = await sintetizador.sintetizar(texto, { segundosOrigen });
      if (!resultado.audio) return { hablado: false, motivo: resultado.motivo || 'sin audio' };
      const sonando = reproductor?.reproducir(resultado.audio, resultado.hz);
      return { hablado: Boolean(sonando), motivo: sonando ? null : 'el reproductor lo rechazó' };
    }

    return { hablado: false, motivo: 'no hay motor de voz iniciado' };
  }

  function parar() {
    vozSistema?.parar();
    reproductor?.parar();
    // Pase lo que pase con los motores, el volumen original vuelve. Es la
    // última línea de defensa contra dejar al usuario con el audio bajo.
    ducking.restaurarDeEmergencia();
    hablando = false;
    onHablando?.(false);
  }

  function silenciar(valor) {
    silenciado = Boolean(valor);
    vozSistema?.silenciar(silenciado);
    reproductor?.silenciar(silenciado);
    if (silenciado) {
      ducking.restaurarDeEmergencia();
      hablando = false;
      onHablando?.(false);
    }
  }

  function destruir() {
    parar();
    vozSistema?.destruir();
    sintetizador?.destruir();
    vozSistema = null;
    sintetizador = null;
    reproductor = null;
    motorActivo = null;
  }

  // ─── Diagnóstico ─────────────────────────────────────────────────────

  function informe() {
    const base = {
      'motor activo': motorActivo === MOTOR_VOZ.SISTEMA
        ? 'voz del sistema (speechSynthesis)'
        : motorActivo === MOTOR_VOZ.MMS
          ? 'MMS-TTS (reserva, lento)'
          : 'ninguno',
      'doblaje silenciado': silenciado ? 'sí' : 'no',
      'hablando ahora': hablando ? 'sí' : 'no',
      'audio original agachado': ducking.estaAgachado() ? 'sí' : 'no',
      'frases en cola': enCola()
    };

    if (motorActivo === MOTOR_VOZ.SISTEMA && vozSistema) {
      base['voz elegida'] = vozSistema.vozActual();
      base['estado'] = vozSistema.obtenerEstado();
      base['rendimiento'] = vozSistema.rendimiento();
    } else if (sintetizador) {
      base['estado'] = sintetizador.obtenerEstado();
    }
    return base;
  }

  function enCola() {
    if (motorActivo === MOTOR_VOZ.SISTEMA) return vozSistema?.enCola() ?? 0;
    return reproductor?.enCola() ?? 0;
  }

  return {
    iniciar,
    doblar,
    parar,
    silenciar,
    destruir,
    informe,
    enCola,
    motorActivo: () => motorActivo,
    estaHablando: () => hablando,
    obtenerEstado: () =>
      (motorActivo === MOTOR_VOZ.SISTEMA ? vozSistema?.obtenerEstado() : sintetizador?.obtenerEstado()) ??
      'inactivo',
    // Acceso directo para los comandos de consola que ya existían.
    vozSistema: () => vozSistema,
    sintetizador: () => sintetizador,
    reproductor: () => reproductor,
    ducking: () => ducking
  };
}
