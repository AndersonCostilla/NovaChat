# LiveDub

Extensión de Chrome (Manifest V3) que captura el audio de la pestaña para doblarlo en vivo.

**Estado actual:** Fase 2 de 6 — captura de audio de la pestaña, re-enrutado para
seguir oyéndola y segmentación en frases por detección de silencios (VAD).
Sin transcripción, traducción ni TTS todavía.

Código y documentación de uso: [`livedub/README.md`](livedub/README.md).

- JavaScript vanilla con módulos ES, sin frameworks ni paso de build.
- Todo local: sin CDN, sin servicios de pago, sin claves de API.
