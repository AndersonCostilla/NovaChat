// rendimiento-voz.js
// BANCO DE MEDICIÓN de la síntesis de voz (Fase 5.1).
//
// POR QUÉ EXISTE
// La primera prueba en Chrome real reveló que el doblaje no estaba roto: iba
// lento. Pero para saberlo hubo que pegar decenas de líneas de log y hacer las
// divisiones a mano. Este módulo hace esa aritmética sola y, sobre todo, toma
// UNA decisión con ella: si el equipo no da abasto, lo dice una vez y se
// detiene, en vez de leer unas frases sí y otras no de forma impredecible.
//
// LA MÉTRICA BUENA
// No es "x veces tiempo real" (que depende de lo larga que sea la frase), sino
// MILISEGUNDOS POR SEGUNDO DE AUDIO GENERADO. Esa cifra es estable y
// comparable entre frases cortas y largas:
//
//   1000 ms/s = justo en tiempo real
//    500 ms/s = el doble de rápido que la voz que produce (holgado)
//   2000 ms/s = la mitad de rápido (imposible seguir el vídeo)
//
// LA SEGUNDA MÉTRICA
// La EXPANSIÓN: cuánto dura el doblaje comparado con el fragmento original.
// Si es > 1, el doblaje se retrasa aunque la síntesis fuese instantánea,
// porque hay más audio que reproducir que hueco donde meterlo.
//
// No importa nada de chrome.*, ni del DOM, ni de audio: es aritmética pura,
// para poder probarlo con Node.

import { VOZ } from './messages.js';

export const VEREDICTO = {
  MIDIENDO: 'midiendo', // aún no hay muestras suficientes
  APTO: 'apto', // el equipo genera voz más rápido de lo que dura
  JUSTO: 'justo', // alcanza, pero sin margen
  INSUFICIENTE: 'insuficiente' // no alcanza; hay que apagar el doblaje
};

const MAX_MUESTRAS = 12; // ventana deslizante: lo reciente manda

/**
 * Crea un banco de medición.
 * @param {object} [opciones]
 * @param {(info: object) => void} [opciones.onVeredicto] se llama UNA sola vez
 *   por cada cambio de veredicto, no en cada frase.
 */
export function crearBancoVoz({ onVeredicto } = {}) {
  /** @type {Array<{id:number,caracteres:number,msSintesis:number,segundosAudio:number,segundosOrigen:number|null}>} */
  const muestras = [];
  let veredicto = VEREDICTO.MIDIENDO;
  let descartadasSinIntentar = 0;
  let descartadasPorTiempo = 0;

  /* ----------------------- Registrar una medida ------------------- */

  /**
   * Anota una síntesis ya completada.
   * @returns {{msPorSegundo:number, rtf:number, expansion:number|null}}
   */
  function registrar({ id, caracteres, msSintesis, segundosAudio, segundosOrigen = null }) {
    const audio = Number(segundosAudio) || 0;
    const ms = Number(msSintesis) || 0;

    // Una frase sin audio no dice nada del rendimiento: no contamina la media.
    if (audio > 0 && ms > 0) {
      muestras.push({
        id,
        caracteres: Number(caracteres) || 0,
        msSintesis: ms,
        segundosAudio: audio,
        segundosOrigen: segundosOrigen === null ? null : Number(segundosOrigen) || 0
      });
      while (muestras.length > MAX_MUESTRAS) muestras.shift();
      revisarVeredicto();
    }

    return {
      msPorSegundo: audio > 0 ? Math.round(ms / audio) : 0,
      rtf: ms > 0 ? audio / (ms / 1000) : 0,
      expansion: segundosOrigen > 0 ? audio / segundosOrigen : null
    };
  }

  function anotarDescarte(motivo) {
    if (motivo === 'sin-intentar') descartadasSinIntentar++;
    else descartadasPorTiempo++;
  }

  /* --------------------------- Promedios -------------------------- */

  // Mediana, no media: una frase que coincidió con un pico de CPU no debe
  // condenar al equipo entero.
  function medianaMsPorSegundo() {
    if (muestras.length === 0) return null;
    const valores = muestras.map((m) => m.msSintesis / m.segundosAudio).sort((a, b) => a - b);
    const medio = Math.floor(valores.length / 2);
    const v = valores.length % 2 ? valores[medio] : (valores[medio - 1] + valores[medio]) / 2;
    return Math.round(v);
  }

  function expansionMedia() {
    const conOrigen = muestras.filter((m) => m.segundosOrigen > 0);
    if (conOrigen.length === 0) return null;
    const suma = conOrigen.reduce((n, m) => n + m.segundosAudio / m.segundosOrigen, 0);
    return Number((suma / conOrigen.length).toFixed(2));
  }

  // Cuántos ms cuesta cada carácter de texto. Es lo que permite decidir ANTES
  // de sintetizar si una frase cabe en el presupuesto.
  function msPorCaracter() {
    const utiles = muestras.filter((m) => m.caracteres > 0);
    if (utiles.length === 0) return null;
    const suma = utiles.reduce((n, m) => n + m.msSintesis / m.caracteres, 0);
    return suma / utiles.length;
  }

  /* --------------------------- Veredicto -------------------------- */

  function revisarVeredicto() {
    const anterior = veredicto;
    const msPorSegundo = medianaMsPorSegundo();

    if (muestras.length < VOZ.MUESTRAS_PARA_VEREDICTO || msPorSegundo === null) {
      veredicto = VEREDICTO.MIDIENDO;
    } else if (msPorSegundo <= VOZ.MS_POR_SEGUNDO_LIMITE) {
      veredicto = VEREDICTO.APTO;
    } else if (msPorSegundo <= VOZ.MS_POR_SEGUNDO_OBJETIVO) {
      veredicto = VEREDICTO.JUSTO;
    } else {
      veredicto = VEREDICTO.INSUFICIENTE;
    }

    // Sólo se avisa en los cambios: nada de un mensaje por frase.
    if (veredicto !== anterior) onVeredicto?.(resumen());
  }

  /* ------------------- Decisión previa a sintetizar --------------- */

  /**
   * ¿Merece la pena intentar esta frase? Se responde ANTES de gastar la CPU.
   *
   * Antes el código lanzaba la síntesis, esperaba 30 s y la tiraba. Treinta
   * segundos de un único hilo que además necesitan Whisper y el traductor.
   *
   * @returns {{adelante: boolean, motivo: string, msEstimados: number|null}}
   */
  function evaluarAntesDeSintetizar({ caracteres, segundosOrigen = null }) {
    const letras = Number(caracteres) || 0;
    if (letras === 0) return { adelante: false, motivo: 'texto vacío', msEstimados: 0 };

    if (veredicto === VEREDICTO.INSUFICIENTE) {
      return {
        adelante: false,
        motivo: `este equipo no genera voz a tiempo (medido: ${medianaMsPorSegundo()} ms por segundo de voz)`,
        msEstimados: null
      };
    }

    const porCaracter = msPorCaracter();
    if (porCaracter === null) {
      // Sin medidas propias todavía: se intenta. Hace falta una primera vez
      // para poder medir algo.
      return { adelante: true, motivo: 'aún sin mediciones', msEstimados: null };
    }

    const msEstimados = Math.round(letras * porCaracter);

    // Presupuesto: lo que dure el fragmento original (otra frase llegará más o
    // menos en ese tiempo), con un suelo y un techo razonables.
    const presupuesto = Math.min(
      VOZ.PRESUPUESTO_MS,
      Math.max(4000, (Number(segundosOrigen) || 0) * 1000 * 1.5)
    );

    if (msEstimados > presupuesto) {
      return {
        adelante: false,
        motivo: `demasiado larga: ~${(msEstimados / 1000).toFixed(1)} s de síntesis para un presupuesto de ${(
          presupuesto / 1000
        ).toFixed(1)} s`,
        msEstimados
      };
    }

    return { adelante: true, motivo: 'cabe en el presupuesto', msEstimados };
  }

  /* ---------------------------- Informe --------------------------- */

  function resumen() {
    const msPorSegundo = medianaMsPorSegundo();
    return {
      veredicto,
      muestras: muestras.length,
      msPorSegundoAudio: msPorSegundo,
      vecesTiempoReal: msPorSegundo ? Number((1000 / msPorSegundo).toFixed(2)) : null,
      expansionMedia: expansionMedia(),
      descartadasSinIntentar,
      descartadasPorTiempo,
      motor: VOZ.USAR_CUANTIZADO ? 'cuantizado (int8, 38 MB)' : 'completo (float32, 114 MB)',
      velocidadReproduccion: VOZ.VELOCIDAD
    };
  }

  // Texto para la interfaz y para la consola. Sin tecnicismos y sin mentir.
  function explicacion() {
    const r = resumen();
    if (r.muestras === 0) return 'Todavía no se ha generado ninguna frase de voz.';

    const base =
      `Medido en ${r.muestras} frase(s): ${r.msPorSegundoAudio} ms de cálculo por cada ` +
      `segundo de voz (${r.vecesTiempoReal}× tiempo real)` +
      (r.expansionMedia ? `, y el doblaje dura ${r.expansionMedia}× lo que el original.` : '.');

    switch (r.veredicto) {
      case VEREDICTO.APTO:
        return `${base} Tu equipo va sobrado para el doblaje.`;
      case VEREDICTO.JUSTO:
        return `${base} Tu equipo llega justo: puede haber frases sueltas sin doblar.`;
      case VEREDICTO.INSUFICIENTE:
        return (
          `${base} Tu equipo no da abasto para el doblaje en tiempo real, así que se ha ` +
          'desactivado solo. No está roto y los subtítulos siguen funcionando igual de bien.'
        );
      default:
        return `${base} Aún midiendo.`;
    }
  }

  function reiniciar() {
    muestras.length = 0;
    descartadasSinIntentar = 0;
    descartadasPorTiempo = 0;
    veredicto = VEREDICTO.MIDIENDO;
  }

  return {
    registrar,
    anotarDescarte,
    evaluarAntesDeSintetizar,
    resumen,
    explicacion,
    reiniciar,
    obtenerVeredicto: () => veredicto,
    detalle: () => muestras.slice()
  };
}
