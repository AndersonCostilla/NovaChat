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

## Notas de alcance

- El permiso **`scripting`** está declarado pero todavía no se usa:
  se usará en la fase del overlay de subtítulos, para inyectar el overlay
  en la pestaña capturada.
