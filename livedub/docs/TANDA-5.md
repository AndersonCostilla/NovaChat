# Tanda 5 — protocolo preregistrado

**Escrito el 9 de octubre de 2026, ANTES de grabar.** Nada de lo que hay
aquí se puede cambiar después de ver el resultado. Si algo sale distinto a
lo previsto, se anota como salió.

Motivo: la tanda 4 fue **no concluyente** —habla casi continua, ninguna
alucinación, ninguna llamada de Whisper por encima de 12 s—, así que el tope
`max_new_tokens: 180` **sigue sin validarse en uso real**.

---

## 1. Qué hay que grabar

**Vídeo con silencios, música o ruido entre tramos de habla.** Ése es el
material que hace alucinar a Whisper: en la tanda 3 las alucinaciones
salieron justo ahí, y en la tanda 4, con habla continua, no hubo ninguna.

Sirve cualquiera de éstos:

- un documental o reportaje con **música de fondo entre frases**;
- una entrevista con **pausas largas**;
- un vídeo con **aplausos, risas o ambiente** entre intervenciones;
- un directo con tramos de **silencio real**.

**Lo que NO sirve:** una charla seguida sin pausas. Eso es la tanda 4 otra
vez.

Duración: **8-10 minutos**. La tanda 4 dio 16 frases útiles, que es poco.

## 2. Comandos, al terminar y en este orden

```
livedub.cortes()
```
```
livedub.truncadas()
```
```
livedub.solape()
```
```
livedub.informeTanda()
```
```
livedub.probarTope(180)
```
```
livedub.costeWhisper()
```
```
livedub.contencion()
```
```
livedub.deriva()
```

## 3. Expectativas, por comando

| comando | qué espero ver | qué significaría lo contrario |
|---|---|---|
| `cortes()` | **al menos 1-2 intervenciones del detector**. Si hay cero, el vídeo no tenía el fenómeno. | cero cortes → tanda otra vez no concluyente |
| `truncadas()` | **0 que no sean alucinación.** Puede haber alguna que sí lo sea: eso es el tope funcionando. | una frase real truncada → **parada dura**, ver §4 |
| `probarTope(180)` | `SÍ — seguro`, y margen de la frase real más larga **≥ x2** | margen < x2 → el tope está demasiado cerca del habla real de este vídeo |
| eventos de Whisper | **ninguno ≥16 s con texto masivo detrás.** Puede haber ≥16 s **sin** texto masivo: ésos son del tipo #11 y el tope no los toca. | un evento ≥16 s **con** 1.000+ caracteres → el tope no está actuando; revisar que esté puesto |
| `costeWhisper()` | **no tengo expectativa.** La predicción del R² ya falló una vez y no la repito. Se anota el valor y punto. | — |
| `solape()` | lo que salga. Es su primera ejecución con datos reales. | — |
| `contencion()` | probablemente `NO SE PUEDE DECIR`, porque la contención fuerte hunde el R² | — |
| `deriva()` | sin degradación | x1,5 o más en `Whisper normalizado` → investigar aparte |

### Sobre `costeWhisper()`, explícitamente

En la tanda 3 escribí que el R² subiría y **bajó a 0**. Esta vez **no hago
ninguna predicción**: se registra el valor y se añade a la tabla de
`COSTE-WHISPER-REVISION.md`. Si vuelve a aparecer una pendiente alta en una
sesión con alucinaciones y baja en una sin ellas, eso empieza a sostener la
hipótesis de que la pendiente la ponían los puntos de alucinación — **pero
hará falta más de una coincidencia**.

## 4. Parada dura

> **Si `truncadas()` muestra UNA SOLA frase truncada que no sea alucinación,
> el tope se revierte.** Sin discutirlo, sin «a ver si cuela», sin esperar a
> otra tanda. Son dos líneas: `max_new_tokens` en `transcriptor-worker.js` y
> `TOPE_TOKENS_ASR` en `offscreen.js`.

La decisión la tomas tú leyendo el final del texto de esa frase, que es lo
que el informe pone delante. El programa marca candidatas; **no decide**.

## 5. Qué sería, otra vez, «no concluyente»

Definido ahora para que después no se pueda vender como aprobado:

> **Si no hay ninguna llamada de Whisper ≥12 s Y el detector no interviene
> ni una vez, la tanda es NO CONCLUYENTE**, salga lo que salga en el resto
> de comandos.

En ese caso, `truncadas() = 0` **vuelve a pasar por vacío** y no cuenta. Lo
que tocaría entonces es cambiar de material otra vez, o plantearse en serio
la pregunta de §6.

Tampoco cuenta como validación:

- una tanda de menos de **15 frases útiles**;
- una tanda en la que el tope no esté activo (verificable: `truncadas()`
  diría «no hay tope activo»).

## 6. Pregunta para ti — **no implemento nada sin tu OK**

Llevamos dos tandas dependiendo de que **el vídeo tenga la amabilidad de
provocar una alucinación**. La 3 la tuvo; la 4, no. Eso hace que validar el
tope sea cuestión de suerte.

**¿Quiero poder provocar el escenario a propósito, inyectando un tramo
grabado de silencio o música en la entrada de audio?**

### Viabilidad

Es factible y no es grande: el audio ya pasa por el documento offscreen
antes de llegar al transcriptor, así que se podría añadir un comando de
consola que meta por ahí unos segundos de silencio o de ruido grabado, en
vez de lo que venga de la pestaña. Hablamos de un módulo pequeño y de un
comando, no de tocar la captura.

### Riesgo, que es lo que importa

| riesgo | gravedad |
|---|---|
| **Es código de pruebas dentro del camino de producción.** Un error ahí no rompe un test: rompe el doblaje. | **alto** |
| Habría que asegurarse de que **nunca** puede quedarse activado por accidente | alto |
| Toca el punto de entrada del audio, que es zona que has pedido no tocar | alto |
| Lo que se inyecta **no es el audio real**: una alucinación provocada con un silencio sintético puede no parecerse a las que salen con música de verdad | medio — podría validar contra un fenómeno que no es el nuestro |

### Alternativa más barata, sin tocar nada

**Buscar un vídeo que ya tenga el fenómeno y reutilizarlo siempre.** Si la
tanda 3 lo produjo, ese material concreto sirve de banco de pruebas: mismo
vídeo, mismo tramo, repetible. No es inyección controlada, pero **no mete
código de pruebas en producción** y se puede empezar hoy.

**Mi recomendación: la alternativa barata primero.** Si después de la tanda
5 seguimos sin poder provocar el escenario, volvemos a hablar de la
inyección. **No toco nada de esto hasta que lo digas.**
