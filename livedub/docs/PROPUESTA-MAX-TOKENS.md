# Propuesta: `max_new_tokens` en Whisper

**9 de octubre de 2026.** Estado: **APLICADO** tras tres tandas.

> ### APLICADO el 9-oct-2026
>
> Tres tandas (1, 58 y **75** frases, la última con otro vídeo) con
> `probarTope(180)` limpio y **margen x3,3** sobre el habla real más larga.
> Autorizado por Anderson. En el código: `max_new_tokens: 180` y
> `TOPE_TOKENS_ASR = 180`.
>
> **Arregla una causa de dos.** La otra —frases cortas ralentizadas por una
> vecina pesada, tipo #11— sigue abierta en
> [`CONTENCION-WHISPER.md`](CONTENCION-WHISPER.md). **No esperes que
> desaparezcan todos los eventos de Whisper ≥16 s**, sólo los que vienen con
> texto masivo detrás.
>
> ### Cómo se llegó hasta aquí
>
> **Dos tandas confirmadas sin falsos positivos** (1 frase y 58 frases): las
> únicas frases que el tope habría tocado —#22, #29, #33— son alucinaciones
> **verificadas a mano** por Anderson.
>
> Él pide **una tercera muestra con otro vídeo** antes de tocar el
> transcriptor, y aplicarlo sólo si confirma. **Eso es una autorización
> condicionada, y aquí una autorización condicionada no es una
> autorización**: el código del transcriptor **no se toca hasta ver el
> resultado de la tanda 3**. Procedimiento en [`TANDA-3.md`](TANDA-3.md),
> evidencia acumulada en [`EVIDENCIA-TOPE.md`](EVIDENCIA-TOPE.md).
>
> El **aviso de truncamiento** sí está ya implementado y probado
> (`livedub.truncadas()`), inactivo hasta que haya tope.

---

## 1. Por qué vuelve a estar sobre la mesa

Tu `costeWhisper()` midió esto:

| | |
|---|---|
| Coste fijo del encoder | **3.243 ms** |
| Coste por carácter del decoder | **9,92 ms** |
| R² | **0,646** |

El modelo que propuse ayer con dos puntos se sostiene. **Pero el R² de 0,646
también dice algo que hay que leer:** el tamaño del texto explica alrededor
de **dos tercios** de la variación del tiempo de Whisper. **Un tercio viene
de otro sitio** y no sabemos de dónde. Un tope de tokens no lo va a tocar.

Eso no invalida la palanca; sí acota lo que puede prometer.

---

## 2. La aritmética, con tus números

> ### ⚠ EN CUARENTENA DESDE LA TANDA 4 (9-oct)
>
> **Todo lo que en esta sección sea una cifra de TIEMPO depende de los 9,92
> ms/carácter, y esa pendiente no se reprodujo:** en la tanda 4 salió 0,15
> ms/carácter con R² = 0. La tabla de abajo, el techo de «10,4 s» y el
> ahorro de «8,3 s» **son estimaciones inciertas**.
>
> **Lo que NO está en cuarentena:** la equivalencia 180 tokens ≈ 720
> caracteres, el resultado de `probarTope()` y el margen x3,3 — todo eso
> cuenta caracteres, no milisegundos. **La seguridad del tope no depende de
> la recta**, sólo su beneficio estimado. Por eso el tope no se revierte.
>
> Auditoría completa en [`COSTE-WHISPER-REVISION.md`](COSTE-WHISPER-REVISION.md).

Con 3.243 ms fijos y 9,92 ms por carácter, y ~4 caracteres por token en
inglés:

| tope | caracteres | Whisper en el peor caso | margen sobre una frase real de 12 s (230 car) |
|---|---|---|---|
| 80 tok | 320 | 6,4 s | ×1,4 — **demasiado justo** |
| 100 tok | 400 | 7,2 s | ×1,7 |
| 120 tok | 480 | 8,0 s | ×2,1 |
| 150 tok | 600 | 9,2 s | ×2,6 |
| **180 tok** | **720** | **10,4 s** | **×3,1** |
| 224 tok | 896 | 12,1 s | ×3,9 |
| *sin tope* | hasta 448 tok | *~21 s* | — |

Y la #22 de tu tanda, situada en esa escala:

```
18.667 ms  →  (18667 − 3243) ÷ 9,92 ≈ 1.555 caracteres ≈ 389 tokens
```

**Corrección de lo que te dije ayer.** Ayer estimé «de 21 s a 9,5 s» con un
modelo de dos puntos. Con tus medidas reales el número es **de 18,7 s a
10,4 s: se ahorran 8,3 s, no 11,5.** Sigue siendo la mitad, pero la cifra
buena es la de hoy.

---

## 3. El punto 1 de tu encargo: ¿cortaría habla real?

**No lo puedo contestar yo: hay que mirarlo en tus datos.** Lo que he hecho
es dejar la herramienta que lo contesta.

```js
livedub.probarTope()        // prueba 180 tokens
livedub.probarTope(120)     // o el que quieras
```

Recorre todas las frases de la sesión, traduce el tope a caracteres y enseña
**una por una** las que se habrían cortado, con esta columna al final:

| `¿el detector la vio rara?` | qué significa |
|---|---|
| `sí (alucinación)` | el tope habría cortado basura. Bien. |
| `⚠ NO — ¿habla real?` | **el tope habría cortado algo que el detector consideró normal.** |

**Si aparece una sola fila con el aviso, el tope no es seguro y no se
aplica.** Y aunque salgan cero, el informe te da el dato que de verdad
importa:

```
frase más larga NO sospechosa: #7: 249 caracteres ≈ 62 tokens
                               (margen hasta el tope: x2.9)
```

Ese margen es lo que hay entre el habla real más extrema que has grabado y el
cuchillo. **Córrelo sobre las tandas que ya tienes** antes de decidir.

### Lo que yo sí puedo decir, que es sólo un argumento físico

230 caracteres es lo que da una frase de 12,03 s —el tope del VAD— a ritmo
normal. 720 caracteres en esos mismos 12,03 s serían **60 caracteres por
segundo sostenidos**, el triple de lo que habla una persona. Para que el tope
de 180 cortase habla real haría falta eso.

**Pero es un argumento, no una medición**, y ya me ha pasado esta semana que
un argumento impecable escondiera un dato mal pasado. Por eso la herramienta.

---

## 4. El trade-off, explícito

### Qué se gana

- **Techo duro al peor caso de Whisper: ~10,4 s en vez de ~18,7 s.** Y lo
  importante no es el ahorro medio —en una tanda de 64 frases esto actúa
  una vez— sino que **el peor caso deja de ser indefinido**.
- Menos tiempo de worker ocupado ⇒ menos probabilidad de desbordar la cola
  siguiente, que es el mecanismo que te tiró la #23.
- Menos texto alucinado llegando al traductor y al detector.

### Qué se arriesga

- **Una frase real inusualmente larga y densa se cortaría a mitad**, y se
  cortaría **a mitad de palabra**, porque el corte es por tokens y no sabe de
  oraciones. No es como el recorte del detector, que quita oraciones enteras.
- **El usuario no se enteraría** salvo que lo instrumentemos. Si se aplica,
  hay que añadir el aviso: si la transcripción termina exactamente en el tope,
  marcarla y contarla como pérdida.
- **No arregla la alucinación**, sólo le pone precio máximo. El detector
  sigue haciendo falta igual.
- **No toca el tercio de variación que el R² no explica.**

### Lo que NO entra, y por qué

`no_repeat_ngram_size` y `repetition_penalty` siguen descartados: **borran
repeticiones y tartamudeos legítimos por diseño, y de forma invisible.**

---

## 4 bis. El cambio exacto, para que no haya sorpresas

Son dos líneas, en dos archivos, y nada más:

```js
// transcriptor-worker.js, en las opciones de la llamada al pipeline
max_new_tokens: 180,
```

```js
// offscreen.js — el mismo número, o el aviso mide contra un borde falso
const TOPE_TOKENS_ASR = 180;
```

No se toca el troceado, ni el VAD, ni `chunk_length_s`, ni nada del audio.
Revertirlo es borrar esas dos líneas.

## 5. Lo que pido

1. Corre **`livedub.probarTope(180)`** sobre tus tandas.
2. Si sale **`SÍ — seguro`** y el margen de la frase real más larga te parece
   suficiente, **dímelo explícitamente** y aplico una línea en
   `transcriptor-worker.js` más el aviso de truncamiento.
3. Si sale **`NO`**, me pasas las filas y bajamos o descartamos.

**No lo toco sin eso.** Y si lo aplicamos, hay que repetir la tanda de
validación entera con `informeTanda()` + `costeWhisper()`, porque cambiar el
transcriptor invalida la validación anterior.
