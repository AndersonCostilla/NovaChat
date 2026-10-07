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
