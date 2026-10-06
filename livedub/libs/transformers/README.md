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

## Integridad: el bundle NO está parcheado

Los archivos de esta carpeta son **copias byte a byte** del tarball oficial de npm.
No se ha editado ni una línea, ni se han sustituido cadenas. Comprobado volviendo
a ejecutar `npm pack @xenova/transformers@2.17.2` y comparando SHA-256:

| Archivo | SHA-256 | Estado |
|---|---|---|
| `transformers.min.js` | `bcf7cf304e51f470ed59409622b9d6ffbad80dfcf5baf6a40c919e4b9c4ff812` | idéntico al de npm |
| `ort-wasm-simd.wasm` | `9bd07bababc65f53d061f457233eeae501be7ceb8a2adb9eef52d87fe776d865` | idéntico al de npm |
| `LICENSE` | — | idéntico al de npm |

Para re-verificarlo en cualquier momento:

```bash
npm pack @xenova/transformers@2.17.2 && tar xzf xenova-transformers-2.17.2.tgz
sha256sum package/dist/transformers.min.js livedub/libs/transformers/transformers.min.js
sha256sum package/dist/ort-wasm-simd.wasm  livedub/libs/transformers/ort-wasm-simd.wasm
```

Consecuencia práctica: actualizar de versión es sustituir estos archivos, sin
reaplicar ningún parche.

## Nota sobre URLs remotas dentro del bundle

**Esas cadenas SIGUEN EXISTIENDO dentro de `transformers.min.js`** y seguirán ahí
mientras no se parchee el bundle (y no lo parcheamos, a propósito). Son los
*valores por defecto* de su objeto `env`, tal y como los publica su autor:

```js
// dentro del bundle, valores por defecto:
allowRemoteModels: !0,
remoteHost: "https://huggingface.co/",
a.wasm.wasmPaths = `https://cdn.jsdelivr.net/npm/@xenova/transformers@${l}/dist/`
```

Recuento actual en el archivo: `https://huggingface.co/` ×3 y
`https://cdn.jsdelivr.net/npm/@xenova/transformers@` ×1.

Lo que hacemos es **anular esos valores en tiempo de ejecución** (configuración,
no parche) en `transcriptor-worker.js`, antes de cargar absolutamente nada:

```js
env.allowRemoteModels = false;                  // prohibido bajar modelos
env.localModelPath = <chrome-extension://.../models/>;
env.backends.onnx.wasm.wasmPaths = <chrome-extension://.../libs/transformers/>;
```

Con `allowRemoteModels = false`, transformers.js ni siquiera construye la URL
remota de un modelo: lanza error en vez de salir a la red.

**Alcance exacto del grep reportado en la Fase 3:** se ejecutó sobre el código
propio (`*.js`, `*.html`, `*.json`) **excluyendo `libs/`**, y dio cero
coincidencias. Eso NO significa, ni insinúa, que el bundle vendorizado esté libre
de esas cadenas: las tiene, están contadas arriba, y la garantía de que no se usan
viene de la configuración `env`, no de su ausencia en el archivo.

Nota aparte: `models/descargar-modelo.sh` sí contiene URLs de Hugging Face. Es una
utilidad de desarrollo que se ejecuta a mano en una terminal; ningún archivo de la
extensión la invoca ni se empaqueta para el navegador.
