// reproductor-doblaje.js
// Reproduce por el AudioContext las muestras que genera MMS-TTS.
//
// OJO — ESTE ARCHIVO YA NO SE USA EN EL CAMINO NORMAL
// Desde que el motor por defecto es la voz del sistema (ver voz-sistema.js),
// esto sólo entra en juego con el MOTOR DE RESERVA. La voz de Windows habla
// sola por los altavoces y no nos entrega muestras que reproducir, así que no
// pasa por aquí en absoluto.
//
// Se conserva porque MMS-TTS es el único recurso para quien no tenga una voz
// española instalada en su sistema, y sin este módulo ese motor no suena.
//
// QUÉ SE LE QUITÓ
// El ducking se mudó a ducking.js, porque lo necesitan LOS DOS motores y
// sólo uno de ellos necesita reproducir muestras. Aquí ya no se toca ningún
// GainNode: se avisa de cuándo se empieza y se termina de hablar, y de
// agachar el audio original se encarga quien corresponda.
//
// Este módulo NO sintetiza nada: recibe una onda ya generada. Y no toca
// chrome.* en absoluto: vive dentro del documento offscreen.

import { VOZ } from './messages.js';

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
 * @param {{agachar: Function, levantar: Function, obtenerCadena?: Function}} opciones.ducking
 *   Módulo de ducking compartido (ducking.js). Sólo se usa para localizar el
 *   AudioContext por el que reproducir; agachar y levantar lo decide la capa
 *   de arriba, que es la que sabe si hay otra frase encadenada detrás.
 * @param {() => ({contexto: AudioContext, ganancia: GainNode}|null)} [opciones.obtenerCadena]
 * @param {(hablando: boolean) => void} [opciones.onHablando]
 */
export function crearReproductorDoblaje({ ducking, obtenerCadena, onHablando } = {}) {
  // La cadena de audio se puede recibir directa o a través del ducking.
  const cadenaDe = obtenerCadena || ducking?.obtenerCadena || (() => null);
  // Cola de reproducción: las frases se oyen de una en una y en orden. Sin
  // esto, dos doblajes solapados serían ininteligibles.
  const cola = [];
  let reproduciendo = false;
  let fuenteActual = null;
  let silenciado = false;

  /**
   * Encola una onda para reproducirla.
   * @param {Float32Array} audio
   * @param {number} hz frecuencia de muestreo con la que se generó
   */
  function reproducir(audio, hz, { onEmpiezaAHablar = null } = {}) {
    if (silenciado) return false;
    if (!audio || !audio.length) return false;

    cola.push({ audio, hz: hz || 16000, onEmpiezaAHablar });

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

    const cadena = cadenaDe();
    if (!cadena?.contexto) {
      console.warn(`${LOG} no hay captura activa: no se reproduce el doblaje.`);
      // El hueco se libera igualmente: si no, la cola se quedaría bloqueada.
      onHablando?.(false);
      return;
    }

    const { contexto } = cadena;

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
    onHablando?.(true);
    // Momento exacto en que empieza a oírse, igual que en voz-sistema.js.
    try {
      tarea.onEmpiezaAHablar?.();
    } catch (error) {
      console.warn(`${LOG} el aviso de inicio de voz falló:`, error);
    }

    const segundos = tarea.audio.length / tarea.hz;
    const oidos = (segundos / velocidad).toFixed(2);
    console.log(
      `${LOG} reproduciendo ${segundos.toFixed(2)} s de doblaje en ${oidos} s ` +
        `(velocidad x${velocidad}, motor de reserva MMS-TTS)`
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
