# LiveDub

Extensión de Chrome (Manifest V3) que captura el audio de la pestaña para doblarlo en vivo.

**Estado actual:** Fase 4 de 6 (traducción inglés → español) escrita y verificada
a nivel de código; pendiente de prueba en Chrome con los pesos del traductor.
Fase 3 **cerrada y verificada en Chrome real** — captura de
la pestaña, segmentación por VAD y transcripción local con Whisper (WASM, sin red,
cero peticiones confirmadas en modo offline) mostrada como subtítulos en el popup.
Latencia medida: 1.9-4.6 s por frase en un Intel i5-12400.
Sin traducción ni TTS todavía. Los pesos del modelo **no están en el repositorio**:
se descargan con `bash livedub/models/descargar-modelo.sh` (ver `livedub/models/README.md`).

Código y documentación de uso: [`livedub/README.md`](livedub/README.md).

- JavaScript vanilla con módulos ES, sin frameworks ni paso de build.
- Todo local: sin CDN, sin servicios de pago, sin claves de API.
