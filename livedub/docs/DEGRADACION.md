# La degradación con el tiempo — lo que sé, lo que no, y cómo averiguarlo

**8 de octubre de 2026, tarde.** Estado: **sin resolver. Instrumentado, no diagnosticado.**

> «Después de un tiempo empieza a hacer así.»

Esto es lo honesto: **no sé por qué**, y no lo voy a saber sin datos de tu
equipo. Lo que sí puedo hacer es acotar las hipótesis y dejar hecho el
instrumento que las separa. Este documento es eso, no una respuesta.

---

## 1. El dato que hay

| | Habitual | En el tramo malo |
|---|---|---|
| Whisper | 3-5 s | **16-25 s** |
| Traducción #3 | ~2 s | **30002 ms → tiempo agotado** |
| Pérdidas | 7,1 % estructural | **16 de 34 = 47,1 %** |

**El testigo que importa es Whisper, y es un testigo limpio.** Su coste es
**mayormente fijo**: `chunk_length_s: 30`, así que rellena hasta 30 s de
audio pase lo que pase y procesa prácticamente el mismo trabajo tanto si la
frase dura 3 s como si dura 12. Esto ya estaba medido (hallazgo 3).

Conclusión que **sí** se puede sacar sin más datos: **el aumento x4-x5 de
Whisper no se explica porque las frases se hicieran más largas.** El trabajo
de entrada era el mismo. Lo que se degradó fue la máquina, o lo que la rodea.

---

## 2. Las hipótesis, y cuál me parece más probable

### A) Contención de CPU — *la que más me cuadra*

Durante ese tramo, el worker del traductor estuvo **30 segundos seguidos
dentro de un `generate()`** quemando su núcleo, y la cola de voz estaba
ocupada. ONNX corre con `numThreads = 1`, pero eso limita los hilos **de cada
worker**, no el número de workers compitiendo.

Lo incómodo de esta hipótesis es que **invierte la causalidad que diste por
supuesta**: puede que la degradación de Whisper no sea la causa del timeout
de #3, sino **su consecuencia** — o que se realimenten. Whisper va lento
porque el traductor le está comiendo la CPU; la traducción tarda más porque
Whisper le está comiendo la CPU; y cada frase que se retrasa deja menos hueco
a la siguiente. Eso es una espiral, y las espirales **parecen** degradación
gradual aunque no haya ninguna fuga.

A favor: explica que empiece «después de un tiempo» sin que nada crezca de
verdad — basta con un evento malo para entrar en la espiral, y el atraso
acumulado (+1,32 s/frase ya medidos) hace que entrar sea cada vez más fácil.

**Si esta es la causa, el arreglo del punto 1 de este mismo encargo ya ataja
buena parte**: el peor caso de un worker bloqueado baja de 32 s a 12 s.

### B) Fuga de memoria en los workers

Busqué conjuntos y mapas que sólo crezcan. **Encontré uno, y lo he
arreglado**: el `Set cancelados` de `traductor-worker.js` y
`sintetizador-worker.js`. Si una cancelación llega cuando la frase ya había
terminado, nadie borra ese id jamás. Ahora se acota a las últimas 200.

**Pero seamos honestos: eso no explica un x4.** Son unos pocos enteros por
hora. Lo arreglo porque un conjunto que sólo crece en un worker que vive
horas no se deja pasar, no porque crea que es la causa.

No he encontrado ninguna otra estructura que crezca sin tope en los workers.

### C) El modelo de traducción no libera memoria entre llamadas

`transformers.js` reutiliza la misma sesión ONNX entre llamadas, que es lo
deseable. Lo que **no** puedo descartar desde aquí es la fragmentación del
heap de WASM a lo largo de cientos de `generate()`. **Esto no se puede
revisar leyendo código: hay que mirarlo correr.**

### D) Térmico / el propio Chrome

Un portátil que lleva diez minutos con dos workers al 100 % baja frecuencia.
Esto **no es un bug nuestro** y no tiene arreglo en el código, pero si es la
causa hay que saberlo y decirlo, no seguir buscando fugas inexistentes.

---

## 3. El instrumento: `livedub.deriva()`

En la consola de `offscreen.html`, al final de una tanda:

```js
livedub.deriva()
```

Parte la sesión en **tres tercios por orden de llegada** y compara las
medianas de cada uno:

| columna | para qué |
|---|---|
| `duración frase mediana (s)` | ¿creció el trabajo de entrada? |
| `trozos MT mediana` | ¿creció el trabajo del traductor? |
| `Whisper mediana (ms)` | **el testigo limpio** |
| `traducción mediana (ms)` | |
| `grupo MT más caro (ms)` | cuánto estuvo el worker ciego, como mucho |
| `pérdidas` | |

Y da un veredicto:

- **x1,0 - x1,3 →** no hay deriva. Lo de tu sesión fue **un evento**, no un
  desgaste, y hay que buscar el disparador (probablemente la #3).
- **más de x1,3 con las frases igual de largas →** hay degradación de verdad.
- **más de x1,3 pero las frases también se alargaron →** parte del aumento es
  trabajo de más, no degradación. No confundirlos.

**Esto sólo se puede medir desde hoy.** Con el tope anterior de 40 frases, el
primer tercio de una tanda larga ya se había borrado cuando ibas a mirarlo:
el arreglo del contador de esta mañana es lo que hace posible esta pregunta.

También tienes ahora, por frase, **`grupo MT más caro (ms)`** en
`latenciaTexto()`, y en la consola del worker una línea por grupo:

```
[LiveDub][traductor-worker] frase #3: grupo 2 (trozos 4-6 de 12) 11840 ms,
3947 ms/trozo, acumulado 23700 ms.
```

Con el total solo no se podía saber si 30 s eran diez grupos normales o uno
atascado. Ahora sí, y son arreglos distintos.

---

## 4. Lo que propongo, y lo que NO voy a hacer todavía

**No voy a implementar el reinicio periódico del worker.** Lo has planteado y
es una opción razonable, pero hoy sería **tratar un síntoma que aún no sé si
existe**. Y no es barato:

- recargar el modelo son **113 MB** y varios segundos de tubería parada;
- hacerlo cada N traducciones mete un **bache garantizado y periódico** a
  cambio de evitar un bache hipotético;
- si la causa es contención (hipótesis A), **el reinicio la empeora**: añade
  una carga pesada justo cuando el sistema ya va apurado.

**El orden que propongo:**

1. Una tanda de 5 minutos con el código de hoy → `livedub.deriva()`.
2. Si el veredicto es **«no hay deriva»**: el problema era el evento de #3 y
   el arreglo de los grupos; se cierra aquí.
3. Si es **«sí hay deriva»**: mirar `grupo MT más caro` por tercios. Si lo que
   crece es el coste por grupo con el mismo número de trozos, es el modelo o
   la máquina (C o D); si sólo crece cuando hay solapamiento, es contención (A).
4. **Sólo entonces** decidir si el reinicio preventivo compensa — y con qué N,
   que también habría que medir en vez de elegirlo.

Si resulta ser térmico o del propio Chrome, lo diré así: **hay un suelo que no
depende de nosotros**, en vez de inventar una optimización cosmética.
