# opus-mt-en-es (pesos del traductor)

Carpeta **intencionadamente vacía** en Git. Aquí van los pesos de
`Xenova/opus-mt-en-es` (traducción inglés → español, ONNX int8).

Para rellenarla:

```bash
bash livedub/models/descargar-modelo-traductor.sh
```

Detalles, estructura esperada y qué hacer si algún nombre de archivo cambió:
ver [`../README.md`](../README.md).

Los binarios están excluidos del repositorio (ver `.gitignore` en la raíz):
pesan decenas de MB y no deben entrar en el historial de Git.

## Archivos que la librería exige (verificado, no supuesto)

Comprobado leyendo `libs/transformers/transformers.min.js`: el cargador llama a
`getModelJSON(..., "tokenizer.json", fatal=true)` y a
`getModelJSON(..., "tokenizer_config.json", fatal=true)`. Por tanto:

| Archivo | ¿Obligatorio? |
|---|---|
| `config.json` | sí |
| `tokenizer.json` | **sí** |
| `tokenizer_config.json` | sí |
| `generation_config.json` | no (recomendado) |
| `onnx/encoder_model_quantized.onnx` | sí |
| `onnx/decoder_model_merged_quantized.onnx` | sí |
| `source.spm`, `target.spm`, `vocab.json` | no — transformers.js no los usa |

`traductor-worker.js` comprueba esta lista con `fetch()` **antes** de arrancar el
pipeline y escribe el resultado archivo por archivo en la consola del documento
offscreen (filtra por `traductor`).
