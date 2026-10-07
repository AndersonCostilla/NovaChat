# LiveDub — Fases 1-4 (captura + VAD + transcripción + traducción local)

Extensión de Chrome (Manifest V3) en JavaScript vanilla con módulos ES.
**Sin frameworks, sin paso de build, sin CDN, sin servicios de pago.**

Hasta ahora LiveDub **sólo** hace esto:

1. Captura el audio de la pestaña activa (`chrome.tabCapture.getMediaStreamId`).
2. Lo re-enruta a los altavoces para que lo sigas oyendo con normalidad
   (`MediaStreamSource → gainOriginal → destination`).
3. Mide el nivel RMS del audio y lo pinta en una barra dentro del popup.
4. Permite ajustar el volumen del audio original con el mensaje `SET_GAIN` (futuro *ducking*).
5. **(Fase 2)** En paralelo, pasa el mismo stream por un segundo `AudioContext` a
   16 kHz mono y lo trocea en "frases" con un VAD por detección de silencios.
   Cada frase detectada se registra por consola del offscreen; nada más.

6. **(Fase 3)** Transcribe cada frase **en local** con Whisper (ONNX int8 vía
   transformers.js + WASM, sin red) en un Worker dedicado, y muestra el texto en
   el panel «Subtítulos en vivo» del popup.

7. **(Fase 4)** Si el texto está en inglés, lo traduce al español con un
   **segundo worker independiente** (OPUS-MT local) y el panel muestra las dos
   versiones: `EN:` original y `ES:` traducción.

**No hay TTS, ni ducking real, ni overlay en la página, ni otros pares de idiomas.**
Eso llega en fases posteriores. La transcripción es en el idioma original
(`task: 'transcribe'`, nunca `translate`).

## Arquitectura de audio

```
contextOriginal (48 kHz)            -> lo que SE OYE
  MediaStreamSource -> gainOriginal -> destination
                    \-> analyser     (medidor, nodo hoja)

contextProcessing (16 kHz, mono)    -> lo que VERÁ la IA (no se oye)
  MediaStreamSource -> AudioWorkletNode('vad-processor') -> gain 0 -> destination
```

El worklet acumula bloques de 4096 muestras (256 ms a 16 kHz), calcula su RMS y
los manda a `offscreen.js`, que aplica la máquina de estados del VAD:
`VAD_THRESHOLD = 0.005` y `MAX_SILENCE_CHUNKS = 3` (≈750 ms de silencio cierran la frase).

Para ver las frases: abre la consola del documento offscreen y busca
`🗣️ Frase detectada: 2.048 segundos Float32Array(32768)`.
Estado del VAD y del modelo en caliente: `livedub.estado()`.

## Transcripción local (Fase 3)

```
offscreen.js  --frase (Float32Array 16 kHz)-->  transcriptor.js
                                                   |  postMessage (buffer transferido)
                                                   v
                                          transcriptor-worker.js  (Worker type: module)
                                                   |  pipeline('automatic-speech-recognition')
                                                   v
                                          whisper-tiny int8, WASM, 100 % local
                                                   |
offscreen.js  <--{ texto, idiomaDetectado, duracionMs }--
     |-- chrome.runtime.sendMessage  -> popup (si está abierto)
     '-- chrome.storage.session      -> historial de 20 subtítulos (si está cerrado)
```

**Antes de usarlo hay que colocar los pesos**: `bash livedub/models/descargar-modelo.sh`
(ver `models/README.md`). Sin pesos, el popup muestra «Modelo no disponible» y
LiveDub funciona en **modo solo captura**, sin romperse.

Reglas de la cola: una frase en vuelo a la vez, como mucho 2 esperando (las más
viejas se descartan para no acumular retraso) y 120 s de tiempo máximo por frase.

## Traducción local (Fase 4)

Sólo **inglés → español** en esta fase. El texto transcrito pasa por un worker
aparte (`traductor-worker.js`) con el modelo OPUS-MT, y el subtítulo se publica
una sola vez con original y traducción juntos.

Cuándo se traduce:

| Idioma origen en el popup | Qué hace |
|---|---|
| **Inglés** | Traduce siempre |
| **Detectar automáticamente** | Aplica la heurística de `detector-idioma.js`; si no parece inglés, no traduce y avisa |

| Cualquier otro | No traduce y avisa en el propio subtítulo |

El selector del popup se guarda en `chrome.storage.local` y **se aplica en
caliente**: cambiarlo con la captura en marcha afecta a la siguiente frase, sin
Detener e Iniciar.

La heurística existe porque transformers.js 2.x no expone el idioma que Whisper
detecta; antes que traducir francés con un modelo en→es, se avisa. Si el usuario
selecciona «Inglés» a mano, manda su elección y la heurística no se usa.

Los dos modelos son **independientes**: si el traductor falla, la transcripción
sigue apareciendo con un aviso en cada subtítulo.

---

## Estructura

```
livedub/
  manifest.json
  messages.js          Constantes de mensajería (tipos, destinatarios, estados)
  background.js        Service worker: streamId + ciclo de vida del offscreen
  offscreen.html
  offscreen.js         getUserMedia + grafo de audio + medidor + máquina VAD
  vad-processor.js     AudioWorkletProcessor: bloques de 4096 muestras + RMS
  transcriptor.js      Orquestación: cola de frases y estado del modelo
  transcriptor-worker.js  Worker dedicado: pipeline Whisper local (WASM)
  traductor.js         Orquestación de la traducción (cola y estado)
  traductor-worker.js  Worker dedicado: pipeline OPUS-MT en→es (WASM)
  detector-idioma.js   Heurística para no traducir lo que no es inglés
  libs/transformers/   @xenova/transformers 2.17.2 vendorizado + ort-wasm-simd
  models/whisper-tiny/   Pesos de Whisper (NO están en Git)
  models/opus-mt-en-es/  Pesos del traductor (NO están en Git)
  popup/
    popup.html
    popup.css
    popup.js
  icons/
    icon16.png  icon48.png  icon128.png
  docs/TODO.md         Deuda técnica registrada
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

## Regla de arquitectura: qué API puede usar cada contexto

| Contexto | APIs de extensión disponibles |
|---|---|
| `background.js` (service worker) | Todas: `storage`, `tabs`, `offscreen`, `tabCapture`… |
| `offscreen.js` + `transcriptor.js` + `traductor.js` | **Sólo `chrome.runtime`** |
| Workers (`*-worker.js`, `vad-processor.js`) | **Ninguna** |

El documento offscreen recibe `undefined` en `chrome.storage`, `chrome.tabs`,
etc. Todo lo que necesite pasa por mensajes al service worker. Esta regla está
vigilada por `tests/test-offscreen-apis.mjs` y su incumplimiento ya provocó dos
bugs (Bug 1 de la Fase 3 y la caída de la captura en la Fase 4).

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
