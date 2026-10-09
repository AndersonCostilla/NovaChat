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

---

## 5. Addendum (8-oct, noche): por qué la cascada no se drena sola

Pediste evaluar un **«vaciado rápido»**: tirar varias frases antiguas de
golpe en vez de una por una. **Lo he evaluado y la respuesta es que no sirve
— y conviene ver por qué, porque el motivo señala el arreglo correcto.**

**La cola de voz ya está topada en 2** (`VOZ_SISTEMA.MAX_EN_COLA`) y ya tira
la **más antigua** en cuanto se pasa. Es decir: **ya se queda siempre con lo
más reciente**. El goteo de pérdidas de #24 a #34 no es una cola que se
vacía despacio; es **una cola que no puede avanzar** porque el altavoz lleva
92 segundos ocupado por una sola frase.

Vaciar más deprisa **descarta más contenido y no devuelve el altavoz ni un
segundo antes**. Simulado en `tests/test-tope-voz.mjs`: con una locución de
92 s y una frase nueva cada 6 s, bajar el tope de la cola pierde igual o más;
acortar la locución a 48 s es lo único que reduce la cascada.

**El cuello de botella es la locución en vuelo, no la profundidad de la cola.**

### Y aquí hay una asimetría que merece la pena subrayar

Tienes toda la razón en que lo del traductor es **un límite arquitectónico**:
`generate()` no se puede interrumpir y ningún timeout lo va a arreglar — la
#59 tardó 44.953 ms *con la cancelación ya pedida*. Lo único que se puede
hacer ahí es **no entrar** en trabajo que no quepa, que es lo del encargo
anterior.

**Pero la voz no es así.** La frase se trocea a 180 caracteres y entre trozo
y trozo **sí hay un punto de interrupción real**. Ahí sí se puede parar.

Lo que faltaba es que **el vigilante existente es POR TROZO, no por frase**:
cada fragmento de 180 caracteres terminaba puntualmente, así que el vigilante
nunca tenía motivo para saltar mientras la frase entera se comía 92 segundos.

**Mecanismo implementado** (`VOZ_SISTEMA.TOPE_OCUPACION`): un presupuesto
**por frase**, comprobado entre fragmento y fragmento.

- Tope = **4×** la duración del audio original, nunca menos de **10 s**.
- **Sólo corta si hay alguien esperando.** Una frase larga que no bloquea a
  nadie no hace daño a nadie, y cortarla sería perder contenido a cambio de
  nada.
- La #23 se habría cortado a los ~48 s en vez de a los 92.

**Arranca APAGADO** (`livedub.toparVozLarga(true)`). No lo enciendo yo: es un
segundo mecanismo que descarta contenido y pediste evaluarlo, no activarlo.
Mi recomendación es **probarlo en una tanda aparte**, después de la del tope
de alucinaciones — si enciendes los dos a la vez y mejora, no sabrás cuál fue.

---

## Corrección del 9 de octubre: el control estaba mal elegido

`deriva()` comparaba los tercios de la sesión usando **la duración del audio**
como control de «mismo trabajo de entrada». Era lo razonable antes de medir.

**`costeWhisper()` demostró que ese control es el equivocado.** El reloj de
Whisper lo mueven los **caracteres de salida** (9,92 ms cada uno), no los
segundos de entrada. Dos tercios con frases de la misma duración pueden
contener textos muy distintos: **frases igual de largas, el triple de texto,
el triple de tiempo — y ni una pizca de degradación.**

Por eso el «x1,38 sobre el mismo trabajo» de la tanda del 9-oct **no
significa lo que parece**.

### Qué hace ahora

`deriva()` añade dos columnas:

| columna | qué es |
|---|---|
| `caracteres mediana` | el trabajo real de entrada del tercio |
| `Whisper normalizado` | observado ÷ predicho por el ajuste de la sesión |

**El que manda es `Whisper normalizado`.** Si se mantiene plano mientras el
bruto sube, no hay degradación: creció el texto. Si sube el normalizado, la
máquina se está degradando de verdad.

Verificado con cuatro sesiones sintéticas construidas sobre las cifras
medidas: textos crecientes con máquina estable dan *«x1,35 en bruto, pero x1
descontando el texto»*; una degradación real de x1,5 sigue saliendo `SÍ`.

### Y los eventos catastróficos

Una sola frase de 18,7 s dentro del último tercio arrastra la mediana. Por eso:

```js
livedub.deriva()                    // incluye la fila "¿y sin los eventos catastróficos?"
livedub.deriva({ sinEventos: true }) // los excluye del todo
```

**Si la deriva desaparece al quitar los eventos, lo que tienes no es
degradación: es la #22.**

### Límite honesto

Si la sesión no trae recuento de caracteres no se puede normalizar. En ese
caso el veredicto sale como **«SÍ (con reservas)»** y lo dice: se está usando
el control peor. No se presenta como seguro algo que no lo es.
