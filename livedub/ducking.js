// ducking.js
// Baja el volumen del audio ORIGINAL mientras habla la voz española, y lo
// devuelve a su sitio cuando termina.
//
// POR QUÉ ESTÁ EN SU PROPIO ARCHIVO (antes vivía dentro de
// reproductor-doblaje.js): ahora hay DOS motores de voz que necesitan agachar
// el audio y que no se parecen en nada.
//
//   · Voz del sistema (speechSynthesis): habla sola, por los altavoces, y no
//     pasa por nuestro AudioContext. Sólo nos avisa con eventos.
//   · MMS-TTS (motor de reserva): nos entrega muestras que reproducimos
//     nosotros en el AudioContext.
//
// Lo único que comparten es justo esto: agachar y levantar el original. Si se
// hubiese dejado dentro del reproductor, el motor del sistema tendría que
// arrastrar un reproductor que no usa sólo para bajar un volumen.
//
// Las rampas usan setTargetAtTime, igual que livedub.setGain(), para que el
// cambio se sienta suave y no como un corte.
//
// No toca chrome.* en absoluto: vive dentro del documento offscreen.

import { DUCKING } from './messages.js';

const LOG = '[LiveDub][ducking]';

/**
 * @param {object} opciones
 * @param {() => ({contexto: AudioContext, ganancia: GainNode}|null)} opciones.obtenerCadena
 *   Devuelve el AudioContext y el GainNode del audio ORIGINAL, o null si no
 *   hay captura. Se pasa como función, no como valor, porque la cadena se
 *   crea y se destruye con cada Iniciar/Detener.
 */
export function crearDucking({ obtenerCadena } = {}) {
  // Volumen del original ANTES de agachar, para poder restaurarlo tal cual y
  // no asumir que estaba al 100 % (el usuario pudo moverlo con setGain).
  let gananciaPrevia = null;
  let agachado = false;

  function agachar() {
    const cadena = obtenerCadena?.();
    if (!cadena?.contexto || !cadena?.ganancia) return false;

    const { contexto, ganancia } = cadena;
    if (gananciaPrevia === null) gananciaPrevia = ganancia.gain.value;
    ganancia.gain.setTargetAtTime(DUCKING.NIVEL, contexto.currentTime, DUCKING.RAMPA_S / 3);
    agachado = true;
    return true;
  }

  function levantar() {
    const cadena = obtenerCadena?.();

    // Si ya no hay cadena (se detuvo la captura), no hay nada que restaurar:
    // se limpia el recuerdo para que el próximo agachar() parta de cero.
    if (!cadena?.contexto || !cadena?.ganancia) {
      gananciaPrevia = null;
      agachado = false;
      return false;
    }

    const { contexto, ganancia } = cadena;
    const destino = gananciaPrevia === null ? 1 : gananciaPrevia;
    ganancia.gain.setTargetAtTime(destino, contexto.currentTime, DUCKING.RAMPA_S / 3);
    gananciaPrevia = null;
    agachado = false;
    return true;
  }

  /**
   * RED DE SEGURIDAD. Devuelve el volumen pase lo que pase, sin rampa.
   *
   * Existe por un riesgo concreto del motor del sistema: si el evento `end`
   * de una locución no llega nunca (está documentado que puede pasar), el
   * audio original se quedaría agachado para siempre y el usuario pensaría
   * que la extensión le ha roto el sonido. Esto es el último recurso.
   */
  function restaurarDeEmergencia() {
    const cadena = obtenerCadena?.();
    if (cadena?.contexto && cadena?.ganancia) {
      const destino = gananciaPrevia === null ? 1 : gananciaPrevia;
      try {
        cadena.ganancia.gain.cancelScheduledValues(cadena.contexto.currentTime);
        cadena.ganancia.gain.value = destino;
      } catch (error) {
        console.warn(`${LOG} no se pudo restaurar el volumen de golpe:`, error);
      }
    }
    gananciaPrevia = null;
    agachado = false;
  }

  return {
    agachar,
    levantar,
    restaurarDeEmergencia,
    estaAgachado: () => agachado,
    // Sólo para diagnóstico y pruebas.
    volumenRecordado: () => gananciaPrevia
  };
}
