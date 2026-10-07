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
- **El selector de idioma destino sigue sin efecto**: esta fase es sólo en→es.

## Notas de alcance

- El permiso **`scripting`** está declarado pero todavía no se usa:
  se usará en la fase del overlay de subtítulos, para inyectar el overlay
  en la pestaña capturada.
