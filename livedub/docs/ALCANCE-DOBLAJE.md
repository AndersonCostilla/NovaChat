# Alcance del doblaje: qué es LiveDub y qué no es

**Documento de alcance. Decidido y aceptado explícitamente por Anderson
Costilla (propietario del proyecto) el 8 de octubre de 2026.**

Este documento existe para que no haya confusión más adelante, ni por parte
de quien retome el proyecto ni por parte de quien lo pruebe esperando otra
cosa.

---

## La frase corta

> **LiveDub hace doblaje CONTINUO, no doblaje SINCRONIZADO.**
> La voz española va permanentemente **entre 15 y 18 segundos por detrás** de
> la imagen. No hay sincronía labial y no la habrá.

---

## El objetivo real del producto, en palabras del propietario

> «Mi objetivo real es poder entender contenido hablado en otro idioma sin
> tener que leer subtítulos todo el tiempo, y ese desfase me parece aceptable
> para ese fin.»

Esto define el criterio de éxito. **LiveDub se juzga por si permite seguir un
vídeo escuchando en vez de leyendo.** No por sincronía, no por que los tres
modelos carguen, y no por que la suite de pruebas esté en verde.

---

## De dónde salen los 15-18 segundos

El retraso **no** viene de que el equipo sea lento. Viene de que no se puede
traducir una frase antes de haberla oído entera. Es causalidad, no
rendimiento:

| Etapa | Coste | ¿Se puede reducir? |
|---|---|---|
| Esperar a que termine la frase (VAD) | hasta **12 s** | Sí, pero empeora la traducción. **Decisión tomada: no se toca.** |
| Transcribir (Whisper tiny, local) | 2 – 3 s | Poco |
| Traducir (OPUS-MT, local) | 1 – 2 s | Poco |
| Sintetizar la voz | ~0,2 s con la voz del sistema | Ya resuelto |
| **Total** | **≈ 15 – 18 s** | |

La parte dominante son los 12 segundos del VAD, y se mantienen por decisión
expresa del propietario: **prioriza la precisión de la traducción sobre la
inmediatez**. Bajar el VAD a 5-6 segundos acercaría la voz, pero partiría las
frases por la mitad y la traducción empeoraría. Se rechazó.

---

## Por qué no se puede adelantar el audio

Es la pregunta más razonable y la respuesta es incómoda: **LiveDub oye el
audio al mismo tiempo que tú.**

La captura de pestaña (`chrome.tabCapture`) entrega el sonido **según se
reproduce**. No existe ningún adelanto, ninguna lectura anticipada del
archivo, ningún acceso al vídeo completo. Hay una sola línea de tiempo y
LiveDub está en el mismo punto que el espectador.

Por tanto, para que la voz coincidiera con la imagen habría que **retrasar la
imagen también** — pausar o ralentizar el vídeo unos 15 segundos al empezar.
Esa opción se evaluó (era la «opción B») y **se rechazó**: demasiado riesgo y
complejidad para el beneficio, y obliga a manipular el reproductor de
YouTube.

**Decisión firme: LiveDub no toca el vídeo, ni su posición ni su velocidad.**
El vídeo se reproduce con total normalidad y la voz lo sigue por detrás.

---

## Qué sí se garantiza

1. **Continuidad.** Mientras haya alguien hablando, hay voz española. Sin
   huecos, sin frases saltadas, sin resúmenes silenciosos.
2. **Desfase estable.** El retraso se mantiene alrededor de 15-18 s **y no
   crece** con el tiempo. Un vídeo de 40 minutos termina con el mismo desfase
   que tenía en el minuto 2.
3. **Nada de contenido omitido.** Si por alguna razón hubiera que descartar
   algo, se avisa; no se disimula.
4. **Coherencia interna.** Subtítulo y voz de una misma frase van juntos y en
   el mismo orden que el original, referenciados a la marca de tiempo del
   audio de origen.
5. **El audio original se atenúa** mientras habla la voz española, y vuelve
   a su volumen después.

## Qué NO se garantiza y no se va a intentar

1. **Sincronía labial.** Imposible con esta arquitectura. Nunca se prometerá.
2. **«Cero latencia».** No existe. Cualquier afirmación en ese sentido en
   cualquier documento de este repositorio es un error que hay que corregir.
3. **Traducción de calidad profesional.** Son modelos pequeños corriendo en
   local y gratis. Habrá errores, sobre todo con modismos.
4. **Coincidencia de duración.** El español ocupa más que el inglés. La voz
   puede terminar después de que el hablante original haya callado.

---

## Lo que aún no se sabe

Honestidad sobre los límites de lo verificado:

- **Si 15-18 segundos resultan cómodos en la práctica.** Es un juicio
  subjetivo y sólo se puede resolver usándolo. El propietario lo ha aceptado
  sobre el papel; queda confirmarlo con uso real.
- **Cuánto margen real hay.** Depende de qué proporción del vídeo es habla.
  Pendiente de la prueba de 5 minutos.

---

## Historial

| Fecha | Qué |
|---|---|
| 8 oct 2026 | Documento creado. Limitación de 15-18 s aceptada explícitamente por el propietario, con el objetivo declarado de «entender sin leer subtítulos». |
