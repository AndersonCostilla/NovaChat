// voz-sistema.js
// Motor de voz POR DEFECTO: la voz española instalada en Windows, usada a
// través de speechSynthesis desde el documento offscreen.
//
// POR QUÉ ESTE MOTOR Y NO MMS-TTS
// MMS-TTS tardaba ~2.000 ms en generar cada segundo de voz en el equipo de
// referencia (i5-12400): el doblaje se retrasaba sin límite hasta que había
// que tirarlo. La voz del sistema la sintetiza Windows, fuera de nuestro
// proceso, con un coste de CPU prácticamente nulo. Medido el 7-oct-2026:
// 189 caracteres en 10,97 s de audio, idéntico con y sin conexión de red.
//
// COMPROBADO ANTES DE ESCRIBIR ESTO (paso 0.5, 8-oct-2026, Chrome real):
//   · speechSynthesis existe dentro del documento offscreen.
//   · Ve las voces del sistema (21 en total, 2 españolas locales).
//   · HABLA sin que haya habido ningún clic del usuario: la política de
//     reproducción automática no lo bloquea aquí.
//   · Dispara `start` y también `end` (9,37 s en la prueba).
// Por eso NO hace falta el permiso "tts" ni el service worker.
//
// PRIVACIDAD — LA REGLA MÁS IMPORTANTE DE ESTE ARCHIVO
// Chrome ofrece también voces de red ("Google español", localService:false).
// Usar una de ésas enviaría el texto traducido a servidores de Google, que es
// exactamente lo que este proyecto promete no hacer. Aquí se filtra por
// `localService === true` SIEMPRE, y si no queda ninguna voz local el motor
// se declara no disponible en vez de caer en una remota. No se delega esa
// elección en el navegador en ningún caso.

import { VOZ_SISTEMA } from './messages.js';

const LOG = '[LiveDub][voz-sistema]';

export const ESTADO_VOZ_SISTEMA = {
  INACTIVO: 'inactivo',
  CARGANDO: 'cargando',
  LISTO: 'listo',
  ERROR: 'error'
};

/**
 * Trocea el texto en fragmentos que una sola locución pueda decir sin riesgo.
 *
 * POR QUÉ: está documentado que Chrome corta las locuciones largas (el caso
 * típico son ~15 s con voces remotas, pero también hay informes con locales).
 * Partir por oraciones es gratis y elimina el riesgo. Se corta por puntuación
 * para que las pausas caigan donde caerían de todos modos.
 *
 * Si una sola oración ya pasa del límite, se parte por comas, y si aún así no
 * cabe, por palabras. Nunca se descarta texto: trocear no es resumir.
 */
export function trocearParaHablar(texto, limite = VOZ_SISTEMA.MAX_CARACTERES_LOCUCION) {
  const limpio = String(texto || '').trim();
  if (!limpio) return [];
  if (limpio.length <= limite) return [limpio];

  // Separadores por orden de preferencia: fin de oración, luego pausa débil.
  const porOraciones = limpio.match(/[^.!?…]+[.!?…]+[\s]*|[^.!?…]+$/g) || [limpio];

  const trozos = [];
  let actual = '';

  const empujar = () => {
    const t = actual.trim();
    if (t) trozos.push(t);
    actual = '';
  };

  for (const oracion of porOraciones) {
    if (oracion.length > limite) {
      empujar();
      // Oración larguísima: se parte por comas y, en último extremo, por
      // palabras. Partir por caracteres sueltos nunca: cortaría a media
      // palabra y la voz leería algo que no es.
      let resto = oracion.trim();
      while (resto.length > limite) {
        let corte = resto.lastIndexOf(',', limite);
        if (corte < limite * 0.4) corte = resto.lastIndexOf(' ', limite);
        if (corte <= 0) corte = limite;
        trozos.push(resto.slice(0, corte + 1).trim());
        resto = resto.slice(corte + 1).trim();
      }
      if (resto) actual = resto;
      continue;
    }

    if ((actual + oracion).length > limite) empujar();
    actual += oracion;
  }

  empujar();
  return trozos.filter(Boolean);
}

/**
 * @param {object} opciones
 * @param {(info: object) => void} [opciones.onEstado]
 * @param {(hablando: boolean) => void} [opciones.onHablando]
 * @param {(mensaje: string) => void} [opciones.onError]
 * @param {(info: object) => void} [opciones.onMedicion]
 * @param {object} [opciones.sintesis] Inyectable para las pruebas. Por defecto
 *   el speechSynthesis real.
 * @param {Function} [opciones.Locucion] Idem con SpeechSynthesisUtterance.
 */
export function crearVozSistema({
  onEstado,
  onHablando,
  onError,
  onMedicion,
  sintesis = typeof speechSynthesis !== 'undefined' ? speechSynthesis : null,
  Locucion = typeof SpeechSynthesisUtterance !== 'undefined' ? SpeechSynthesisUtterance : null
} = {}) {
  let estado = ESTADO_VOZ_SISTEMA.INACTIVO;
  let voz = null;
  let silenciado = false;
  let destruido = false;

  // ─── Cola ────────────────────────────────────────────────────────────
  // MISMA DISCIPLINA QUE EL TRADUCTOR Y EL SINTETIZADOR (ver el arreglo de
  // colas del commit 96b8633): una sola locución viva, identificada por id.
  // Nada declara libre el motor salvo liberarSi(), y sólo si el id coincide.
  // Sin esto, dos frases que llegasen juntas hablarían encima la una de la
  // otra y el resultado sería ininteligible.
  const cola = [];
  let siguienteId = 1;
  let idEnVuelo = null;
  let locucionActual = null;
  let vigilante = null;
  let pendiente = null; // { id, resolver, texto, trozos, indice, t0, hablo }

  const mediciones = [];

  function fijarEstado(nuevo, detalle = '') {
    if (estado === nuevo) return;
    estado = nuevo;
    console.log(`${LOG} estado: ${estado}`, detalle || '');
    onEstado?.({ estado, detalle });
  }

  // ─── Localizar la voz ────────────────────────────────────────────────

  /** Devuelve TODAS las voces del idioma pedido, marcando cuáles son locales. */
  function inventario() {
    const todas = sintesis?.getVoices?.() || [];
    return todas
      .filter((v) => new RegExp(`^${VOZ_SISTEMA.IDIOMA}`, 'i').test(v.lang || ''))
      .map((v) => ({ nombre: v.name, idioma: v.lang, local: v.localService === true, ref: v }));
  }

  /**
   * Elige la voz. SÓLO locales: ver el bloque de privacidad de la cabecera.
   * Si el usuario fijó un nombre concreto y ése es local, gana.
   */
  function elegirVoz() {
    const locales = inventario().filter((v) => v.local);
    if (!locales.length) return null;

    if (VOZ_SISTEMA.NOMBRE_PREFERIDO) {
      const elegida = locales.find((v) => v.nombre === VOZ_SISTEMA.NOMBRE_PREFERIDO);
      if (elegida) return elegida;
    }
    return locales[0];
  }

  /**
   * getVoices() devuelve una lista vacía hasta que el motor del sistema
   * responde. No es un error: hay que esperar al evento `voiceschanged` o
   * sondear. Se hace lo segundo porque el evento no siempre llega.
   */
  async function esperarVoces() {
    for (let intento = 0; intento < VOZ_SISTEMA.INTENTOS_VOCES; intento++) {
      if ((sintesis?.getVoices?.() || []).length) return true;
      await new Promise((r) => setTimeout(r, VOZ_SISTEMA.ESPERA_VOCES_MS));
    }
    return (sintesis?.getVoices?.() || []).length > 0;
  }

  async function iniciar() {
    if (destruido) return { ok: false, motivo: 'motor destruido' };

    if (!sintesis || !Locucion) {
      fijarEstado(ESTADO_VOZ_SISTEMA.ERROR, 'Este navegador no expone speechSynthesis.');
      onError?.('La voz del sistema no está disponible en este contexto.');
      return { ok: false, motivo: 'sin speechSynthesis' };
    }

    fijarEstado(ESTADO_VOZ_SISTEMA.CARGANDO, 'Buscando voces del sistema…');

    await esperarVoces();
    if (destruido) return { ok: false, motivo: 'motor destruido' };

    const esp = inventario();
    const locales = esp.filter((v) => v.local);
    const remotas = esp.filter((v) => !v.local);

    if (remotas.length) {
      console.log(
        `${LOG} ignoradas ${remotas.length} voces de RED por privacidad: ` +
          remotas.map((v) => v.nombre).join(', ')
      );
    }

    voz = elegirVoz();

    if (!voz) {
      const detalle = esp.length
        ? `Sólo hay voces en español de red (${remotas.map((v) => v.nombre).join(', ')}), ` +
          'y no se usan porque enviarían el texto fuera del equipo.'
        : 'No hay ninguna voz en español instalada en el sistema.';
      fijarEstado(ESTADO_VOZ_SISTEMA.ERROR, detalle);
      onError?.(detalle);
      return { ok: false, motivo: 'sin voz local', detalle };
    }

    console.log(`${LOG} voces españolas locales: ${locales.map((v) => v.nombre).join(', ')}`);
    fijarEstado(ESTADO_VOZ_SISTEMA.LISTO, `Voz del sistema lista (${voz.nombre})`);
    return { ok: true, voz: voz.nombre, locales: locales.length, remotasIgnoradas: remotas.length };
  }

  // ─── Hablar ──────────────────────────────────────────────────────────

  /**
   * Encola una frase. La promesa se resuelve cuando ha TERMINADO de sonar (o
   * cuando se da por perdida), nunca antes: quien llama necesita saber que el
   * hueco está libre.
   */
  function hablar(texto, { segundosOrigen = null } = {}) {
    const limpio = String(texto || '').trim();
    if (!limpio) return Promise.resolve({ hablado: false, motivo: 'texto vacío' });
    if (silenciado) return Promise.resolve({ hablado: false, motivo: 'doblaje desactivado' });
    if (estado === ESTADO_VOZ_SISTEMA.ERROR) {
      return Promise.resolve({ hablado: false, motivo: 'voz del sistema no disponible' });
    }
    if (estado !== ESTADO_VOZ_SISTEMA.LISTO) {
      return Promise.resolve({ hablado: false, motivo: 'voz del sistema no iniciada' });
    }

    const id = siguienteId++;

    return new Promise((resolver) => {
      cola.push({ id, texto: limpio, segundosOrigen, resolver });

      // Si el doblaje se acumula nos quedamos con lo más reciente: una voz
      // diez frases por detrás del vídeo no sirve de nada. Se avisa SIEMPRE,
      // porque descartar en silencio sería esconder contenido.
      while (cola.length > VOZ_SISTEMA.MAX_EN_COLA) {
        const viejo = cola.shift();
        console.warn(
          `${LOG} frase #${viejo.id} descartada: había ${cola.length + 1} esperando ` +
            `(máximo ${VOZ_SISTEMA.MAX_EN_COLA}). Texto: "${viejo.texto.slice(0, 60)}…"`
        );
        viejo.resolver({ hablado: false, motivo: 'descartada por ir muy retrasada', descartada: true });
      }

      procesarCola();
    });
  }

  function procesarCola() {
    if (destruido || silenciado) return;
    if (idEnVuelo !== null) return; // ya hay una hablando: esperará su turno
    if (estado !== ESTADO_VOZ_SISTEMA.LISTO) return;

    const tarea = cola.shift();
    if (!tarea) return;

    const trozos = trocearParaHablar(tarea.texto);
    if (!trozos.length) {
      tarea.resolver({ hablado: false, motivo: 'texto vacío tras trocear' });
      procesarCola();
      return;
    }

    idEnVuelo = tarea.id;
    pendiente = {
      id: tarea.id,
      resolver: tarea.resolver,
      texto: tarea.texto,
      segundosOrigen: tarea.segundosOrigen,
      trozos,
      indice: 0,
      t0: Date.now(),
      hablo: false
    };

    onHablando?.(true);
    decirTrozo();
  }

  /** Dice el fragmento `indice` de la frase en vuelo. */
  function decirTrozo() {
    const p = pendiente;
    if (!p) return;

    const texto = p.trozos[p.indice];
    const locucion = new Locucion(texto);
    locucion.voice = voz.ref;
    locucion.lang = voz.idioma;
    locucion.rate = VOZ_SISTEMA.VELOCIDAD;
    locucion.volume = 1;

    // El id se guarda en la locución para poder comprobarlo cuando vuelva:
    // un evento de una frase ya caducada no debe mover nada. Es el mismo
    // criterio que liberarSi() en el sintetizador.
    const idLocucion = p.id;

    locucion.onstart = () => {
      if (idLocucion !== idEnVuelo) return;
      if (!p.hablo) {
        p.hablo = true;
        p.tHabla = Date.now();
      }
    };

    locucion.onend = () => {
      if (idLocucion !== idEnVuelo) return;
      p.indice += 1;
      if (p.indice < p.trozos.length) {
        armarVigilante();
        decirTrozo();
        return;
      }
      terminar(idLocucion, { hablado: true });
    };

    locucion.onerror = (evento) => {
      if (idLocucion !== idEnVuelo) return;
      // `interrupted` y `canceled` son consecuencia de nuestro propio parar():
      // no son fallos que haya que enseñar al usuario.
      const causa = evento?.error || 'desconocido';
      if (causa === 'interrupted' || causa === 'canceled') {
        // OJO: si el vigilante acaba de pedir el cancel(), este onerror llega
        // ANTES de que el vigilante pueda cerrar la frase, y sin esto el
        // motivo quedaría como "interrumpida" y escondería el problema real
        // (que la voz no avisó de que terminaba). El motivo del vigilante manda.
        terminar(idLocucion, { hablado: p.hablo, motivo: p.motivoForzado || 'interrumpida' });
        return;
      }
      console.warn(`${LOG} error al hablar la frase #${idLocucion}: ${causa}`);
      onError?.(`La voz del sistema falló: ${causa}`);
      terminar(idLocucion, { hablado: false, motivo: `error: ${causa}` });
    };

    locucionActual = locucion;
    armarVigilante();

    try {
      sintesis.speak(locucion);
    } catch (error) {
      console.error(`${LOG} speak() lanzó una excepción:`, error);
      terminar(idLocucion, { hablado: false, motivo: 'speak() falló' });
    }
  }

  /**
   * VIGILANTE. Si `end` no llega nunca, esto termina la frase igualmente.
   *
   * No es paranoia: está documentado que speechSynthesis puede quedarse sin
   * disparar `end`. Si eso pasara sin vigilante ocurrirían DOS cosas malas a
   * la vez: el audio original se quedaría agachado para siempre y la cola se
   * bloquearía, con lo que el doblaje no volvería nunca. Exactamente el mismo
   * fallo que teníamos en el sintetizador, por otra vía.
   *
   * El plazo se calcula sobre la longitud del fragmento, con la velocidad
   * medida en el equipo (17,2 caracteres/segundo), más un margen generoso.
   */
  function armarVigilante() {
    pararVigilante();
    const p = pendiente;
    if (!p) return;

    const texto = p.trozos[p.indice] || '';
    const estimadoMs = (texto.length / VOZ_SISTEMA.CARACTERES_POR_SEGUNDO) * 1000;
    const plazo = Math.max(
      VOZ_SISTEMA.VIGILANTE_MINIMO_MS,
      estimadoMs * VOZ_SISTEMA.VIGILANTE_FACTOR + VOZ_SISTEMA.VIGILANTE_MARGEN_MS
    );

    const id = p.id;
    vigilante = setTimeout(() => {
      if (id !== idEnVuelo) return;
      console.warn(
        `${LOG} la frase #${id} no avisó de que terminaba en ${(plazo / 1000).toFixed(1)} s. ` +
          'Se da por terminada y se restaura el volumen.'
      );
      // Se fija el motivo ANTES de cancelar: cancel() dispara el onerror de
      // forma síncrona, y es ése quien va a cerrar la frase.
      p.motivoForzado = 'sin evento end (vigilante)';
      try {
        sintesis.cancel();
      } catch (_) {
        /* da igual: lo que importa es liberar el hueco */
      }
      // Si el cancel() no disparó ningún evento, se cierra aquí.
      terminar(id, { hablado: p.hablo, motivo: 'sin evento end (vigilante)' });
    }, plazo);
  }

  function pararVigilante() {
    if (vigilante) {
      clearTimeout(vigilante);
      vigilante = null;
    }
  }

  /** ÚNICO punto donde se libera el hueco, y sólo para el id correcto. */
  function terminar(id, resultado) {
    if (id !== idEnVuelo) {
      console.warn(`${LOG} evento CADUCADO de la frase #${id} (en vuelo: #${idEnVuelo}). Se ignora.`);
      return false;
    }

    pararVigilante();
    const p = pendiente;
    idEnVuelo = null;
    pendiente = null;
    locucionActual = null;

    if (p) {
      const duracionMs = Date.now() - (p.tHabla || p.t0);
      if (resultado.hablado && p.texto.length) {
        const medicion = {
          caracteres: p.texto.length,
          segundosVoz: duracionMs / 1000,
          caracteresPorSegundo: p.texto.length / Math.max(0.001, duracionMs / 1000),
          segundosOrigen: p.segundosOrigen,
          esperaMs: (p.tHabla || p.t0) - p.t0,
          trozos: p.trozos.length
        };
        mediciones.push(medicion);
        while (mediciones.length > VOZ_SISTEMA.VENTANA_MEDICIONES) mediciones.shift();
        onMedicion?.(medicion);
      }
      p.resolver({ ...resultado, duracionMs });
    }

    // Si no queda nada esperando, el audio original vuelve a su volumen. Si
    // queda, se encadena SIN levantar: evita el bombeo de subir y bajar entre
    // dos frases seguidas.
    if (cola.length > 0 && !silenciado && !destruido) {
      procesarCola();
    } else {
      onHablando?.(false);
    }
    return true;
  }

  /** Corta lo que esté sonando y vacía la cola. */
  function parar() {
    pararVigilante();
    cola.splice(0).forEach((t) => t.resolver({ hablado: false, motivo: 'doblaje detenido' }));

    const p = pendiente;
    idEnVuelo = null;
    pendiente = null;
    locucionActual = null;

    try {
      sintesis?.cancel?.();
    } catch (error) {
      console.warn(`${LOG} cancel() falló:`, error);
    }

    p?.resolver({ hablado: p.hablo, motivo: 'doblaje detenido' });
    onHablando?.(false);
  }

  function silenciar(valor) {
    silenciado = Boolean(valor);
    if (silenciado) parar();
  }

  function destruir() {
    destruido = true;
    parar();
    voz = null;
    fijarEstado(ESTADO_VOZ_SISTEMA.INACTIVO, '');
  }

  function rendimiento() {
    if (!mediciones.length) return { muestras: 0 };
    const cps = mediciones.map((m) => m.caracteresPorSegundo).sort((a, b) => a - b);
    const esperas = mediciones.map((m) => m.esperaMs).sort((a, b) => a - b);
    const mediana = (lista) => lista[Math.floor(lista.length / 2)];
    return {
      muestras: mediciones.length,
      caracteresPorSegundo: Number(mediana(cps).toFixed(1)),
      esperaEnColaMs: Math.round(mediana(esperas)),
      voz: voz?.nombre ?? null,
      velocidadPedida: VOZ_SISTEMA.VELOCIDAD
    };
  }

  return {
    iniciar,
    hablar,
    parar,
    silenciar,
    destruir,
    rendimiento,
    inventario,
    obtenerEstado: () => estado,
    vozActual: () => voz?.nombre ?? null,
    estaHablando: () => idEnVuelo !== null,
    enCola: () => cola.length
  };
}
