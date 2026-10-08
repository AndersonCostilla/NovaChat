# Alcance del doblaje: qué es LiveDub y qué no es

**Documento de alcance. Decidido y aceptado explícitamente por Anderson
Costilla (propietario del proyecto) el 8 de octubre de 2026.**

Este documento existe para que no haya confusión más adelante, ni por parte
de quien retome el proyecto ni por parte de quien lo pruebe esperando otra
cosa.

---

## La frase corta

> **LiveDub hace doblaje CONTINUO, no doblaje SINCRONIZADO.**
> La voz española va **unos 11 segundos por detrás** del momento en que el
> hablante TERMINA la frase. No hay sincronía labial y no la habrá.
>
> **No hay búfer ni espera inicial:** el doblaje empieza en cuanto hay algo
> que decir. El desfase es consecuencia de tener que oír la frase entera
> antes de poder traducirla, no de una espera que se añada a propósito.

### CORRECCIÓN DEL 8-OCT-2026: ya no son 15-18 s

**La cifra de 15-18 segundos de este documento era una estimación, no una
medición, y estaba equivocada por exceso.** Se sustituye por el resultado de
dos tandas cronometradas en el equipo de Anderson:

| | Estimado (obsoleto) | **Medido** |
|---|---|---|
| Desde que TERMINA la frase | 15 – 18 s | **10,7 s** |

**Motivo del cambio:** el 8-oct-2026 Anderson pidió explícitamente bajar el
desfase, revisando su aceptación anterior. Lo primero que se hizo fue
medirlo en vez de seguir citando la estimación. El desglose real, sobre 14
frases, es:

| Etapa | Medido |
|---|---|
| Whisper | 4,27 s |
| Traducción | 1,96 s |
| Espera en la cola de voz | 4,43 s |
| **Total desde el FIN de la frase** | **10,7 s** |

La estimación antigua sumaba además los hasta 12 s del VAD, que **no son
desfase**: son el tiempo que el hablante tarda en terminar de hablar.
Contarlos era medir desde que la frase EMPIEZA, que es una cifra distinta y
que confunde. Las dos columnas conviven ahora en la tabla de
`livedub.latencia()`, separadas a propósito.

---

## El objetivo real del producto, en palabras del propietario

> «Mi objetivo real es poder entender contenido hablado en otro idioma sin
> tener que leer subtítulos todo el tiempo, y ese desfase me parece aceptable
> para ese fin.»

Esto define el criterio de éxito. **LiveDub se juzga por si permite seguir un
vídeo escuchando en vez de leyendo.** No por sincronía, no por que los tres
modelos carguen, y no por que la suite de pruebas esté en verde.

---

## De dónde salían los 15-18 segundos (sección histórica)

> ⚠ **Esta sección y las dos siguientes se conservan como registro de lo que
> se creía ANTES de medir.** Sus cifras están superadas por los 10,7 s de
> arriba. Se dejan porque el razonamiento de fondo —no se puede traducir una
> frase antes de haberla oído entera— sigue siendo correcto, y porque
> borrarlas escondería que nos habíamos equivocado.

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

## ¿Cambia la cifra ahora que la voz es rápida? NO

Pregunta expresa del propietario el 8-oct-2026, al adoptarse la voz del
sistema: *«con esta voz más rápida, ¿sigue aplicando el desfase de 15-18
segundos?»*

**Sigue aplicando. La cifra no se mueve.** Y conviene entender por qué,
porque es contraintuitivo.

La voz nueva es unas **10.000 veces más barata** de generar que MMS-TTS:
pasó de ~2.000 ms de cálculo por segundo de voz a prácticamente cero, porque
la sintetiza Windows fuera de nuestro proceso. Pero mira dónde estaba el
tiempo:

| Etapa | Antes (MMS-TTS) | Ahora (voz del sistema) |
|---|---|---|
| Esperar a que termine la frase (VAD) | hasta 12 s | **hasta 12 s — igual** |
| Transcribir (Whisper) | 2 – 3 s | **2 – 3 s — igual** |
| Traducir (OPUS-MT) | 1 – 2 s | **1 – 2 s — igual** |
| Sintetizar | 25 – 45 s **y creciendo** | ~0 s |
| **Resultado** | **se iba a infinito** | **15 – 18 s estables** |

Lo que arregla la voz rápida **no es el retraso, es que el retraso dejara de
crecer**. Antes cada frase tardaba en generarse más de lo que duraba, así que
cada una empujaba a la siguiente y la distancia aumentaba sin techo hasta que
no quedaba más remedio que descartar frases enteras. Ahora la voz termina
mucho antes de que llegue la siguiente, y la distancia se queda quieta.

> **En una frase: antes el problema era que el desfase crecía; ahora es que
> el desfase existe. Lo segundo no tiene arreglo con un motor más rápido,
> porque no se puede traducir una frase antes de haberla oído entera.**

(Fin de la sección histórica. La cifra vigente son los **10,7 s medidos**
del principio del documento.)

## La pérdida de contenido: no es cero, y se dice

**Ésta es la parte incómoda del documento y va escrita aquí a propósito.**

En rachas de habla muy continua, LiveDub **puede dejar alguna frase sin
doblar**. En la última tanda limpia fue el **7,1 %**. No es un fallo
ocasional: es consecuencia aritmética de que el español dure ~1,11 veces lo
que dura el inglés. Si cada doblaje ocupa más hueco del que hay hasta la
frase siguiente, el atraso crece hasta que hay que soltar algo.

Está demostrado en `cronometro.js` que **esto no se arregla con velocidad**:
con Whisper y la traducción a 0 ms la ocupación sale idéntica.

### Qué se ha hecho al respecto (8-oct-2026)

| Decisión | Qué implica |
|---|---|
| **Camino 1: sin búfer, instantáneo** — elegido por Anderson | El doblaje arranca enseguida. A cambio, **la pérdida no baja a cero**. |
| Búfer inicial (rechazado) | Habría eliminado la pérdida casi por completo, a cambio de esperar al principio. Se descartó por decisión explícita. |
| Recorte de traducciones (opción A) | Acorta el español ~12 % para bajar la ocupación de 1,11 a ~0,98. |
| Lote con continuación | Elimina los atascos de 50 s del traductor, que eran la causa de las rachas de descartes. |

> **Nota honesta.** Con todo lo anterior aplicado, **puede seguir habiendo
> una pérdida ocasional baja** en rachas de habla muy continua sin pausas.
> No es cero **por decisión explícita de priorizar la experiencia
> instantánea** sobre la garantía total. Cuando ocurra, se avisa: sale en el
> popup en rojo y se cuenta en `livedub.perdidas()`. Nunca en silencio.

---

## Qué sí se garantiza

1. **Continuidad.** Mientras haya alguien hablando, hay voz española, sin
   resúmenes silenciosos. Si hay que descartar algo, **se avisa y se cuenta**
   (ver el apartado anterior: no se promete pérdida cero).
2. **Desfase estable.** El retraso se mantiene alrededor de **10-11 s desde
   el fin de cada frase y no crece** con el tiempo. Un vídeo de 40 minutos
   termina con el mismo desfase que tenía en el minuto 2.
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

- **Si ~11 segundos resultan cómodos en la práctica.** Es un juicio
  subjetivo y sólo se puede resolver usándolo. El propietario lo ha aceptado
  sobre el papel; queda confirmarlo con uso real.
- **Cuánto margen real hay.** Depende de qué proporción del vídeo es habla.
  Pendiente de la prueba de 5 minutos.

---

## Historial

| Fecha | Qué |
|---|---|
| 8 oct 2026 | Documento creado. Limitación de 15-18 s aceptada explícitamente por el propietario, con el objetivo declarado de «entender sin leer subtítulos». |
| 8 oct 2026 | **Los 15-18 s se sustituyen por 10,7 s MEDIDOS.** Motivo: eran una estimación, Anderson pidió bajar el desfase y lo primero fue medirlo. Se separa «desde el inicio» de «desde el fin» de la frase, que antes iban mezclados. |
| 8 oct 2026 | **Se añade el apartado de pérdida de contenido.** Camino 1 (sin búfer) elegido por Anderson: se prioriza la experiencia instantánea y **se acepta que la pérdida no sea cero**, a cambio de que siempre se avise y se cuente. |
