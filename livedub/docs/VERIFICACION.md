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

## Fase 3 — Nivel 2 (PENDIENTE, humano)

1. Subtítulo tras cada frase + **latencia real medida** (no estimada).
2. Cerrar/reabrir el popup sin perder subtítulos (`storage.session`).
3. DevTools en *Offline*: la transcripción sigue funcionando.
4. Pesos ausentes o corruptos: la extensión no se rompe.

## Fases 1 y 2 — estado

También **PENDIENTES de verificación humana en Chrome**. Lo ejecutado fue:
`node --check`, validación del manifest y una simulación en Node de la máquina de
estados del VAD con una secuencia sintética (frases de 2.048 s y 2.816 s, estado
limpio tras cada corte). El audio real nunca se ha reproducido aquí.
