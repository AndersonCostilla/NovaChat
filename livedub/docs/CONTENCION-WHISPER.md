# La segunda causa de lentitud de Whisper: contención entre llamadas vecinas

**9 de octubre de 2026.** Estado: **hipótesis abierta, sin resolver.**
Investigación **no bloqueante** para el tope de tokens.

---

## 1. El dato que la abre

Tercera tanda, dos frases seguidas:

| frase | caracteres | Whisper | ¿lo explica el texto? |
|---|---|---|---|
| **#10** | **1.889** (alucinados) | **20.051 ms** | **Sí.** 3.243 + 1.889 × 9,92 ≈ 21.983 ms. Encaja. |
| **#11** | **35** | **20.392 ms** | **No.** Su texto predice ≈ **3.590 ms**. Sobran **16.800 ms**. |

**Una frase de 35 caracteres tardó más que una de 1.889.** Y ocurrió
inmediatamente después.

Ese único punto hundió el ajuste de la sesión: **R² = 0,333**, con
`costeWhisper()` diciendo literalmente *«el tamaño del texto NO explica el
tiempo»*. No es que el modelo del coste sea falso — en las tandas anteriores
daba 0,646 — es que **hay un segundo mecanismo** que el modelo no contempla y
que en esta tanda pesó más.

## 2. La hipótesis

Dos llamadas a Whisper cercanas en el tiempo **se demoran mutuamente**. El
worker es de un solo hilo; una llamada que acaba de mover 1.889 tokens deja
detrás memoria que recoger y, si la siguiente entra pisándole los talones,
paga parte de esa factura.

**No está demostrado.** Y hay al menos una explicación rival que encaja igual
de bien: **un tramo en el que la máquina va lenta produce a la vez vecinas
pesadas y frases lentas**, sin que una cause la otra. Distinguir las dos
necesita más de una sesión.

## 3. Lo que el tope de tokens **no** arregla

Esto es lo importante y conviene dejarlo dicho **antes** de medir, no
después:

| tipo de evento | ejemplo | ¿lo arregla `max_new_tokens: 180`? |
|---|---|---|
| alucinación que genera texto larguísimo | **#10** — 1.889 car, 20,0 s | **Sí.** Techo en ~10,4 s. |
| frase corta ralentizada junto a una vecina pesada | **#11** — 35 car, 20,4 s | **No.** No hay tokens que recortar. |

### La expectativa corregida para la próxima tanda

**Se espera que desaparezcan los eventos con texto masivo. NO se espera que
desaparezcan todos los eventos de Whisper ≥16 s.** Si la tanda posterior al
tope sigue mostrando eventos catastróficos pero **sin texto alucinado detrás**,
eso **no invalida el arreglo**: confirma que ataja una de las dos causas.

Queda escrito aquí para que nadie —yo el primero— pueda presentar luego un
resultado peor de lo prometido como si fuera una sorpresa.

## 4. Las pérdidas que vinieron detrás

En esta tanda, las pérdidas de cola de voz **#11, #13 y #15** siguen
inmediatamente al par **#10-#11**. La sospecha es que no son tres fallos
independientes: son el mismo retraso compartido propagándose.

Eso tampoco está demostrado, y es parte de la investigación.

## 5. La herramienta: `livedub.contencion()`

```js
livedub.contencion()
livedub.contencion({ msVecindad: 2000, msPesada: 12000 })  // criterios ajustables
```

Para cada frase calcula el **residuo** —cuánto se desvía de lo que predice el
tamaño de su texto, usando el ajuste de la propia sesión— y lo cruza con si
venía **pegada a una vecina pesada** (menos de 2 s de hueco tras una llamada
de 12 s o más).

Si la hipótesis es cierta, las frases pegadas a una vecina pesada deben
desviarse mucho más que las demás. Los veredictos posibles:

| veredicto | cuándo |
|---|---|
| `NO SE PUEDE DECIR` | ningún caso en la sesión. No hay nada que comparar. |
| `INDICIO DÉBIL` | menos de 3 casos. Puede ser casualidad. |
| `SÍ, HAY INDICIO` | ≥3 casos y se desvían más del doble que las demás. |
| `NO` | venir detrás de una pesada no cambia gran cosa. |

Da también **las 5 frases que más se desvían de lo que su texto justifica**,
que es por donde hay que mirar aunque el veredicto salga tibio.

**Lo que esto mide es una correlación dentro de una sesión. No prueba la
causa**, y el propio informe lo dice.

### Corrección del 9-oct (tanda 4): la herramienta se autolimita

Dos fallos de diseño, descubiertos al usarla:

**1. Informaba con un ajuste inservible.** En la tanda 4 el R² fue **0** y
`contencion()` siguió publicando una columna llamada «esperado por su
texto». Con R² = 0 esa predicción es poco más que **la media de la sesión**,
así que «de más» no significaba «se desvió de lo que su texto justifica»
sino «es más lenta que la media». Corregido: por debajo de **R² = 0,3** la
herramienta **se calla** y remite a `solape()`.

> El umbral de 0,3 **se fijó después de ver el R² = 0**. Es una **guarda
> contra ajustes inútiles, no un criterio de validación**: que una sesión lo
> supere no convierte en buena ninguna conclusión. Se eligió como el listón
> más bajo que deja fuera la tanda 4 (R² = 0) sin dejar fuera la tanda 3
> (R² = 0,333) — no se elige un umbral para descartar los datos incómodos.

**2. Y aquí está lo incómodo: la contención fuerte destruye el ajuste que
esta herramienta necesita.** Reconstruyendo el par #10-#11 en un test, el R²
cae a **0,164** y la guarda la silencia. Es decir: **cuanto más real es el
fenómeno, menos capaz es `contencion()` de verlo.**

Eso no se arregla subiendo o bajando el umbral: es consecuencia de medir
restando un modelo que el propio fenómeno rompe. **Por eso la medida buena
es `solape()`, que no usa ningún modelo.** `contencion()` se queda como
herramienta secundaria.

## 5 bis. `livedub.solape()` — la medida SIN modelo

**Escrito el 9-oct-2026 ANTES de correrla con datos reales.** Los criterios
de abajo se fijan ahora para que después no se puedan acomodar al resultado.

### Qué compara

Dos grupos de frases, y nada más:

- **con solape** — su audio estaba listo **antes** de que volviera la
  transcripción de la anterior;
- **sin solape** — llegaron con la cola libre.

Y de cada grupo, la **mediana del tiempo medido**. No se resta ningún
modelo, no se predice nada: sólo se comparan tiempos observados. Por eso
sigue funcionando cuando el R² es cero, que es justo cuando `contencion()`
se apaga.

### La convención de signo, verificada en el código

`hueco = tFinHabla(ésta) − tFinAsr(anterior)`, donde `tFinHabla` se sella en
`abrir()`, al **llegar** la frase, y `tFinAsr` cuando vuelve el resultado de
Whisper.

**hueco negativo ⟹ la frase ya estaba esperando mientras la anterior aún se
transcribía ⟹ solape.** Comprobado leyendo `cronometro.js`, no supuesto. Y
el orden de llegada es monótono por construcción (hay un comentario en
`abrir()` explicando que se midió así precisamente para que no salieran
negativos espurios), así que un hueco negativo aquí es solape de verdad.

### Las dos columnas, y por qué importan

| columna | qué mide | incluye |
|---|---|---|
| **reloj de pared** (`tFinAsr − tFinHabla`) | lo que el usuario sufre | **espera en cola + cómputo** |
| **cómputo puro** (`duracionMs` del worker) | lo que tarda el modelo | sólo cómputo |

**Esto es lo que de verdad decide la pregunta.** Si las frases solapadas son
más lentas **sólo** en reloj de pared, no hay contención: hay **cola**, y
eso es otro problema (y otra solución). Si también son más lentas en
**cómputo puro**, entonces sí se están estorbando de verdad.

`duracionMs` ya lo mandaba el worker en cada resultado y **se estaba
tirando a la basura**; ahora se guarda. Las sesiones grabadas antes de este
cambio no lo tienen, y en ellas la columna sale vacía.

### Criterios, fijados de antemano

Mínimo de muestra: **4 frases en cada grupo**. Con menos, no se responde.

| veredicto | condición |
|---|---|
| **NO SE PUEDE DECIR** | algún grupo con menos de 4 frases |
| **SÍ** | las solapadas tardan **≥ 1,5×** que las no solapadas |
| **INDICIO** | entre **1,2×** y 1,5× |
| **NO** | por debajo de **1,2×** |

Y sobre el veredicto manda siempre el matiz del cómputo puro:

- si hay diferencia en reloj de pared **y** en cómputo puro → compatible con
  contención;
- si la hay en reloj de pared pero **no** en cómputo puro → **es cola**, no
  contención. El veredicto `SÍ` se reescribe para decirlo.

### El confusor que hay que vigilar

Si el grupo solapado resulta tener textos mucho más largos, la diferencia
puede ser sólo tamaño. Por eso el informe da **la mediana de caracteres de
cada grupo** y **avisa** si se diferencian más de un 50 %. No lo corrige
—corregirlo exigiría volver al modelo que se está evitando— pero lo pone
delante.

### Lo que esta medida NO puede hacer

Sigue siendo **correlación dentro de una sesión**. Un tramo en que la
máquina va lenta produce a la vez solapes (porque las frases se acumulan) y
frases lentas. **Eso no se resuelve con más estadística sobre una sesión**;
se resuelve comparando sesiones, o provocando el solape a propósito.

## 6. Si la hipótesis se confirma, qué habría que mirar

Nada de esto está hecho ni autorizado; queda apuntado para no empezar de
cero:

- **El hueco entre llamadas.** Si la contención es real, espaciar las
  llamadas cuando la anterior fue pesada podría salir más barato que
  solaparlas. Cuesta latencia: habría que medirlo antes de proponerlo.
- **Recolección de basura del worker.** Un pico de memoria tras 448 tokens
  es un candidato razonable. Con el tope de 180 esto debería **reducirse
  solo**, y eso es comprobable: si tras aplicar el tope los residuos de las
  frases vecinas bajan, era memoria.
- **La cola del transcriptor.** Hay que verificar si de verdad serializa o
  si deja entrar una segunda llamada antes de terminar la primera.

**El primer experimento es gratis:** la tanda de validación del tope ya nos
dice si los residuos bajan al desaparecer las alucinaciones largas.
