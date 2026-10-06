# LiveDub

Extensión de Chrome (Manifest V3) que captura el audio de la pestaña para doblarlo en vivo.

**Estado actual:** Fase 3 de 6 — captura de la pestaña, segmentación por VAD y
transcripción local con Whisper (WASM, sin red) mostrada como subtítulos en el popup.
Sin traducción ni TTS todavía. Los pesos del modelo **no están en el repositorio**:
se descargan con `bash livedub/models/descargar-modelo.sh` (ver `livedub/models/README.md`).

Código y documentación de uso: [`livedub/README.md`](livedub/README.md).

- JavaScript vanilla con módulos ES, sin frameworks ni paso de build.
- Todo local: sin CDN, sin servicios de pago, sin claves de API.
