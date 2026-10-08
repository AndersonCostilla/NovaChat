# Paso 1 — Investigación de los tres hallazgos

Datos de partida, medidos por Anderson el 8-oct-2026 (14 frases):

| | Mediana |
|---|---|
| Desfase desde que TERMINA la frase | **10,7 s** |
| Whisper | 4,27 s |
| Traducción | 1,96 s |
| Espera hasta hablar | 4,43 s |
| Frases cortadas por el tope de 12 s | **9 de 14** |

---

## Hallazgo 2 — Por qué se perdió la frase #9 (RESUELTO)

**Causa raíz: el traductor nunca llegó a ejecutarse. No hubo ningún error.**

`0 ms de traducción` no significa que la traducción fallara rápido:
significa que no se intentó. En `offscreen.js`:

```js
const decision = decidirTraduccion(texto);
if (decision.traducir) { ...llamar al traductor... }
```

Si `decision.traducir` es `false`, el traductor no se llama, la traducción
queda vacía y la frase no se dobla. **No es una excepción, no es un fallo
silencioso del worker, y el texto de Whisper no estaba vacío** (el
transcriptor filtra los textos vacíos antes de emitirlos: `if (mensaje.texto)`
en `transcriptor.js`).

### Qué hace que `traducir` sea `false`

Dos caminos posibles, y **los datos actuales no permiten distinguirlos**:

1. **El selector de idioma no estaba en «Inglés».** Si estuviera en
   «Detectar automáticamente», entra en juego la heurística.
2. **La heurística `detectarIdioma()` no reconoció el texto como inglés.**

El segundo es el probable. La heurística es deliberadamente simple: cuenta
cuántas de 17 palabras muy frecuentes del inglés (`the`, `and`, `you`,
`that`…) aparecen en el texto. Y tiene esta salida:

```js
if (mejorPuntos === 0) {
  return { idioma: 'desconocido', esIngles: false, confianza: 0 };
}
```

**Si una frase transcrita no contiene ninguna de esas 17 palabras, se
declara "idioma no identificado" y no se traduce.** Está hecho así a
propósito —más vale no traducir que inventar— pero el efecto secundario es
que **una frase legítima en inglés puede caerse del doblaje sin que nada
parezca ir mal**.

Casos típicos que lo disparan: nombres propios, cifras, una frase corta
(«Absolutely incredible.»), o que Whisper transcriba ruido o música.

### Lo que esto significa para tu regla

Tú prohibiste **omitir contenido sin avisar**. Esto lo omitía. Aparecía en
el subtítulo con un aviso, pero en el doblaje desaparecía, y en mi tabla de
latencia salía como un genérico «sin traducción» que no distinguía entre
«no hacía falta» y «falló».

**Eso último era un defecto de mi instrumentación, y lo he corregido.** A
partir de ahora la columna `resultado` dice exactamente cuál de los tres
casos fue:

- `NO se intentó traducir: El texto no parece inglés (…)`
- `la traducción falló: …`
- `doblaje apagado`

### Comprobación de 10 segundos que lo zanja

Mira el selector de idioma del popup. **Si está en «Detectar
automáticamente», ponlo en «Inglés».** Eso salta la heurística por completo
y el problema desaparece sin tocar una línea de código. Si ya estaba en
«Inglés», entonces la causa es la otra y hay que mirarla aparte.

---

## Hallazgo 1 — ¿Atasco estructural o lentitud? (HIPÓTESIS FUERTE, falta confirmar)

**Tu sospecha tiene muy buena pinta.** No lo puedo dar por demostrado sin un
dato que todavía no se estaba midiendo, pero el indicio es serio.

### El razonamiento

La voz es un recurso **de uno en uno**: mientras habla una frase, las demás
esperan. Lo que decide si el sistema aguanta no es la velocidad de Whisper,
sino esta comparación:

> **¿Dura el doblaje hablado más o menos que el hueco entre frases?**

Bajo habla continua las frases llegan cada **12,03 s** (el tope del VAD). Si
el español de una frase dura más de 12,03 s, cada frase empuja a la
siguiente y **el atasco se acumula**. La fórmula es:

```
espera(n+1) = max(0, espera(n) + duración_del_doblaje − 12,03)
```

Si el doblaje dura menos de 12,03 s, la espera se va a cero sola. Si dura
más, crece sin techo hasta que la cola se desborda y se descartan frases.

### Lo que dice la simulación

Simulé la tubería con **tus** números (Whisper 4,27 s + traducción 1,96 s) y
una secuencia realista de rachas de habla continua con pausas intercaladas,
barriendo el único dato desconocido: cuánto dura el doblaje.

| El español dura… | Espera mediana | Pico máximo |
|---|---|---|
| 0,95× el original | 0,00 s | 8,43 s |
| 1,00× | 0,00 s | 9,03 s |
| 1,05× | 1,86 s | 12,04 s |
| **1,11×** | **5,54 s** | **17,44 s** |
| 1,15× | 10,21 s | 22,22 s |
| 1,20× | 14,94 s | 27,78 s |

**Tú mediste 4,43 s de espera mediana y un pico de 17,44 s en la frase #14.**

Con **un solo parámetro libre**, el modelo reproduce el pico exactamente
(17,44 s) y queda cerca en la mediana (5,54 frente a 4,43). Eso apunta a que
**el doblaje en español dura en torno a 1,1 veces el audio original**: una
frase topada de 12,03 s generaría unos 13,3 s de voz española, un excedente
de **+1,3 s por frase**. Nueve frases topadas seguidas acumulan ~12 s de
atraso — justo el orden de magnitud del pico de la #14.

### Por tanto, y esto es lo importante

**Sí: es un problema estructural de capacidad, no «Whisper es lento».** Y
tiene una consecuencia que conviene entender bien:

> **Acortar las frases NO lo arregla.** Lo que importa es la *proporción*
> entre el doblaje y el original, y esa proporción no cambia por partir las
> frases en trozos más pequeños. Si el español dura 1,1 veces el inglés, lo
> seguirá durando con frases de 12 s, de 6 s o de 3 s.

También significa que **el desfase no se estabiliza solo**: se estabiliza
porque la cola tiene tope (2 frases) y descarta. Es decir, **la continuidad
se está manteniendo descartando contenido** — exactamente lo que prohibiste.
Hay que confirmarlo con el recuento de descartes.

### Cómo confirmarlo o tumbarlo (instrumentación ya añadida)

La tabla ahora trae tres columnas nuevas por frase —`doblaje hablado (s)`,
`hueco disponible (s)`, `ocupación (%)`— y el resumen calcula:

- `duración del doblaje hablado (mediana, s)`
- `hueco entre frases (mediana, s)`
- `OCUPACIÓN del canal de voz (%)`
- `el español dura x veces el original`
- `frases descartadas por retraso`
- `VEREDICTO`

**Predicción falsable:** si la hipótesis es correcta, la ocupación saldrá
**por encima del 100 %** y la expansión **alrededor de 1,1**. Si sale por
debajo del 85 %, mi explicación es errónea y habrá que buscar el atasco en
otro sitio.

---

## Hallazgo 3 — El tope salta en 9 de 14 frases (ANOTADO)

Registrado, sin tocar nada. Pero hay un detalle técnico que conviene dejar
escrito **ahora**, porque cambia el cálculo de esa palanca cuando se
discuta:

**El coste de Whisper es mayormente FIJO por frase, no proporcional a la
duración.** En `transcriptor-worker.js`:

```js
chunk_length_s: 30, // Whisper trabaja en ventanas de 30 s
```

Whisper rellena siempre una ventana de 30 segundos. El codificador procesa
esa ventana completa **cueste lo que cueste la frase**: 3 segundos de audio
y 12 segundos de audio pagan prácticamente el mismo encoder. Sólo el
descodificador escala con la cantidad de texto.

Consecuencia aritmética, con tus 4,27 s medidos:

| Tope del VAD | Frases por minuto | Tiempo de Whisper por minuto |
|---|---|---|
| 12 s (actual) | ~5 | ~21 s (35 % del tiempo) |
| 8 s | ~7,5 | ~32 s (53 %) |
| 6 s | ~10 | ~43 s (71 %) |
| 5 s | ~12 | ~51 s (85 %) |

**Bajar el tope no sólo empeoraría la traducción: multiplicaría la carga de
Whisper hasta saturar el procesador**, y el retraso total podría acabar
siendo *mayor*. La palanca sigue bloqueada y no la toco; esto es sólo para
que la decisión se tome con el dato delante.

**Esto es una predicción, no una medida.** El resumen ahora compara
`Whisper en frases cortas (<6 s)` con `Whisper en frases largas (≥11 s)`
usando tus propios datos. Si los dos números salen parecidos, el coste es
fijo y lo de arriba se confirma. Si el de las cortas es mucho menor, me
equivoco.

---

## Qué hace falta para pasar al paso 2

Una segunda tanda con la instrumentación nueva. Instrucciones en
`PASO1-SEGUNDA-MEDICION.md`.

**No propongo opciones todavía.** Las dos piezas que faltan —si el canal de
voz está saturado y si Whisper cuesta lo mismo con frases cortas— cambian
cuáles son las opciones sensatas, y adelantarlas ahora sería adivinar.
