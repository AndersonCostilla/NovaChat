# Pruebas automáticas (Node, sin navegador)

Se ejecutan con Node a secas, sin dependencias ni paso de build:

```bash
node livedub/tests/test-subtitulos.mjs   # persistencia de subtítulos (Bug 1)
node livedub/tests/test-vad-corte.mjs    # corte forzado de frases largas
```

Cada script termina con código 0 si pasa y 1 si falla.

## Qué cubre y qué NO

- **`test-subtitulos.mjs`** importa el `background.js` **real** con un `chrome`
  simulado (storage.session en memoria). Comprueba que 25 subtítulos seguidos se
  persisten, se recortan a 20 sin perder escrituras concurrentes, avisan al popup
  y se devuelven en `GET_SUBTITLES`. Esto es lo que fallaba en el Bug 1.
- **`test-vad-corte.mjs`** es una **réplica** de la máquina de estados del VAD
  (en `offscreen.js` no es exportable sin tocar la cadena de audio). Si cambias
  el VAD, actualiza también este archivo: puede quedar desincronizado.

Ninguna de las dos prueba Chrome, Web Audio, WASM ni el modelo: eso sólo se
valida a mano (ver `docs/PRUEBA-NIVEL2.md`).
