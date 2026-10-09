# Los cinco cortes de la tanda de 64 frases

**8 de octubre de 2026.** Estado: **causa encontrada y corregida. El detector
sigue SIN validar.**

---

## 1. Lo que pasó

| | oraciones | ¿de verdad era una alucinación? |
|---|---|---|
| #13 | 90 → 6 | sí, casi con seguridad |
| #31 | 3 → 3 | **no** |
| #33 | 2 → 2 | **no** |
| #51 | 1 → 1 | **no** |
| #59 | 5 → 5 | **no** |

Cuatro de los cinco **no deberían haber salido en esa lista**, y además
contaban como pérdida.

Tenías razón en las dos sospechas que planteaste, y había una tercera que no
estaba sobre la mesa.

---

## 2. La causa de fondo: le pasaba el dato equivocado al detector

```js
// offscreen.js — lo que había
analizarTrozos(trozos, { segundosAudio: duracionMs / 1000 });
```

```js
// transcriptor-worker.js — lo que es duracionMs en realidad
duracionMs: Math.round(performance.now() - inicio)
```

**`duracionMs` es lo que tardó Whisper en transcribir, no lo que dura el
audio.** En esta tanda su mediana fue **4,31 s**, mientras que una frase de
audio llega hasta **12,03 s**.

El criterio que añadí el día anterior —«¿cuántos segundos de voz salen de
este texto, comparados con lo que duró el audio?»— **estaba dividiendo por un
número unas tres veces más pequeño de lo que debía**. Resultado: una frase
normal, que habla a 1,11× su propia duración, aparentaba más de 3× y saltaba
el aviso.

**Reproducido exactamente** en `tests/test-detector-alucinacion.mjs` con una
frase de control del tamaño de una real de 12 s (~230 caracteres):

| duración que se le pasa | proporción | ¿sospechosa? |
|---|---|---|
| 12,03 s (la buena) | 1,23× | **no** |
| 4,31 s (la de Whisper) | 3,44× | **sí** ← el falso positivo |

**Corregido.** El dato bueno entra por el VAD y lo guarda el cronómetro; ahora
se pide con `cronometro.segundosAudioDe(id)`. Y si no está, **no se inventa**:
los criterios que dependen del tiempo se callan.

Es un error mío de los que más rabia dan: la lógica era correcta y la
aritmética también; lo que estaba mal era **qué número entraba**. Las pruebas
que escribí pasaban porque yo mismo les daba la duración correcta a mano.

---

## 3. El segundo fallo: contar pérdidas que no existieron

Aparte de lo anterior, la contabilidad estaba mal por su cuenta:

```js
if (diagnostico.esSospechosa) {
  ...
  registrarPerdida({ ... });   // ← SIEMPRE, hubiera cambiado algo o no
}
```

Bastaba con que una frase fuera **sospechosa** para apuntarle una pérdida,
**aunque el saneado no le quitara ni un carácter**. Que es justo lo que
pasó con #31, #33, #51 y #59: el aviso está en 3× pero el corte en 4×, así
que se marcaron y **salieron enteras por el altavoz**.

**Corregido:** la pérdida se apunta sólo si `quitadosCaracteres > 0 ||
quitadasOraciones > 0`.

---

## 4. La tercera, que tú señalaste y yo no estaba midiendo

> «No asumir que conservar el número de oraciones significa conservar todo el
> contenido.»

Exacto, y era un agujero real: la **desduplicación interna** quita palabras
**dentro** de una oración, así que una frase podía salir como `1 → 1` después
de perder media. La tabla no lo enseñaba.

**Corregido:** `cortes()` mide ahora en **caracteres**, no sólo en oraciones:

```
oraciones: 1 → 1        ← esto puede mentir
caracteres: 412 → 118   ← esto no
```

### Y, buscando ese agujero, encontré un falso positivo más

El criterio de repetición interna marcaba cualquier bloque de **una palabra**
repetido cuatro veces. Eso es **habla humana corriente**:

```
"very very very very good"    "no no no no no"    "ha ha ha ha"    "I I I think so"
```

Un bucle de Whisper repite **frases**, no palabras sueltas. Así que ahora:

- con bloques de 1 palabra hacen falta **más de 8** repeticiones;
- y en todos los casos el bloque repetido tiene que cubrir **al menos el
  60 %** del trozo. Un tartamudeo dentro de una oración larga es habla.

Comprobado sobre nueve muestras, cinco legítimas y cuatro patológicas.

---

## 5. Las cuatro categorías, separadas

`livedub.cortes()` ya no da un número único. Da esto:

| tipo | ¿puede ser contenido real? |
|---|---|
| **1 · alucinación eliminada** (repeticiones idénticas) | **NO** — lo quitado es idéntico a lo que queda |
| **2 · texto recortado parcialmente** (tope de cantidad o duración) | **SÍ — hay que leerlo** |
| **3 · sospechosa conservada íntegra** | no se tocó; **no cuenta como pérdida** |
| **4 · contenido legítimo perdido** | lo rellenas tú al revisar el tipo 2 |

La fila 4 **el programa no la puede rellenar**. Sólo se sabe leyendo, y por
eso sigue ahí en vez de desaparecer de la tabla.

Con esta separación, la tanda de 64 frases se habría leído así: **1 del tipo
1** (la #13) y **4 del tipo 3** — cero pérdida real, en vez de «5 cortes y 5
pérdidas».

---

## 6. Lo que esto significa para la validación

**El detector sigue sin validar, y ahora con más motivo.** La tanda de 64
frases no sirve como validación: cuatro de sus cinco cortes eran artefactos
de un bug. Hay que repetirla con el código corregido.

Lo que sí quedó demostrado de esa tanda, y es mucho:

- **sin timeouts de traducción de 30-45 s** (el arreglo de los grupos de 3 +
  predicción funcionó);
- **sin deriva** (×0,92);
- Whisper **4,31 s** y traducción **1,75 s** de mediana.
