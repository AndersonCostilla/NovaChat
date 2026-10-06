# LiveDub — Fase 1 (esqueleto + captura de audio de la pestaña)

Extensión de Chrome (Manifest V3) en JavaScript vanilla con módulos ES.
**Sin frameworks, sin paso de build, sin CDN, sin servicios de pago.**

En esta fase LiveDub **sólo** hace esto:

1. Captura el audio de la pestaña activa (`chrome.tabCapture.getMediaStreamId`).
2. Lo re-enruta a los altavoces para que lo sigas oyendo con normalidad
   (`MediaStreamSource → gainOriginal → destination`).
3. Mide el nivel RMS del audio y lo pinta en una barra dentro del popup.
4. Permite ajustar el volumen del audio original con el mensaje `SET_GAIN` (futuro *ducking*).

**No hay transcripción, ni traducción, ni TTS.** Eso llega en fases posteriores.

---

## Estructura

```
livedub/
  manifest.json
  messages.js          Constantes de mensajería (tipos, destinatarios, estados)
  background.js        Service worker: streamId + ciclo de vida del offscreen
  offscreen.html
  offscreen.js         getUserMedia + grafo de audio + medidor
  popup/
    popup.html
    popup.css
    popup.js
  icons/
    icon16.png  icon48.png  icon128.png
  README.md
```

## Cómo cargar la extensión sin empaquetar

1. Abre `chrome://extensions`.
2. Activa el **Modo de desarrollador** (interruptor arriba a la derecha).
3. Pulsa **Cargar descomprimida** y selecciona la carpeta `livedub/`
   (la que contiene `manifest.json`, no la carpeta padre).
4. Fija LiveDub en la barra de herramientas con el icono del puzle.
5. Tras cualquier cambio en el código, vuelve a `chrome://extensions` y pulsa
   el botón **Recargar** (↻) de la tarjeta de LiveDub.

Requiere **Chrome 116 o superior** (por `chrome.runtime.getContexts`).

## Uso

1. Abre una pestaña con audio (por ejemplo, un vídeo de YouTube) y dale a reproducir.
2. Abre el popup de LiveDub y pulsa **Iniciar**.
3. El estado pasa a *Capturando* y la barra de nivel se mueve con el audio.
4. Pulsa **Detener** para liberar todo.

## Depuración

### Consola del service worker
`chrome://extensions` → tarjeta de LiveDub → enlace **service worker**
(bajo "Inspeccionar vistas"). Ahí verás los errores de `getMediaStreamId`
y de la creación del documento offscreen.

> Si el enlace dice "inactivo", pulsa sobre él igualmente: despierta al worker.

### Consola del documento offscreen
El offscreen sólo existe mientras hay captura activa:

1. Pulsa **Iniciar** en el popup.
2. En `chrome://extensions` → LiveDub → "Inspeccionar vistas" aparece
   **offscreen.html**. Pulsa ahí.
   (Alternativa: `chrome://inspect/#other` → busca `offscreen.html` → *inspect*.)

### Consola del popup
Clic derecho sobre el popup abierto → **Inspeccionar**.

### Probar `SET_GAIN`

Desde la consola del **documento offscreen** (atajo de depuración incluido):

```js
livedub.setGain(0.2);   // baja el volumen del audio original al 20 %
livedub.setGain(1);     // lo restaura
livedub.estado();       // { capturando, ganancia, audioContext }
```

Desde la consola del **service worker** o del **popup** (vía mensajería real):

```js
chrome.runtime.sendMessage({ type: 'SET_GAIN', target: 'offscreen', value: 0.2 });
chrome.runtime.sendMessage({ type: 'SET_GAIN', target: 'offscreen', value: 1.0 });
```

## Mensajería

Todos los tipos viven en `messages.js` (objeto `MSG`), nunca strings sueltos:

| Tipo              | Origen → destino        | Para qué |
|-------------------|-------------------------|----------|
| `START_CAPTURE`   | popup → background      | Inicia la captura de una `tabId` |
| `STOP_CAPTURE`    | popup → background      | Detiene y limpia todo |
| `GET_STATE`       | popup → background      | Estado actual al abrir el popup |
| `OFFSCREEN_START` | background → offscreen  | Entrega el `streamId` |
| `OFFSCREEN_STOP`  | background → offscreen  | Para tracks y cierra el `AudioContext` |
| `SET_GAIN`        | cualquiera → offscreen  | Ajusta `gainOriginal` (0..1) |
| `CAPTURE_STARTED` | background → popup      | Confirmación de inicio |
| `CAPTURE_STOPPED` | background → popup      | Confirmación de parada |
| `CAPTURE_ERROR`   | background → popup      | Error legible en español |
| `AUDIO_LEVEL`     | offscreen → popup       | Nivel RMS cada 100 ms |

## Errores habituales que la UI ya contempla

- **Páginas internas** (`chrome://`, `about:`, `devtools://`, otras extensiones): no son capturables.
- **Chrome Web Store**: Chrome prohíbe capturarla.
- **La pestaña no tiene audio**: el stream llega sin pista de audio.
- **El usuario cancela / permiso denegado**: `NotAllowedError`.
- **El offscreen ya existe**: `setupOffscreenDocument()` lo comprueba con
  `chrome.runtime.getContexts()` y además tolera la carrera de doble creación.
- **Pestaña ya capturada**: hay que pulsar Detener antes de reiniciar.

## Notas técnicas

- El `streamId` se pide **en el service worker y tras un gesto del usuario**
  (el clic en *Iniciar*); si no, Chrome lo rechaza.
- El `AnalyserNode` cuelga de `gainOriginal` pero **no** se conecta a
  `destination`, para no duplicar el audio.
- La ganancia se aplica con `setTargetAtTime` para evitar chasquidos.
- Al detener se paran los tracks, se cierra el `AudioContext` y el service worker
  llama a `chrome.offscreen.closeDocument()`, así se puede volver a Iniciar sin
  recargar la extensión.
