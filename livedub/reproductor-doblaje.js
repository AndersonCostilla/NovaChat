// reproductor-doblaje.js
// Reproduce la voz doblada y hace el DUCKING del audio original (Fase 5).
//
// QUÉ ES EL DUCKING
// Mientras suena la voz en español, el audio original del vídeo baja a un ~18 %
// y vuelve a subir cuando el doblaje termina. Se oyen los dos sin pisarse.
//
// Las rampas usan setTargetAtTime, igual que livedub.setGain(), para que el
// cambio de volumen se sienta suave y no como un corte.
//
// Este módulo NO sintetiza nada: recibe una onda ya generada. Y no toca
// chrome.* en absoluto: vive dentro del documento offscreen.

import { DUCKING, VOZ } from './messages.js';

const LOG = '[LiveDub][doblaje]';

// Fase 5.1. Velocidad de reproducción del doblaje. Es un ajuste vivo: se puede
// cambiar desde la consola con livedub.setVelocidadVoz(1.1) para juzgar de
// oído, porque acelerar sube también el tono.
let velocidad = VOZ.VELOCIDAD;

export function fijarVelocidadDoblaje(valor) {
  const v = Number(valor);
  if (!Number.isFinite(v)) return velocidad;
  velocidad = Math.min(VOZ.VELOCIDAD_MAX, Math.max(VOZ.VELOCIDAD_MIN, v));
  return velocidad;
}

export function obtenerVelocidadDoblaje() {
  return velocidad;
}

/**
 * @param {object} opciones
 * @param {() => ({contexto: AudioContext, ganancia: GainNode})|null} opciones.obtenerCadena
 *   Devuelve el AudioContext y el GainNode del audio ORIGINAL, o null si no hay
 *   captura. Se pasa como función porque la cadena se crea y se destruye con
 *   cada Iniciar/Detener.
 * @param {(hablando: boolean) => void} [opciones.onHablando]
 */
export function crearReproductorDoblaje({ obtenerCadena, onHablando } = {}) {
  // Cola de reproducción: las frases se oyen de una en una y en orden. Sin
  // esto, dos doblajes solapados serían ininteligibles.
  const cola = [];
  let reproduciendo = false;
  let fuenteActual = null;
  let silenciado = false;

  // Volumen del original ANTES de agachar, para poder restaurarlo tal cual.
  let gananciaPrevia = null;

  function agachar(ganancia, contexto) {
    if (gananciaPrevia === null) gananciaPrevia = ganancia.gain.value;
    ganancia.gain.setTargetAtTime(DUCKING.NIVEL, contexto.currentTime, DUCKING.RAMPA_S / 3);
  }

  function levantar(ganancia, contexto) {
    const destino = gananciaPrevia === null ? 1 : gananciaPrevia;
    ganancia.gain.setTargetAtTime(destino, contexto.currentTime, DUCKING.RAMPA_S / 3);
    gananciaPrevia = null;
  }

  /**
   * Encola una onda para reproducirla.
   * @param {Float32Array} audio
   * @param {number} hz frecuencia de muestreo con la que se generó
   */
  function reproducir(audio, hz) {
    if (silenciado) return false;
    if (!audio || !audio.length) return false;

    cola.push({ audio, hz: hz || 16000 });

    // Si el doblaje se acumula, nos quedamos con lo más reciente: una voz que
    // va diez frases por detrás del vídeo no sirve de nada.
    while (cola.length > 2) {
      cola.shift();
      console.warn(`${LOG} descartada una frase de doblaje: iba demasiado retrasada.`);
    }

    siguiente();
    return true;
  }

  function siguiente() {
    if (reproduciendo) return;

    const tarea = cola.shift();
    if (!tarea) return;

    const cadena = obtenerCadena?.();
    if (!cadena?.contexto || !cadena?.ganancia) {
      console.warn(`${LOG} no hay captura activa: no se reproduce el doblaje.`);
      return;
    }

    const { contexto, ganancia } = cadena;

    let buffer;
    try {
      // El modelo genera a 16 kHz y el contexto suele ir a 48 kHz: se declara
      // la frecuencia real y el navegador remuestrea al reproducir.
      buffer = contexto.createBuffer(1, tarea.audio.length, tarea.hz);
      buffer.getChannelData(0).set(tarea.audio);
    } catch (error) {
      console.error(`${LOG} no se pudo crear el búfer de audio:`, error);
      siguiente();
      return;
    }

    const fuente = contexto.createBufferSource();
    fuente.buffer = buffer;
    // POR QUÉ SE ACELERA: el doblaje en español dura más que el fragmento
    // original que sustituye (más sílabas + voz pausada), así que se retrasaría
    // aunque la síntesis fuese instantánea. Acelerar la reproducción recupera
    // ese tiempo sin gastar CPU. El precio es que el tono sube un poco.
    fuente.playbackRate.value = velocidad;
    fuente.connect(contexto.destination);

    reproduciendo = true;
    fuenteActual = fuente;
    agachar(ganancia, contexto);
    onHablando?.(true);

    const segundos = tarea.audio.length / tarea.hz;
    const oidos = (segundos / velocidad).toFixed(2);
    console.log(
      `${LOG} reproduciendo ${segundos.toFixed(2)} s de doblaje en ${oidos} s ` +
        `(velocidad x${velocidad}, original al ${DUCKING.NIVEL * 100} %)`
    );

    fuente.onended = () => {
      fuente.disconnect();
      reproduciendo = false;
      fuenteActual = null;

      if (cola.length > 0) {
        // Encadenamos sin levantar el volumen: evita el efecto "bombeo" de
        // subir y bajar entre dos frases seguidas.
        siguiente();
        return;
      }

      levantar(ganancia, contexto);
      onHablando?.(false);
    };

    fuente.start();
  }

  /** Corta el doblaje en curso y restaura el volumen original de inmediato. */
  function parar() {
    cola.length = 0;

    if (fuenteActual) {
      try {
        fuenteActual.onended = null;
        fuenteActual.stop();
        fuenteActual.disconnect();
      } catch (_) {
        /* ya había terminado por su cuenta */
      }
      fuenteActual = null;
    }

    reproduciendo = false;

    const cadena = obtenerCadena?.();
    if (cadena?.contexto && cadena?.ganancia) levantar(cadena.ganancia, cadena.contexto);
    else gananciaPrevia = null;

    onHablando?.(false);
  }

  /** Activa o desactiva el doblaje. Al desactivar, corta lo que esté sonando. */
  function silenciar(valor) {
    silenciado = Boolean(valor);
    if (silenciado) parar();
  }

  return {
    reproducir,
    parar,
    silenciar,
    estaHablando: () => reproduciendo,
    enCola: () => cola.length
  };
}
