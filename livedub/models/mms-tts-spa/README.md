# Modelo de voz — MMS-TTS español (`Xenova/mms-tts-spa`)

Esta carpeta llega **vacía** al clonar el repositorio: los pesos no están en Git
(ver `.gitignore`). Descárgalos con:

```bash
bash livedub/models/descargar-modelo-voz.sh
```

## Por qué este modelo

| Candidato | Veredicto |
|---|---|
| **MMS-TTS español (VITS)** | ✅ **Elegido.** La librería que ya tenemos vendorizada lo soporta de fábrica: el bundle registra la tarea `text-to-speech` y la clase `VitsModel` |
| Piper TTS | ❌ Es ONNX, pero necesita `piper-phonemize` y espeak-ng compilados a WebAssembly. Sería un segundo stack entero |
| SpeechT5 | ❌ Soportado por la librería, pero **sólo inglés**, y además necesita vocoder aparte y *speaker embeddings* |
| Coqui / Bark | ❌ Demasiado pesados para un worker de navegador; Bark ni siquiera está en el bundle |

VITS es **de una sola pieza**: no necesita vocoder ni *speaker embeddings*.
Devuelve la onda directamente (`{ audio, sampling_rate }`, 16 kHz).

## Archivos que la librería exige

| Archivo | ¿Obligatorio? |
|---|---|
| `config.json` | sí |
| `tokenizer.json` | sí |
| `tokenizer_config.json` | sí |
| `onnx/model_quantized.onnx` | sí (~38 MB) |

Ojo a la diferencia con OPUS-MT: aquí hay **un solo `.onnx`**, no encoder +
decoder.

`sintetizador-worker.js` comprueba esta lista con `fetch()` **antes** de
arrancar el pipeline y escribe el resultado archivo por archivo en la consola
del documento offscreen (filtra por `sintetizador`).
