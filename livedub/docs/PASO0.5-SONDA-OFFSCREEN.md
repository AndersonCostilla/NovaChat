# Paso 0.5 — ¿Puede hablar la voz del sistema desde el documento offscreen?

**Duración: unos 2 minutos. No modifica nada. No instala nada.**
**No hace falta desconectar el cable de red esta vez.**

---

## Qué estamos averiguando y por qué importa

LiveDub tiene un componente invisible llamado **documento offscreen**. Es donde
vive el audio: ahí se captura el sonido de la pestaña y ahí habría que bajarle
el volumen cuando hable la voz española (el *ducking*).

La pregunta es si **la voz de Windows puede hablar desde ese mismo sitio**.

- **Si puede** → todo queda junto. No hace falta ningún permiso nuevo en la
  extensión y el código es bastante más simple.
- **Si no puede** → hay que usar otro mecanismo (`chrome.tts`), añadir el
  permiso `"tts"` y mandar mensajes entre dos componentes.

Hay un motivo real para dudar: Chrome normalmente exige que **el usuario haya
hecho clic en algo** antes de permitir que una página emita sonido, y este
documento no recibe clics nunca. Puede que Chrome haga una excepción con las
extensiones, o puede que no. Se sabe probándolo.

---

## Antes de empezar: sube el volumen

La prueba consiste en **oír o no oír una voz**. Ten los altavoces o los
auriculares a un volumen normal.

---

## Paso 1 — Abre un vídeo cualquiera de YouTube

No hace falta que sea en inglés. Puede estar en pausa.

---

## Paso 2 — Pulsa «Iniciar» en LiveDub

Abre el popup de LiveDub y pulsa **Iniciar**.

**Esto es obligatorio**: el documento offscreen sólo existe mientras hay
captura activa. Si no pulsas Iniciar, en el paso siguiente no aparecerá nada
que inspeccionar.

---

## Paso 3 — Abre la consola del documento offscreen

1. Abre una pestaña nueva y escribe en la barra de direcciones:
   ```
   chrome://extensions
   ```
2. Busca la tarjeta de **LiveDub**.
3. Dentro de la tarjeta, busca la línea **«Inspeccionar vistas»**. Debajo
   aparecen enlaces azules. Uno de ellos dice **`offscreen.html`**.
4. **Haz clic en `offscreen.html`.**

Se abre una ventana de herramientas de desarrollo. Arriba tiene pestañas
(*Elements*, *Console*, *Sources*…). **Haz clic en `Console`.**

> **Si no aparece `offscreen.html`** en la lista, es que la captura no está
> activa. Vuelve al paso 2.

---

## Paso 4 — Desbloquea el pegado (sólo la primera vez)

Chrome bloquea pegar texto en la consola la primera vez, por seguridad. Haz
clic dentro de la consola e **intenta pegar**. Si sale un aviso rojo pidiendo
que escribas algo:

**Escribe a mano** (no se puede pegar) la frase que te pida, normalmente:

```
allow pasting
```

y pulsa **Enter**. A partir de ahí ya puedes pegar con normalidad.

---

## Paso 5 — Pega esto y pulsa Enter

Copia **todo** el bloque de abajo, pégalo en la consola y pulsa **Enter**.
Luego **escucha**.

```js
(async () => {
  const log = (m, c = '') => console.log('%c' + m, c);
  const BIEN = 'color:#1a7f37;font-weight:bold', MAL = 'color:#c00;font-weight:bold';

  if (typeof speechSynthesis === 'undefined') {
    log('✘ RESULTADO: aquí no existe speechSynthesis. Hay que usar chrome.tts.', MAL);
    return;
  }

  // Las voces tardan un instante en aparecer. Esperamos hasta 3 segundos.
  let voces = [];
  for (let i = 0; i < 30; i++) {
    voces = speechSynthesis.getVoices();
    if (voces.length) break;
    await new Promise(r => setTimeout(r, 100));
  }

  const esp = voces.filter(v => /^es/i.test(v.lang));
  const locales = esp.filter(v => v.localService);
  console.log('Voces visibles en total:', voces.length);
  console.table(esp.map(v => ({ nombre: v.name, idioma: v.lang, local: v.localService })));

  if (!locales.length) {
    log('✘ RESULTADO: el offscreen no ve ninguna voz española local. Hay que usar chrome.tts.', MAL);
    return;
  }

  const voz = locales[0];
  log('Voz elegida: ' + voz.name + '. Escucha ahora…');

  const u = new SpeechSynthesisUtterance(
    'Probando la voz española desde el documento offscreen de LiveDub. ' +
    'Si oyes esta frase completa, la arquitectura simple es viable.'
  );
  u.voice = voz;
  u.lang = voz.lang;

  let t0 = 0, arranco = false, termino = false;
  u.onstart = () => { arranco = true; t0 = performance.now(); log('  · evento start recibido'); };
  u.onend = () => {
    termino = true;
    log('  · evento end recibido tras ' + ((performance.now() - t0) / 1000).toFixed(2) + ' s');
    log('✔ RESULTADO: HABLA y avisa cuando termina. Arquitectura simple viable, sin permiso nuevo.', BIEN);
  };
  u.onerror = (e) => log('✘ RESULTADO: error "' + e.error + '". Hay que usar chrome.tts.', MAL);

  speechSynthesis.cancel();
  speechSynthesis.speak(u);

  setTimeout(() => {
    if (!arranco) {
      log('✘ RESULTADO: silencio, sin error y sin evento start.', MAL);
      log('   Es la política de reproducción automática de Chrome. Hay que usar chrome.tts.', MAL);
    } else if (!termino) {
      log('⚠ RESULTADO PARCIAL: habló, pero NO avisó de que terminaba.', 'color:#b36b00;font-weight:bold');
      log('   Sirve, pero el ducking necesitará una red de seguridad por tiempo.', 'color:#b36b00');
    }
  }, 15000);
})();
```

---

## Paso 6 — Dime qué pasó

La consola imprime una línea que empieza por **`RESULTADO:`**. Hay cuatro
desenlaces posibles:

| Lo que ves | Qué significa |
|---|---|
| ✔ verde **HABLA y avisa cuando termina** | El mejor caso. Sin permisos nuevos, código simple. |
| ⚠ ámbar **habló pero no avisó** | Sirve igual, pero hay que proteger el ducking. |
| ✘ rojo **silencio… política de reproducción** | Ruta larga: `chrome.tts` + permiso `"tts"`. |
| ✘ rojo **no ve ninguna voz** | Ruta larga también. |

**Mándame el texto de la consola tal cual**, incluida la tabla de voces. Con
eso decido la arquitectura y empiezo a construir.

> **Importante:** que salga ✘ **no es un fallo tuyo ni una mala noticia
> grave.** Las dos rutas llevan al mismo doblaje funcionando; una es más
> sencilla de mantener que la otra. Lo que no podía era adivinar cuál.

---

## Una cosa más, por si acaso

Si **oyes la voz pero la consola dice que no arrancó**, dímelo también: sería
un desajuste entre lo que hace Chrome y lo que informa, y cambia el diseño
(no podríamos fiarnos de los eventos).
