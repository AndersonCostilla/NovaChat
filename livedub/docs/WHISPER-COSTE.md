# Por qué la #13 costó 21 s — y qué se puede hacer

**8 de octubre de 2026.** Estado: **hipótesis con aritmética, pendiente de
medir en tu equipo. NO se ha tocado nada.**

---

## 1. El dato que no encajaba

| | |
|---|---|
| Whisper, mediana de la tanda | **4.310 ms** |
| Whisper en la #13 | **21.014 ms** |
| Audio de la #13 | **~9 s** |
| Oraciones devueltas | **90** |

Hasta ahora en este proyecto se venía repitiendo que **«Whisper es coste
mayormente fijo»**, porque `chunk_length_s: 30` hace que procese una ventana
de 30 s pase lo que pase. **Ese dato era correcto y aun así la conclusión era
incompleta**, y la #13 lo demuestra: si el coste fuera fijo, 90 oraciones
costarían lo mismo que una.

---

## 2. La explicación: son dos costes, no uno

Whisper tiene dos mitades que se comportan de forma opuesta:

| | qué hace | cómo escala |
|---|---|---|
| **encoder** | procesa la ventana de 30 s de audio | **FIJO** |
| **decoder** | genera los tokens del texto, uno a uno | **proporcional al texto** |

Con habla normal el texto es corto, el decoder apenas pesa, y **por eso todo
parecía fijo**. En un bucle de repetición el decoder se dispara y arrastra el
reloj.

### La aritmética, con los dos puntos que tenemos

Una frase inglesa de 12 s ronda los 230 caracteres ≈ **58 tokens**
(inglés, ~4 caracteres por token). La #13 devolvió 90 oraciones, que a ~5
tokens por oración son **~450 tokens**.

Y aquí hay una coincidencia que no parece casual: **el límite duro de Whisper
son 448 posiciones.** O sea que la #13 no se paró porque terminara — **se
paró porque chocó con el techo del modelo.**

Con los dos puntos:

```
  58 tokens →  4.310 ms
 448 tokens → 21.014 ms
 ─────────────────────────
 390 tokens → 16.704 ms   →  42,8 ms por token

 coste fijo = 4.310 − 58 × 42,8 ≈ 1.830 ms
```

**Encoder ≈ 1,8 s fijos. Decoder ≈ 43 ms por token.**

**Esto es un modelo de dos puntos, no una medición.** Con dos puntos siempre
sale una recta: eso no la hace cierta.

> ### ⚠ MEDIDO EL 9-OCT: ESTAS CIFRAS QUEDAN OBSOLETAS
>
> `costeWhisper()` corrido sobre datos reales de Anderson da
> **3.243 ms fijos + 9,92 ms por carácter, R² = 0,646.**
>
> La pendiente medida (9,92 ms/carácter ≈ 39,7 ms/token a 4 caracteres por
> token) casi coincide con los 42,8 estimados, así que la hipótesis se
> sostiene. **Pero el coste fijo real es casi el doble del estimado** y el
> R² dice que el texto explica sólo **dos tercios** de la variación.
>
> **Usa siempre las cifras medidas.** Lo de abajo se conserva como registro
> de cómo se llegó a la hipótesis, no como número válido.

---

## 3. Antes de proponer nada: medirlo. `livedub.costeWhisper()`

Ajusta una recta sobre **todas** las frases de la sesión (caracteres contra
milisegundos de Whisper), separa las dos partes y —esto es lo importante—
calcula el **R²**: cuánto de la variación del tiempo explica de verdad el
tamaño del texto.

```js
livedub.costeWhisper()
```

- **R² alto (> 0,6)** → el modelo se sostiene; el decoder es el que manda y
  un tope de texto serviría.
- **R² bajo** → el tamaño del texto **no** explica el tiempo, mi hipótesis es
  falsa y hay que buscar en otro sitio. Lo dice con esas palabras.

No hace falta tocar el transcriptor ni instrumentar nada nuevo: **los dos
datos ya estaban en la tabla**, sólo que nadie los había cruzado.

Hace falta **al menos una alucinación en la muestra**; si no, el extremo de
la recta no está representado y la pendiente no vale.

---

## 4. Las opciones, con lo que cuesta cada una

Todas tocan `transcriptor-worker.js`, que **está vetado**. Van como propuesta.

### A) `max_new_tokens` — la que recomendaría

Poner un techo al número de tokens que el decoder puede generar.

**Lo que ahorra**, con el modelo de arriba y un tope de 180 tokens:

```
MEDIDO:    3.243 + 720 car × 9,92 ≈ 10,4 s   en vez de los 18,7 s de la #22
(obsoleto: 1.830 + 180 tok × 42,8 ≈ 9,5 s   en vez de 21 s)
```

El ahorro real es de **8,3 s**, no de 11,5. Propuesta completa y trade-off
en [`PROPUESTA-MAX-TOKENS.md`](PROPUESTA-MAX-TOKENS.md).

**Lo que cuesta:** si una frase real necesitara más de 180 tokens, se
truncaría. ¿Puede pasar? 180 tokens son **~720 caracteres**, y una frase de
12,03 s a ritmo normal son **~230**. Es **tres veces** el máximo observado.
Para truncar habla real habría que hablar al triple de velocidad durante doce
segundos seguidos.

**Importante:** esto **acota el gasto, no evita la alucinación.** Seguiría
llegando basura, sólo que menos y más barata. El detector sigue haciendo
falta.

### B) `no_repeat_ngram_size` / `repetition_penalty` — las descartaría

Impedir que el modelo repita n-gramas, o penalizar lo ya dicho. Atacan el
bucle en su origen, que suena mejor.

**Pero dos proyectos distintos que han pasado por esto documentan lo mismo:
también borran repeticiones legítimas y tartamudeos reales.** Uno de ellos
las descartó explícitamente «porque romperían las citas textuales».

Eso es exactamente lo que me pediste no hacer: *«No implementar todavía
cambios que impliquen pérdida de habla real.»* **Son cambios que la implican
por diseño, y encima de forma invisible.** Las dejo fuera.

### C) `condition_on_previous_text: false` — no aplica

Es **el** arreglo clásico de los bucles de Whisper, y aquí **no sirve**:
cada frase se transcribe en una llamada independiente, sin arrastrar texto
anterior. Esa realimentación ya no existe en nuestro diseño.

### D) No tocar Whisper y seguir acotando aguas abajo — lo que hay hoy

**Coste:** 21 s de worker por cada alucinación grande. En la tanda de 64 eso
fue **una sola vez** y **no provocó ninguna cascada** — el resto de la tanda
salió limpia.

---

## 5. Lo que propongo, en orden

1. **Correr `livedub.costeWhisper()`** en la próxima tanda. Si el R² sale
   bajo, todo lo anterior se cae y mejor saberlo antes de tocar el worker.
2. **Si el R² sostiene el modelo**, decides tú si levantar el veto de
   `transcriptor-worker.js` para una sola línea: `max_new_tokens: 180`.
3. **Mientras tanto, nada.** Una alucinación cada 64 frases que cuesta 21 s y
   no arrastra a nadie es un problema mucho menor que el que teníamos.

**No voy a tocar el transcriptor sin que lo digas**, y tampoco lo propongo
como urgente: con la cascada atajada, los 21 s son caros pero no peligrosos.
