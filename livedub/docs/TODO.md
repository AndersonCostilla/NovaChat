# TODO y hallazgos

## Fase 5 — voz en español + ducking (ENTREGADA, Nivel 2 pendiente)

**Modelo elegido: `Xenova/mms-tts-spa` (MMS-TTS, arquitectura VITS), ~38 MB.**

Criterio de la decisión, verificado leyendo el bundle vendorizado:

| Candidato | Veredicto |
|---|---|
| **MMS-TTS / VITS** | ✅ El bundle ya registra la tarea `text-to-speech` y la clase `VitsModel`. Cero dependencias nuevas |
| Piper TTS | ❌ Necesita `piper-phonemize` + espeak-ng en WebAssembly: un segundo stack entero |
| SpeechT5 | ❌ Soportado, pero **sólo inglés**, y además pide vocoder y *speaker embeddings* |
| Coqui / Bark | ❌ Demasiado pesados; Bark ni está en el bundle |

VITS es de **una sola pieza**: `_call_text_to_waveform` devuelve
`{ audio, sampling_rate }` sin vocoder. Por eso su carpeta tiene **un solo
`.onnx`**, no encoder + decoder como OPUS-MT.

Arquitectura, idéntica al patrón de las fases 3 y 4:
`sintetizador-worker.js` (tercer worker independiente, con pre-chequeo de
archivos) → `sintetizador.js` (fachada con cola y vigilante de 90 s) →
`reproductor-doblaje.js` (reproducción y ducking) → `offscreen.js`.

Decisiones que conviene recordar:

- **El modelo de voz sólo se carga si el usuario marca la casilla.** No tiene
  sentido gastar 38 MB y CPU si sólo quiere subtítulos.
- **La síntesis NO bloquea la publicación del subtítulo.** El texto aparece
  cuanto antes y la voz llega después.
- **Cola de voz muy corta (2).** Un doblaje que va diez frases por detrás no
  sirve: mejor descartar que acumular.
- **Al encadenar dos frases no se levanta el volumen entre medias**, para
  evitar el efecto «bombeo».
- **`claveDeModulo` pasó a ser un mapa explícito.** Con el ternario anterior, el
  estado de síntesis habría ido a parar a la clave de Whisper y habría pisado
  el estado de la transcripción. Detectado al integrar, cubierto por prueba.

Pendiente de Nivel 2: `docs/PRUEBA-NIVEL2-FASE5.md`.

# TODO / deuda técnica de LiveDub

Registro de cosas detectadas y conscientemente aplazadas.

## Diferido a Fase 6 (pulido)

- **(a) `AUDIO_LEVEL` se emite aunque el popup esté cerrado.**
  `offscreen.js` manda el nivel RMS cada 100 ms pase lo que pase; cuando no hay
  popup abierto, el envío falla y se descarta. Coste despreciable, pero es
  trabajo inútil. Solución futura: que el popup se suscriba/desuscriba
  (p. ej. `chrome.runtime.connect` + `onDisconnect`) y parar el temporizador
  mientras no haya oyentes.

- **(b) Revisar la legibilidad de los iconos a 16 px.**
  Los iconos son placeholders generados por script. A 128 px se ven bien;
  a 16 px (barra de herramientas) no se ha comprobado el resultado.

## Diferido (ajuste fino del VAD, Fase 2)

- **Sin margen inicial (*leading padding*)**: la frase empieza en el primer bloque
  que supera el umbral, así que puede comerse el ataque de la primera sílaba.
  Solución futura: mantener 1-2 bloques previos en un búfer circular.
- **Umbral fijo (`VAD_THRESHOLD = 0.005`)**: no se adapta al ruido de fondo del
  vídeo. Habrá que calibrarlo con material real o hacerlo adaptativo.
- **Sin duración máxima de frase**: si alguien habla sin pausas, `speechChunks`
  crece indefinidamente. Conviene un corte forzado (p. ej. a los 15-20 s).

## Fase 3 — pendientes y avisos

- **Estado de la fase:** código completo. Nivel 1 verificado **con matices**:
  ver `docs/VERIFICACION.md`, que distingue lo EJECUTADO (node --check, bash -n,
  manifest, grep, SHA-256 del bundle, prueba de .gitignore) de lo que sólo está
  respaldado por REVISIÓN DE CÓDIGO (la degradación sin modelo: nunca se cargó la
  extensión en un Chrome real). **Nivel 2 PENDIENTE** de verificación humana.
  No se avanza a Fase 4 hasta esa confirmación.
- **El bundle vendorizado NO está parcheado**: las cadenas `huggingface.co` ×3 y
  `cdn.jsdelivr.net` ×1 siguen dentro de `transformers.min.js` (son los valores
  por defecto de su `env`); se anulan por configuración en tiempo de ejecución.
  SHA-256 idéntico al de npm, documentado en `libs/transformers/README.md`.
- **Pesos fuera de Git (decisión explícita):** `livedub/models/whisper-tiny/` está
  en `.gitignore` salvo `.gitkeep`. Motivo: decenas de MB que hincharían el
  historial para siempre. Se obtienen con `models/descargar-modelo.sh`.
- **Nombres de archivo del modelo sin verificar en vivo:** el sandbox donde se
  escribió el script no tiene acceso a huggingface.co, así que las rutas del
  script no se pudieron comprobar. Si alguna da 404, ajustar la lista `ARCHIVOS`.
- **`idiomaDetectado` no es real:** transformers.js 2.x no expone el idioma que
  Whisper deduce internamente; devolvemos el configurado (o `'auto'`). Si hace
  falta el idioma real, habrá que leer los tokens de idioma a mano.
- **`wasm-unsafe-eval` y la Chrome Web Store:** Chrome 116+ lo acepta sin
  advertencias, pero es un permiso que la revisión de la Store puede cuestionar
  en el futuro. No bloquea nada ahora; anotado para la fase de publicación.
- **Sólo se vendorizó `ort-wasm-simd.wasm`** (10 MB): sin hilos (no hay
  cross-origin isolation) y sin fallback no-SIMD (Chrome 116+ siempre lo tiene).
- **Latencia por frase sin medir:** depende de la CPU; se reportará tras la
  prueba real. No se promete tiempo real.

## Fase 3 — correcciones tras la prueba de Nivel 2 (hallazgos reales)

- **Bug 1 (corregido): la persistencia de subtítulos no funcionaba.** El
  documento offscreen escribía en `chrome.storage.session` dentro de un
  `try/catch` mudo; las escrituras no cuajaban y el error se perdía. Ahora el
  **service worker es el único escritor** del storage (el offscreen le manda
  `SUBTITLE_ADD` / `MODEL_STATUS_SET`) y cualquier fallo se registra con
  `console.warn`. Cubierto por `tests/test-subtitulos.mjs`.
- **Bug 2 (corregido): el badge del modelo se quedaba en «Modelo inactivo».**
  Era consecuencia del Bug 1 (el estado sólo se emitía en las transiciones y, si
  el popup estaba cerrado en ese instante, se perdía). Además el popup ahora
  pregunta el panel al abrirse (`GET_SUBTITLES`) y hay un estado nuevo
  **«Transcribiendo…»** para que el badge se mueva durante la inferencia.
- **Alucinación de Whisper con habla continua (mitigado):** se añadió un corte
  forzado a **47 bloques ≈ 12 s** (`MAX_FRASE_CHUNKS`). Criterio: Whisper trabaja
  en ventanas de 30 s y degenera en repeticiones con buffers largos; 12 s deja
  margen de sobra, acota la latencia por frase y conserva contexto suficiente
  para una oración completa. **No se tocó `VAD_THRESHOLD`** (sigue en 0.005) a
  falta de datos reales: para calibrarlo hay `livedub.vadDebug(true)`, que
  imprime el RMS bloque a bloque, y `livedub.setVadThreshold(v)` para probar en
  caliente sin recargar la extensión.
- **Latencias medidas por el usuario** (i5-12400, 6c/12h): 1.9 / 1.9 / 2.1 / 3.3
  / 3.6 / 4.6 s por frase, escalando con la duración del audio.

## Fase 3 — cierre (verificada en Chrome real)

Resultados completos en `docs/VERIFICACION.md`. **Checklist de Nivel 2 completo:
todo ✅, sin huecos.** Latencias reales en i5-12400: 1.9-4.6 s por frase.
Offline confirmado con cero peticiones de red. Los dos modos de fallo del modelo
(ausente y corrupto) degradan de forma controlada a modo «solo captura».

Ajustes añadidos al cerrar, a partir de los hallazgos del usuario:

- **Ruido del motor ONNX**: `env.backends.onnx.env.logLevel = 'error'` en el
  worker (dentro de `try/catch`, es API interna de onnxruntime-web) para callar
  las decenas de avisos `CleanUnusedInitializersAndNodeArgs`. **No verificado en
  Chrome**: si siguen apareciendo, se quita y se asume el ruido.
- **Frases descartadas**: cuando el modelo no está disponible, el log del
  offscreen ya no finge trabajo; dice `DESCARTADA (modelo en estado "error")`
  y lleva un contador, visible también en `livedub.estado().frasesDescartadas`.

### Pendientes residuales de Fase 3 (no bloquean la Fase 4)

- El **badge** siempre dice «Modelo no disponible» en caso de error; la causa
  concreta está en el `title` (tooltip). Decisión consciente: el usuario común no
  distingue «falta» de «corrupto», y quien depura pasa el ratón por encima.

- Calibración de `VAD_THRESHOLD` con datos reales (`livedub.vadDebug(true)`).
  Sigue en 0.005, valor puesto a ojo y nunca ajustado con medidas.
- Vigilar si con frases de 12 s reaparecen repeticiones menores en audio denso.

## Fase 4 — bug corregido tras la primera prueba en Chrome

- **`chrome.storage` NO existe en el documento offscreen.** Sólo hay
  `chrome.runtime`. Un listener `chrome.storage.onChanged` añadido en el
  offscreen reventaba al cargar y **rompía la captura entera**
  (`Cannot read properties of undefined (reading 'onChanged')`).
  Es exactamente la misma restricción que causó el Bug 1 de la Fase 3, que
  entonces quedó sin diagnosticar porque un `try/catch` mudo lo escondía.
- **Corrección:** las preferencias de idioma también pasan por el service
  worker: `GET_SETTINGS` (offscreen → SW) para leerlas, y `SETTINGS_CHANGED`
  (SW → offscreen) cuando el usuario las cambia. El offscreen vuelve a tocar
  únicamente `chrome.runtime`.
- **Regla permanente del proyecto:** desde el documento offscreen y desde los
  workers, **sólo `chrome.runtime`**. Cualquier otra API va a través del service
  worker. Vigilado por `tests/test-offscreen-apis.mjs`.

## Fase 4 — traductor atascado en «cargando» (reporte de Anderson)

Síntoma: `traductor: "cargando"` indefinidamente, badge girando, cada subtítulo
con «Traducción no disponible (descartada por cola llena)» y **cero líneas**
sobre el traductor en la consola del offscreen.

Lo que se encontró, por orden de certeza:

1. **CONFIRMADO — ceguera total por falta de instrumentación.** `traductor.js` y
   `traductor-worker.js` tenían literalmente 0 `console.*`. La ausencia de logs
   no era una pista sobre el worker: era un agujero nuestro. Corregido.
2. **CONFIRMADO — `descargar-modelo-traductor.sh` no incluía `tokenizer.json`.**
   Verificado leyendo la librería vendorizada:
   `getModelJSON(..., "tokenizer.json", fatal=true)`. El script listaba
   `vocab.json` + `source.spm` + `target.spm`, que transformers.js **no usa**.
3. **CONFIRMADO — no había límite de tiempo de carga.** Un worker que no
   contesta dejaba el estado en `cargando` para siempre y las promesas de las
   frases encoladas colgadas. Reproducido en prueba: 2 de 6 resueltas.
4. **NO confirmado:** la causa última de que el worker no respondiera. No se
   puede determinar sin Chrome. El pre-chequeo de archivos y los logs nuevos lo
   dirán en la siguiente ejecución.

Descartadas con evidencia: la tarea `translation` **sí** está registrada en el
bundle; las claves de estado de transcripción y traducción son distintas (no hay
carrera entre módulos); el camino de publicación de estado no traga errores.

## PENDIENTE (Fase 2/3, fuera del alcance de la Fase 4) — el VAD corta a mitad de cláusula

Detectado al analizar la segunda tanda de pruebas de traducción, pero **no es
un problema de traducción**: cuando una frase llega al límite de duración
(`MAX_FRASE_CHUNKS = 47` en `offscreen.js`, unos 12 s), el corte cae donde cae.

Caso medido: `"high quality mixed Reality for"` → `"alta calidad"`. Se comprobó
que **no es el segmentador** (devuelve 1 trozo con el texto íntegro): es el
modelo, que ante un fragmento acabado en preposición suelta no produce una
traducción completa. El daño es doble, porque la transcripción también queda
partida.

Posible mejora para una fase futura: cerrar la frase en una **pausa prosódica**
cercana al límite en lugar de por reloj fijo, usando la energía que el VAD ya
calcula. NO tocar sin pedirlo: afecta a la máquina de estados del VAD, que está
confirmada funcionando en Chrome.

Sin acción, por diseño: una transcripción errónea de Whisper se traduce
fielmente y el resultado no tiene sentido en español. Basura entra, basura
sale; el traductor hace lo correcto. Se arregla mejorando la transcripción, no
la traducción.

## Fase 4 — nombres propios mal traducidos

Caso real: `"the llama models"` → `"los modelos de las 'Joyas'"`. OPUS-MT en→es
se entrenó con corpus de ~2020: no conoce Llama, y "llama" es además una
palabra española corriente.

Descartado con evidencia: subir `num_beams` **no** lo arregla. La búsqueda en
haz reordena candidatos con las mismas probabilidades del modelo; no añade
conocimiento que el modelo no tiene. Además, en `transformers.min.js` los haces
se recorren en serie (`for (let r of _) { await this.runBeam(r) }`), así que el
coste crece de forma aproximadamente lineal con `num_beams`: se pagaría ~2× de
latencia por una mejora incierta.

Solución aplicada: `terminos-protegidos.js`. Sustituye cada término por un
marcador antes de traducir y lo repone después. Coste de latencia: cero.
**Para añadir un término nuevo basta con una línea en la lista `TERMINOS` de
ese archivo.**

## Fase 4 — traducciones truncadas (9 muestras reales de Anderson)

Síntoma: frases largas traducidas a una sola oración. Ejemplo medido: entrada
de 4 oraciones → salida con la traducción de la última únicamente.

**Causa: OPUS-MT (Marian) es un modelo de ORACIÓN, no de párrafo.** Con varias
oraciones de golpe emite el token de fin tras una y descarta el resto.

Descartado con evidencia (NO era el límite de longitud): en
`transformers.min.js`, `const u = c + (t.max_new_tokens ?? Infinity)` da un tope
de 257 tokens, y `p = Number.isInteger(max_length) && max_new_tokens === null`
es `false` cuando pasamos `max_new_tokens`, así que `max_length` ni se mira. Las
salidas truncadas rondaban los 10 tokens: el techo nunca se tocó.

**Arreglo:** `segmentador.js` trocea en oraciones antes de traducir y vuelve a
unir después. El pipeline acepta un array y lo procesa como LOTE en una sola
llamada a `generate()` (verificado: `Array.isArray(e)||(e=[e])` → `batch_decode`).

**Latencia:** `_get_generation_config` fusiona `config.json` y
`generation_config.json` del modelo ANTES que nuestras opciones, y OPUS-MT
publica `num_beams: 4`. Ahora se fuerza `NUM_BEAMS = 1` en
`traductor-worker.js` y se escribe en consola qué traía el modelo. Revertir a 4
es cambiar una constante.

Límite duro conocido: `wasm.numThreads = 1`. Sin aislamiento de origen cruzado
no hay hilos de WebAssembly, así que la traducción va en un solo núcleo.

## Fase 4 — traducción inglés → español

- **Estado:** código completo, **Nivel 1 verificado** (node --check, manifest,
  grep de URLs, 20 comprobaciones automáticas en `tests/test-traduccion.mjs`).
  **Nivel 2 PENDIENTE**: faltan los pesos del traductor y la prueba en Chrome.
- **Nombres de archivo del traductor sin verificar en vivo** (huggingface.co
  sigue bloqueado aquí). `descargar-modelo-traductor.sh` marca como opcionales
  `generation_config.json`, `source.spm`, `target.spm` y `vocab.json` porque los
  repos Marian publican combinaciones distintas; si falta uno obligatorio, hay
  que añadirlo a la lista `ARCHIVOS`.
- **La heurística de idioma no es un modelo**: cuenta palabras frecuentes y
  acentos. Con frases muy cortas devuelve «desconocido» y, por prudencia, NO
  traduce. Si molesta, la solución limpia es seleccionar «Inglés» en el popup.
- **Decisión: se publica un único subtítulo** con original + traducción, en vez
  de publicar el original y actualizarlo después. Motivo: no reinventar el canal
  de persistencia con actualizaciones parciales. Coste: el subtítulo aparece
  ~0.3-1 s más tarde (lo que tarde la traducción).
- **El selector de idioma ORIGEN sí está conectado** (fuerza el idioma de Whisper
  y decide si se traduce) y se aplica en caliente vía `chrome.storage.onChanged`.
  **El de idioma DESTINO sigue sin efecto**: esta fase es sólo en→es.
- Plantilla de pruebas de esta fase: `docs/PRUEBA-NIVEL2-FASE4.md`.

## Notas de alcance

- El permiso **`scripting`** está declarado pero todavía no se usa:
  se usará en la fase del overlay de subtítulos, para inyectar el overlay
  en la pestaña capturada.
