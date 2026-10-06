# transformers.js vendorizado

Copia local (sin CDN) de la librería que ejecuta Whisper en el navegador.

| Dato | Valor |
|---|---|
| Paquete | `@xenova/transformers` |
| Versión fijada | **2.17.2** |
| Licencia | Apache-2.0 (ver `LICENSE`) |
| Origen | `npm pack @xenova/transformers@2.17.2` desde `registry.npmjs.org` |
| Runtime ONNX incluido | `onnxruntime-web` 1.14.0 (su JS va **dentro** del bundle) |

## Archivos

- `transformers.min.js` — bundle ESM (898 KB). Es el `dist/transformers.min.js` del paquete, sin modificar.
- `ort-wasm-simd.wasm` — binario de ONNX Runtime con SIMD (10 MB), el que realmente ejecuta el modelo.
- `LICENSE` — licencia Apache-2.0 del paquete original.

## Qué NO se copió y por qué

El paquete trae cuatro `.wasm` (≈38 MB en total). Sólo vendorizamos **`ort-wasm-simd.wasm`**:

- `ort-wasm-threaded.wasm` y `ort-wasm-simd-threaded.wasm`: los hilos de WASM exigen
  *cross-origin isolation* (`SharedArrayBuffer`), que no tenemos en un documento
  offscreen. Forzamos `numThreads = 1`, así que nunca se piden.
- `ort-wasm.wasm` (sin SIMD): Chrome 116+ (nuestro mínimo) siempre soporta SIMD.

Si algún día hiciera falta el fallback sin SIMD, basta con volver a hacer
`npm pack @xenova/transformers@2.17.2` y copiar `dist/ort-wasm.wasm` aquí.

## Nota sobre URLs remotas dentro del bundle

El bundle, tal y como lo publica su autor, contiene cadenas con URLs por defecto
(`https://huggingface.co/` como *host* de modelos y `https://cdn.jsdelivr.net/...`
como ruta por defecto de los `.wasm`). **No se usan**: en `transcriptor-worker.js`
las sobrescribimos antes de cargar nada:

```js
env.allowRemoteModels = false;                  // prohibido bajar modelos
env.localModelPath = <chrome-extension://.../models/>;
env.backends.onnx.wasm.wasmPaths = <chrome-extension://.../libs/transformers/>;
```

El código de LiveDub no contiene ni una sola URL `http(s)://` en las rutas de carga.
