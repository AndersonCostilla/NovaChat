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

- **Estado de la fase:** código completo y verificado en **Nivel 1** (sintaxis,
  manifest, ausencia de URLs remotas, degradación sin modelo). **Nivel 2
  (prueba real en Chrome con los pesos colocados) PENDIENTE** de verificación
  humana. No se avanza a Fase 4 hasta esa confirmación.
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

## Notas de alcance

- El permiso **`scripting`** está declarado pero todavía no se usa:
  se usará en la fase del overlay de subtítulos, para inyectar el overlay
  en la pestaña capturada.
