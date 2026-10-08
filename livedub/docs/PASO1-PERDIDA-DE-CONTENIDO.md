# Pérdida de contenido — investigación de los cuatro puntos

**Resumen en una línea: sí, se está tirando contenido, y uno de los cuatro
puntos donde ocurre no dejaba absolutamente ningún rastro.**

---

## Punto 1 — El mecanismo exacto

Tenías razón en que esto es más urgente que la latencia. Hay **cuatro**
sitios en el código que descartan contenido, no uno.

| Dónde | Archivo:línea | Tope | ¿Avisaba? |
|---|---|---|---|
| Cola de **Whisper** | `transcriptor.js:146` | 2 frases | **NO. Nada en absoluto.** |
| Cola del **traductor** | `traductor.js:217` | 4 frases | sí, por consola |
| Cola de **voz** | `voz-sistema.js:244` | 2 frases | sí, por consola |
| Cola del reproductor (sólo motor de reserva) | `reproductor-doblaje.js:75` | 2 frases | sí, por consola |

### El caído de la fila #11: la cola de voz

Es un **descarte intencional ya existente**, no un efecto colateral. En
`voz-sistema.js`:

```js
while (cola.length > VOZ_SISTEMA.MAX_EN_COLA) {   // MAX_EN_COLA = 2
  const viejo = cola.shift();                     // se tira la MÁS ANTIGUA
  console.warn(`frase #${viejo.id} descartada…`);
}
```

**Cuándo se dispara:** cuando llega una tercera frase con dos ya esperando
turno. Bajo habla continua eso pasa cuando el atasco acumulado supera los
~24 segundos.

**Cuánto se pierde:** **una frase entera por descarte.** Con el tope del VAD
en 12 s, eso son hasta 12 segundos de vídeo que no se doblan. No se recorta
ni se acorta: desaparece completa.

**Por qué el desfase cae de golpe:** al tirar la frase más antigua, la
siguiente en hablar es más reciente, así que su desfase es menor. Los
17→19→22 s que viste subir eran el atasco creciendo; **el 7,79 s no es una
mejora, es la marca de que algo se tiró.** Una caída brusca del desfase es,
literalmente, el síntoma de una pérdida.

### El grave: la cola de Whisper

```js
// ANTES
while (cola.length > MAX_EN_COLA) cola.shift();
```

Sin `console.warn`, sin callback, sin resolver la promesa, sin nada. La
frase recibía un id, se la daba por aceptada a quien llamaba, **y luego
desaparecía**. No salía en los logs, no salía en mi tabla de latencia (se
quedaba abierta para siempre, nunca cerrada) y el usuario no se enteraba.

**Esto es audio del vídeo que no se transcribe, no se traduce, no se dobla
y de cuya existencia nadie llega a saber nada.** Ni siquiera aparecía como
subtítulo.

> **Cómo detectarlo en tu tabla anterior:** busca **saltos en la columna
> `#`**. Si pasa de la 14 a la 16, la 15 se perdió ahí. Si tu tabla tiene
> todos los números seguidos, este descarte no llegó a dispararse y el
> problema fue sólo el de la cola de voz.

### Qué se ha corregido

1. **El descarte de Whisper ya avisa**, con los segundos de audio perdidos y
   una explicación de qué significa.
2. **Un contador central de pérdida** (`registrarPerdida()` en
   `offscreen.js`): un único sitio por el que pasa todo lo que no se va a
   oír, cuente de donde cuente.
3. **Aviso visible en el popup.** Hasta ahora sólo había `console.warn`, y
   tu regla permanente es que no haya fallo silencioso. Ahora el módulo de
   voz pasa a estado de error con el texto «Se han perdido N frase(s) sin
   doblar: el doblaje no da abasto».
4. **Comando nuevo:** `livedub.perdidas()` — cuántas, de qué etapa, cuántos
   segundos de vídeo y el detalle de las diez últimas.

**Nada de esto arregla la pérdida. Sólo la hace visible.** Arreglarla es la
conversación del punto 4.

---

## Punto 2 — El «idioma no identificado» de la fila #23

**Pendiente de tu respuesta.** No puedo cerrarlo sin saber en qué estaba el
selector durante la segunda prueba.

- **Si estaba en «Detectar automáticamente»** → es lo esperado: la
  heurística de 17 palabras no reconoció el texto. Se arregla poniéndolo en
  «Inglés», sin tocar código.
- **Si ya estaba en «Inglés»** → es un bug real. La ruta sería ésta:

```js
function decidirTraduccion(texto) {
  if (idiomaOrigen === 'en') return { traducir: true, aviso: '' };   // ← debería salir aquí
  ...
  const pista = detectarIdioma(texto);   // ← no debería llegar nunca
```

En ese caso el sospechoso sería `idiomaOrigen`, que se lee de forma
asíncrona con `leerIdiomaOrigen()` al montar el transcriptor. Si el valor
guardado no coincide con lo que muestra el desplegable, o si se quedó en
`'auto'` por una carrera al arrancar, se explicaría. **Lo investigaría de
verdad en cuanto me confirmes el selector**, porque sería un fallo de
configuración silenciosa y no una limitación conocida.

La instrumentación ya distingue los tres casos, así que la próxima tabla
dirá el motivo exacto en la columna `resultado`.

---

## Punto 3 — El hueco negativo de la fila #22 (CORREGIDO)

**Era un defecto mío.** El hueco se calculaba al **cerrar** la frase, contra
la última del historial:

```js
const previa = historial[historial.length - 1];
f.intervaloMs = previa ? f.tFinHabla - previa.tFinHabla : null;
```

Cuando una frase falla (la #23 no se tradujo), se cierra **al instante**,
mientras que la anterior (#22) sigue hablando y se cierra **después**. El
historial queda desordenado, y la resta se hace contra una frase que llegó
*más tarde* → número negativo → −117 %.

**Arreglado:** el hueco se mide ahora en `abrir()`, en el momento de la
llegada. El orden de llegada sí es siempre monótono, así que **no puede
salir negativo pase lo que pase aguas abajo**. Hay una prueba que reproduce
exactamente el escenario de la #22 y #23 y verifica que el hueco sale
positivo y la ocupación no se descuadra.

---

## Punto 4 — El límite teórico (CONFIRMADO, y es aritmética)

Pediste calcular la ocupación si Whisper y la traducción costaran 0 ms.
**La respuesta es que sería exactamente la misma**, y no hace falta medirlo
para saberlo:

```
ocupación = duración del doblaje hablado ÷ hueco entre frases
```

- El **hueco entre frases** lo marca el VAD sobre el audio que entra. No
  depende de lo que tarde el procesamiento.
- La **duración del doblaje hablado** la marca lo que tarda la voz en leer
  el texto. Tampoco depende del procesamiento.

**Ninguno de los dos términos contiene a Whisper ni al traductor.** Así que
la ocupación es invariante frente a la velocidad de cálculo.

### Qué significa

| | Con los tiempos actuales | Con Whisper y traducción a 0 ms |
|---|---|---|
| Ocupación del canal de voz | >100 % | **>100 %, idéntica** |
| Atraso acumulado por frase | +1,3 s | **+1,3 s, idéntico** |
| ¿Se pierde contenido? | sí | **sí, igual** |
| Desfase constante | 10,7 s | ~4,5 s (se ahorran 6,2 s **una vez**) |

> **Conclusión confirmada: ninguna optimización de Whisper o de la
> traducción puede evitar la pérdida de contenido en habla continua.**
> Acelerar el procesamiento recorta el desfase **constante**, una sola vez,
> pero no toca el ritmo al que se acumula el atasco. El problema es la
> proporción entre el español hablado y el original (~1,1×), no la
> velocidad de cálculo.

Esto está ahora en el código: `livedub.limiteTeorico()` lo calcula y lo
explica con tus propios datos, y hay pruebas que verifican que la cifra a
0 ms sale idéntica a la real.

---

## Lo que queda por decidir (no implemento nada sin que elijas)

Si se confirma la ocupación >100 %, **sólo hay tres familias de solución**,
y las tres tienen un coste que te toca aceptar a ti:

### A. Acortar el español sin perder sentido
Pedirle al traductor versiones más concisas. **Coste: fidelidad.** Deja de
decirse exactamente lo que dice el original. Roza directamente tu regla de
«no resumir sin avisar» — sería resumir, con aviso y con tu permiso.
**Ganancia estimada: del 10 al 20 % de duración**, que es justo el orden de
lo que falta. No está medido.

### B. Recortar los silencios del audio doblado
Lo propusiste tú. **Problema serio: con la voz del sistema no tenemos el
audio.** `speechSynthesis` habla directamente por los altavoces y no nos
entrega muestras que podamos recortar. Esta opción **sólo sería posible
volviendo al motor MMS-TTS**, que es el que sí devuelve un `Float32Array`
— y ese motor es ~2.000 ms/s, lo que nos devolvería al problema anterior,
mucho peor. **Mi lectura: esta vía está cerrada de hecho**, salvo que
aparezca un motor local que entregue muestras y sea rápido.

### C. Aceptar un búfer
Es la única que garantiza cero pérdida, y la rechazaste con buen criterio.
No la propongo; la menciono porque **sin ella no puedo prometerte cero
pérdida en habla continua sostenida**, y prefiero decirlo claramente a
dejarlo implícito.

### Y una cuarta, la más honesta de todas
**Dejar de descartar en silencio y descartar bien.** Si la pérdida es
inevitable sin búfer, al menos que el usuario sepa cuándo pasa y cuánto.
Eso es lo que acabo de implementar. No es una solución, es honestidad.

**No voy a elegir yo entre A, B y C.** Dímelo tú con el dato de la
ocupación delante.
