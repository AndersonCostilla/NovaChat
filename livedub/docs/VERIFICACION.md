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

**Nivel 1 verificado / Nivel 2 pendiente de pesos + Chrome real.**

## Fases 1 y 2 — estado

**VERIFICADAS de paso durante la sesión de Nivel 2 de la Fase 3**: captura,
doble AudioContext, medidor, persistencia de estado y cortes de frase razonables,
sin regresiones. Antes de eso, lo ejecutado había sido sólo: `node --check`, validación del manifest y una simulación en Node de la máquina de
estados del VAD con una secuencia sintética (frases de 2.048 s y 2.816 s, estado
limpio tras cada corte). El audio real nunca se ha reproducido aquí.
