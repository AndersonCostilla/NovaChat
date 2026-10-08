# Qué está verificado y CÓMO — LiveDub

Este archivo existe para que no haya ambigüedad entre "lo comprobé ejecutándolo"
y "lo revisé leyendo el código". El entorno donde se escribió el código **no tiene
Chrome ni tarjeta de sonido**: nada de lo que requiera un navegador real ha sido
ejecutado por el agente.

Leyenda:

- **EJECUTADO** — se corrió una herramienta y se vio su salida.
- **REVISIÓN DE CÓDIGO** — razonamiento sobre el código, sin ejecutarlo. No es prueba.
- **PENDIENTE (humano)** — requiere Chrome real.

## Fase 3 — Nivel 1

| # | Comprobación | Cómo | Resultado |
|---|---|---|---|
| 1 | `node --check` en todos los `.js` propios + el bundle | EJECUTADO | Pasa (7 módulos ES + 1 clásico + bundle) |
| 2 | `bash -n` en `models/descargar-modelo.sh` | EJECUTADO | Pasa |
| 3 | `manifest.json` es JSON válido y la CSP incluye `wasm-unsafe-eval` | EJECUTADO | Pasa |
| 4 | Grep de `http(s)://` en código propio, excluyendo `libs/` | EJECUTADO | 0 coincidencias |
| 5 | El bundle vendorizado es idéntico al de npm (SHA-256) | EJECUTADO | Idéntico; **sin parches** |
| 6 | Los pesos del modelo quedan fuera de Git | EJECUTADO | Se crearon archivos falsos en `models/whisper-tiny/`; `git status` salió vacío |
| 7 | **La extensión carga sin pesos, captura + VAD siguen vivos y el popup muestra "Modelo no disponible" sin excepciones no capturadas** | **REVISIÓN DE CÓDIGO** | **NO ejecutado en Chrome. Ver abajo.** |

### Detalle del punto 7 (criterio de aceptación Nivel 1 #4)

**No se cargó la extensión en Chrome.** Lo que sí se hizo es seguir la ruta de
fallo línea a línea:

- `transcriptor-worker.js`: `self.onmessage` es un `async` envuelto en `try/catch`
  que convierte cualquier excepción (incluida la de `pipeline()` al no encontrar
  los archivos) en `postMessage({ type: 'ERROR', fase: 'carga' })`. Además hay un
  `self.onerror` de respaldo.
- `transcriptor.js`: `new Worker(...)` va en `try/catch`; `worker.onerror` cubre el
  fallo de carga del propio módulo; al recibir `ERROR` con `fase: 'carga'` pasa a
  estado `error`, vacía la cola y **no vuelve a encolar** (`transcribir()` devuelve
  `null` si el estado es `error`), así que no hay fuga de memoria por frases.
- `offscreen.js`: el transcriptor es opcional (`transcriptor?.transcribir(...)`);
  la captura, el medidor y el VAD no dependen de él en ningún punto.
- `popup.js`: pinta la etiqueta `Modelo no disponible` con el motivo traducido en
  el `title`.

**Aviso honesto sobre "sin excepciones en consola":** aunque no debería haber
*excepciones no capturadas*, sí es muy probable que aparezcan **líneas rojas de red**
en la consola del offscreen del tipo `net::ERR_FILE_NOT_FOUND` o `404` al intentar
leer `models/whisper-tiny/config.json`. Eso lo emite el propio navegador al fallar
el `fetch`, no es una excepción sin capturar y no rompe nada. Si al probar ves una
excepción con *stack trace* no capturada, eso sí es un bug: repórtala.

## Fase 3 — correcciones post-Nivel 2 (Bugs 1 y 2)

| # | Comprobación | Cómo | Resultado |
|---|---|---|---|
| 8 | `background.js` real (con `chrome` simulado) persiste 25 subtítulos, recorta a 20, no pierde escrituras concurrentes y responde `GET_SUBTITLES` | EJECUTADO (`tests/test-subtitulos.mjs`) | Pasa |
| 9 | Corte forzado del VAD: 30 s de habla continua producen 3 frases de ≤ 12 s | EJECUTADO (`tests/test-vad-corte.mjs`, réplica de la lógica) | Pasa |
| 10 | `node --check` en todos los `.js` tras los cambios | EJECUTADO | Pasa |
| 11 | Ningún contexto salvo el service worker escribe en `storage.session` | EJECUTADO (grep) | Sólo `background.js` escribe |
| 12 | El badge pasa a «Transcribiendo…» y vuelve a «Modelo listo» en Chrome | **PENDIENTE (humano)** | — |
| 13 | Cerrar/reabrir el popup conserva los subtítulos en Chrome | **PENDIENTE (humano)** | — |

**Causa raíz del Bug 1: YA DIAGNOSTICADA** (gracias al fallo de la Fase 4).
Un documento offscreen sólo tiene acceso a **`chrome.runtime`**; el resto de
APIs de extensión (`chrome.storage`, `chrome.tabs`…) llegan como `undefined`.
Por eso las escrituras a `storage.session` desde el offscreen nunca cuajaban: la
llamada reventaba y el `try/catch` mudo se lo tragaba. En la Fase 4 el mismo
error reapareció sin `try/catch` y se vio limpio en Chrome:
`Uncaught TypeError: Cannot read properties of undefined (reading 'onChanged')`.

Desde entonces hay una prueba que lo impide volver a colar:
`tests/test-offscreen-apis.mjs`.

## Fase 3 — Nivel 2: VERIFICADO POR HUMANO EN CHROME REAL

Pruebas ejecutadas por el usuario. Entorno: Chrome en Windows 10/11,
**Intel Core i5-12400** (6 núcleos / 12 hilos), vídeos de YouTube con voz en
inglés y habla continua.

| Criterio | Resultado | Evidencia |
|---|---|---|
| Carga del modelo | ✅ | `livedub.estado()` devolvió `modelo: "listo"`. Tiempo exacto no cronometrado; subjetivamente rápido (segundos, no minutos) |
| Latencia por frase | ✅ | **1.9 / 1.9 / 2.1 / 2.8 / 3.3 / 3.6 / 4.6 s**, escalando con la duración del audio |
| Persistencia de subtítulos (Bug 1) | ✅ | Cerrar y reabrir el popup conserva el historial |
| Badge del modelo (Bug 2) | ✅ | «Transcribiendo…» en azul durante la inferencia, «Modelo listo» al terminar |
| **Offline** | ✅ | DevTools → *Sin conexión*: **cero peticiones** en la pestaña Red y la transcripción sigue funcionando |
| Fallo A: `onnx/` ausente | ✅ | `Unable to load from local path "...encoder_model_quantized.onnx": "TypeError: Failed to fetch"`, badge «Modelo no disponible», **sin excepción no capturada**; captura + medidor + VAD siguen vivos |
| Fallo B: encoder truncado | ✅ | `Failed to load model because protobuf parsing failed`, badge «Modelo no disponible», `livedub.estado()` → `modelo: "error"`; captura + VAD intactos |
| Fases 1 y 2, sin regresiones | ✅ | Captura, doble AudioContext, medidor y persistencia de estado estables durante toda la sesión |
| Corte forzado a ~12 s | ✅ | Desaparece la alucinación repetitiva; transcripciones coherentes |

**Fase 3 CERRADA — checklist de Nivel 2 completo, sin huecos.**

Los dos modos de fallo producen mensajes internos distintos y ambos se traducen
ahora a una causa accionable en el tooltip del badge (comprobado con los textos
reales capturados en Chrome):

| Error real de Chrome | Texto mostrado |
|---|---|
| `Unable to load from local path ...: TypeError: Failed to fetch` | «Faltan los archivos del modelo en livedub/models/whisper-tiny/…» |
| `Failed to load model because protobuf parsing failed` | «El archivo del modelo está corrupto o incompleto: vuelve a ejecutar models/descargar-modelo.sh» |

## Fase 4 — Nivel 1 (traducción en→es)

| # | Comprobación | Cómo | Resultado |
|---|---|---|---|
| 1 | `node --check` en los 11 `.js` (nuevos y modificados) | EJECUTADO | Pasa |
| 2 | `bash -n` en `descargar-modelo-traductor.sh` | EJECUTADO | Pasa |
| 3 | `manifest.json` válido (no necesitó cambios en esta fase) | EJECUTADO | Pasa |
| 4 | Grep de `http(s)://` en código propio, excluyendo `libs/` | EJECUTADO | 0 coincidencias |
| 5 | Heurística de idioma: inglés, francés, español, alemán y textos sin pistas | EJECUTADO (`tests/test-traduccion.mjs`) | 6/6 |
| 6 | `traductor.js`: carga, cola, varias traducciones seguidas | EJECUTADO | 6/6 |
| 7 | Caída del modelo: ninguna promesa queda colgada y el estado pasa a `error` | EJECUTADO | 4/4 |
| 8 | Persistencia: subtítulo con original + traducción y estados de los dos módulos por separado | EJECUTADO (`background.js` real) | 4/4 |
| 9 | Los pesos del traductor quedan fuera de Git | EJECUTADO (`git check-ignore` + archivos falsos) | Ignorados |
| 10 | Traducción real con pesos, en Chrome | **PENDIENTE (humano)** | — |
| 11 | Ningún archivo del offscreen usa APIs fuera de `chrome.runtime`, y `offscreen.js` carga con el `chrome` restringido real | EJECUTADO (`tests/test-offscreen-apis.mjs`) | 7/7 — verificada reintroduciendo el bug |
| 12 | Un worker de traducción que no responde acaba en `error` y no deja promesas colgadas | EJECUTADO (`tests/test-traductor-vigilante.mjs`) | 11/11 — verificada desactivando el vigilante (2/6 colgadas) |
| 13 | La lista de archivos del modelo traductor coincide con lo que exige la librería | EJECUTADO (lectura de `transformers.min.js`) | `tokenizer.json` era obligatorio y faltaba en el script |
| 14 | Un texto de varias oraciones se trocea y no se pierde ninguna al traducir | EJECUTADO (`tests/test-segmentador.mjs`) | 24/24, con los 3 casos reales de Anderson |
| 15 | `max_new_tokens` NO era la causa del truncamiento | EJECUTADO (lectura del bucle de generación) | tope real 257 tokens; salidas truncadas de ~10 |
| 16 | Latencia real por frase tras el troceo y `num_beams=1` | VERIFICADO (humano, 2ª tanda) | traducción de 5,0-10,2 s a 0,2-2,5 s |
| 17 | Los términos protegidos sobreviven al ciclo sustituir → traducir → reponer | EJECUTADO (`tests/test-terminos-protegidos.mjs`) | 24/24, con el caso real `llama` → `Joyas` |
| 18 | OPUS-MT copia de verdad el marcador `Xk0` sin deformarlo | **PENDIENTE (humano)** | sólo se puede saber en Chrome; hay aviso en consola si falla |

**Nivel 1 verificado / Nivel 2 pendiente de pesos + Chrome real.**

## Fases 1 y 2 — estado

**VERIFICADAS de paso durante la sesión de Nivel 2 de la Fase 3**: captura,
doble AudioContext, medidor, persistencia de estado y cortes de frase razonables,
sin regresiones. Antes de eso, lo ejecutado había sido sólo: `node --check`, validación del manifest y una simulación en Node de la máquina de
estados del VAD con una secuencia sintética (frases de 2.048 s y 2.816 s, estado
limpio tras cada corte). El audio real nunca se ha reproducido aquí.


## Fase 5 — Nivel 1 (estático, en sandbox)

| # | Qué se verificó | Estado | Resultado |
|---|---|---|---|
| 1 | `node --check` en los 15 `.js` del proyecto | EJECUTADO | sin errores |
| 2 | `manifest.json` sigue siendo JSON válido | EJECUTADO | válido |
| 3 | Cero URLs remotas en código propio (excluye `libs/`) | EJECUTADO | 0 coincidencias |
| 4 | La librería vendorizada soporta `text-to-speech` y `VitsModel` | EJECUTADO (lectura del bundle) | tarea registrada, 16 referencias a `VitsModel` |
| 5 | VITS no necesita vocoder ni *speaker embeddings* | EJECUTADO (lectura del bundle) | usa `_call_text_to_waveform` |
| 6 | Las 3 claves de estado de módulo son distintas | EJECUTADO (`tests/test-doblaje.mjs`) | `livedub.modelo` / `.traductor` / `.sintetizador` |
| 7 | Ducking: baja al 18 %, restaura, sin bombeo entre frases | EJECUTADO (`tests/test-doblaje.mjs`) | 29/29 |
| 8 | Vigilante de 90 s en el sintetizador, sin promesas colgadas | EJECUTADO (`tests/test-doblaje.mjs`) | 4/4 resueltas |
| 9 | `parar()` y `silenciar()` restauran el volumen original | EJECUTADO (`tests/test-doblaje.mjs`) | correcto |
| 10 | Los archivos nuevos no usan APIs de `chrome` prohibidas | EJECUTADO (`tests/test-offscreen-apis.mjs`) | 11/11 |
| 11 | Latencia real de la síntesis en Chrome | **PENDIENTE (humano)** | estimado 0,5-2 s, sin medir |
| 12 | Que el doblaje suene y el ducking se perciba suave | **PENDIENTE (humano)** | requiere Chrome y altavoces |
| 13 | Nombres de archivo reales del repo `Xenova/mms-tts-spa` | VERIFICADO (humano) | los 4 archivos descargaron bien; `model_quantized.onnx` = 38.362.987 bytes |
| 14 | `popup.js` se carga y el interruptor de voz envía `SET_DOBLAJE` | EJECUTADO (`tests/test-popup.mjs`) | 21/21 — verificada reintroduciendo el bug |


## Fase 5.1 — Rendimiento de la voz (Nivel 1, estático en sandbox)

Origen: la primera prueba en Chrome real reveló que la síntesis va a 0,5× tiempo
real y empeora a 0,27×. Diagnóstico completo en `docs/RENDIMIENTO-VOZ.md`.

| # | Qué se verificó | Estado | Resultado |
|---|---|---|---|
| 1 | `node --check` en los 17 `.js` del proyecto | EJECUTADO | sin errores |
| 2 | Cero URLs remotas en código propio | EJECUTADO | 0 coincidencias |
| 3 | El bundle **no** implementa `speaking_rate` / `length_scale` / `noise_scale` | EJECUTADO (lectura del bundle) | 0 apariciones de cada uno → no hay palanca de velocidad en el modelo |
| 4 | No existe `ort-wasm-simd-threaded.wasm` vendorizado | EJECUTADO (`ls libs/transformers/*.wasm`) | sólo `ort-wasm-simd.wasm` → el multihilo está descartado |
| 5 | El banco declara `insuficiente` con los 8 datos REALES del i5-12400 | EJECUTADO (`tests/test-rendimiento-voz.mjs`) | 38/38 |
| 6 | El veredicto se emite **una sola vez**, no por frase | EJECUTADO (`tests/test-rendimiento-voz.mjs`) | 1 emisión con 8 muestras |
| 7 | Sin 3 muestras no se emite veredicto | EJECUTADO (`tests/test-rendimiento-voz.mjs`) | correcto |
| 8 | Se rechaza una frase larga **sin** sintetizarla | EJECUTADO (`tests/test-rendimiento-voz.mjs`) | con motivo y estimación en ms |
| 9 | `playbackRate` se aplica de verdad al nodo de audio | EJECUTADO (`tests/test-doblaje.mjs`) | = `VOZ.VELOCIDAD`, con topes |
| 10 | `onActividad(false)` no pisa el veredicto `insuficiente` | EJECUTADO (lectura + guarda explícita en `offscreen.js`) | guarda presente |
| 11 | `popup.html` sin `<label>` anidados | EJECUTADO (recuento de apertura/cierre) | profundidad máxima 1 |
| 12 | `verificar-modelos.ps1` cubre los **tres** modelos | EJECUTADO (lectura) | incluye `mms-tts-spa` con sus dos `.onnx` |
| 13 | **Si float32 es más rápido que int8 en este equipo** | **PENDIENTE (humano) — es la hipótesis central** | sin medir |
| 14 | Cuánto recorta la expansión acelerar a 1,2× | **PENDIENTE (humano)** | sin medir |
| 15 | Si el tono a 1,2× resulta molesto al oído | **PENDIENTE (humano)** | criterio subjetivo |
| 16 | `verificar-modelos.ps1` ejecutado en PowerShell real | **PENDIENTE (humano)** | no hay PowerShell en el sandbox |
