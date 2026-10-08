# Paso 0 — Sonda de voces de Windows

**No modifica nada.** No instala, no toca la extensión, no envía nada a
internet. Solo pregunta qué voces tiene tu Windows y mide cuánto tardan.

Decide si toda la vía de `chrome.tts` tiene sentido o hay que buscar otra cosa.

---

## Por qué NO se ejecuta en la consola del service worker

Era el plan original, pero al revisar el manifiesto encontré que **LiveDub no
declara el permiso `"tts"`**:

```
permissions: ['tabCapture', 'offscreen', 'storage', 'activeTab', 'scripting']
```

Sin ese permiso, `chrome.tts` sale `undefined`. Añadirlo sería modificar el
manifiesto, y eso es tocar código antes de tiempo.

**La solución: usar `speechSynthesis`, la API del navegador.** Lee **las
mismas voces SAPI de Windows** que usaría `chrome.tts`, no necesita ningún
permiso y funciona en la consola de cualquier página normal. Si aquí aparece
una voz española local, `chrome.tts` también la verá.

---

## Cómo ejecutarla

1. Abre el vídeo de YouTube de siempre.
2. Pulsa **F12** → pestaña **Console**.
   *(La consola de la PÁGINA, no la del service worker ni la del offscreen.)*
3. **Haz clic una vez en la página**, sobre un hueco vacío. Chrome no deja
   hablar sin una interacción previa; sin esto la parte 3 saldrá vacía.
4. Pega todo el bloque de abajo y pulsa Enter.
5. **Súbele el volumen**: vas a oír la voz tres veces, es parte de la medida.

```js
/* ===== SONDA DE VOCES — LiveDub paso 0 ============================
   Pégalo en la consola de una pestaña NORMAL (la del vídeo de YouTube).
   No instala nada, no modifica la extensión, no envía nada a internet.
   =================================================================== */
(async () => {
  const T = '[Sonda]';
  if (!('speechSynthesis' in window)) { console.error(T, 'Este navegador no expone speechSynthesis.'); return; }

  // Chrome carga las voces de forma asíncrona: hay que esperarlas.
  const voces = await new Promise((listo) => {
    const v = speechSynthesis.getVoices();
    if (v.length) return listo(v);
    speechSynthesis.onvoiceschanged = () => listo(speechSynthesis.getVoices());
    setTimeout(() => listo(speechSynthesis.getVoices()), 3000);
  });

  if (!voces.length) { console.error(T, 'Chrome no ve NINGUNA voz instalada en el sistema.'); return; }

  console.log(`%c${T} 1) TODAS las voces que ve Chrome (${voces.length})`, 'font-weight:bold');
  console.table(voces.map((v) => ({
    voz: v.name,
    idioma: v.lang,
    'LOCAL (offline)': v.localService ? 'SI' : 'no — es de red',
    'por defecto': v.default ? 'si' : ''
  })));

  const esp = voces.filter((v) => /^es/i.test(v.lang));
  const espLocal = esp.filter((v) => v.localService);

  console.log(`%c${T} 2) Voces en ESPAÑOL: ${esp.length} (locales: ${espLocal.length})`, 'font-weight:bold');
  if (!esp.length)      console.error(T, 'NO hay ninguna voz en español instalada.');
  else if (!espLocal.length) console.error(T, 'Hay voces en español pero TODAS son de red. No sirven: no son offline.');
  else console.table(espLocal.map((v) => ({ voz: v.name, idioma: v.lang })));

  if (!espLocal.length) { console.log(T, 'Fin: sin voz española local no se puede seguir por esta vía.'); return; }

  // Frase representativa: lo que produce la traducción de ~12 s de inglés.
  const FRASE =
    'Lo que vamos a ver a continuación es un ejemplo bastante claro de cómo ' +
    'funciona el sistema completo, desde que se captura el audio original ' +
    'hasta que se escucha la voz traducida al español.';
  const ORIGEN_S = 12; // el corte del VAD

  const medir = (voz, rate) => new Promise((listo) => {
    const u = new SpeechSynthesisUtterance(FRASE);
    u.voice = voz; u.lang = voz.lang; u.rate = rate; u.volume = 1;
    const t0 = performance.now();
    let tIni = null;
    u.onstart = () => { tIni = performance.now(); };
    u.onend = () => listo({
      rate,
      'ms hasta empezar a hablar': tIni ? Math.round(tIni - t0) : 'NO llegó el evento start',
      'segundos hablando': Number(((performance.now() - (tIni ?? t0)) / 1000).toFixed(2)),
      'caracteres por segundo': Math.round(FRASE.length / ((performance.now() - (tIni ?? t0)) / 1000))
    });
    u.onerror = (e) => listo({ rate, error: e.error || 'desconocido' });
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
    setTimeout(() => listo({ rate, error: 'no terminó en 40 s' }), 40000);
  });

  const voz = espLocal[0];
  console.log(`%c${T} 3) Midiendo con "${voz.name}" — vas a oírla hablar 3 veces`, 'font-weight:bold');

  const filas = [];
  for (const rate of [1, 1.2, 1.4]) filas.push(await medir(voz, rate));
  console.table(filas);

  console.log(`%c${T} 4) VEREDICTO`, 'font-weight:bold');
  console.table(filas.map((f) => {
    const s = f['segundos hablando'];
    return {
      velocidad: `x${f.rate}`,
      'dura (s)': s ?? '—',
      [`¿cabe en los ${ORIGEN_S} s del original?`]:
        typeof s === 'number' ? (s <= ORIGEN_S ? `SI (sobran ${(ORIGEN_S - s).toFixed(1)} s)` : `NO (se pasa ${(s - ORIGEN_S).toFixed(1)} s)`) : '—',
      expansion: typeof s === 'number' ? Number((s / ORIGEN_S).toFixed(2)) : '—'
    };
  }));

  console.log(T, 'Copia las CUATRO tablas y pégaselas al agente.');
})();
```

---

## Qué vas a ver

Cuatro tablas:

1. **Todas las voces** que ve Chrome, con una columna **LOCAL (offline)**.
   Las que digan «no — es de red» son voces de Google: mandan el texto a sus
   servidores. Esas no nos valen.
2. **Las voces en español**, separando locales de las de red.
3. **La medición**: cuánto tarda en empezar a hablar y cuántos caracteres por
   segundo dice, a tres velocidades.
4. **El veredicto**: si una frase típica cabe o no en los 12 s del original.

**La cifra que importa es la cuarta tabla.** Si a velocidad 1,0 o 1,2 pone
«SI», el doblaje continuo es viable. Si pone «NO» en las tres, hay que hablar.

---

## La prueba de verdad: modo avión

Que una voz diga `localService: true` es la declaración de Chrome. **Hay que
comprobarla.**

1. Deja la consola abierta.
2. **Activa el modo avión en Windows** (Configuración → Red e Internet → Modo
   avión; o el icono de red en la barra de tareas).
3. Espera 5 segundos a que se corte de verdad la conexión.
4. **Vuelve a pegar el mismo bloque** y ejecútalo.

| Qué pasa sin internet | Qué significa |
|---|---|
| Habla igual, tiempos parecidos | **Es local de verdad.** Vía confirmada |
| No habla, o `error: network` | No era local. Hay que descartarla |
| Desaparecen voces de la tabla 1 | Esas eran de red. Normal y esperado |

5. **Desactiva el modo avión** cuando termines.

---

## Si NO hay voz española local

No es el fin, pero cambia el panorama. Alternativas que quedarían:

1. **Instalarla.** Windows 10/11: Configuración → Hora e idioma → Voz →
   «Agregar voces» → Español. Es gratis y local. Suele ser la solución.
2. **Volver a MMS-TTS con las colas arregladas.** Pasaría de ~3.600 a
   ~2.000 ms/s. Sigue sin alcanzar, pero deja de empeorar.
3. **Replantear el objetivo.** Doblaje bajo demanda (frase a frase, a
   petición) en vez de continuo.

---

## Qué mandarme

Las **cuatro tablas** de la ejecución normal, y **la cuarta** de la ejecución
en modo avión. Con eso decidimos los siguientes pasos juntos.
