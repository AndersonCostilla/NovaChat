# «21 frases desaparecieron sin que ningún contador las recogiera»

**8 de octubre de 2026.** Estado: **causa encontrada, arreglada y verificada.**

---

## 1. El aviso era correcto; el dedo señalaba al sitio equivocado

`perdidas()` te dijo que 21 frases se habían esfumado sin que nadie las
contara. Eso suena a fuga silenciosa en la tubería, que es exactamente lo que
más nos importa cazar.

**No era una fuga. Era el verificador.**

---

## 2. La aritmética

En `cronometro.js` había dos estructuras que no estaban de acuerdo:

| Estructura | Comportamiento |
|---|---|
| `historial` | tabla de frases terminadas, **con tope `MAX_FRASES = 40`**; al llenarse hace `shift()` y tira la más vieja |
| `idsVistos` | conjunto de todos los ids que han pasado alguna vez, **sin tope** |

La verificación cruzada restaba uno de otro. Así que **cada frase expulsada
de la tabla por vieja aparecía como desaparecida**, aunque se hubiera doblado
perfectamente.

Tu tanda tenía **61 frases**:

```
61 vistas − 40 que caben en la tabla = 21 «sin explicar»
```

Reproducido en el sandbox con 55, 60, 61 y 65 frases, **todas dobladas y
ninguna perdida de verdad**: dan 15, 20, **21** y 25. El 21 sale exacto.

---

## 3. El arreglo

1. **`MAX_FRASES` 40 → 200.** El 40 era corto por otra razón: una tanda de
   cinco minutos (60-70 frases) perdía de vista su primera mitad, así que las
   medianas que mirabas **sólo describían el final de la sesión**.
2. **`Set idsRetirados`**: anota cada id que sale de la tabla por antigüedad.
3. **`faltan` los excluye**, y la verificación gana una fila nueva:
   `'frases retiradas de la tabla por antigüedad'`.
4. **`idsRetirados.clear()`** en `reiniciar()`.

## 4. Verificado por ejecución, no por lectura

- 61 frases, cero pérdidas reales → **«SÍ — todas las frases están explicadas»**
- 250 frases, cero pérdidas reales → **«SÍ»**, 50 retiradas por antigüedad
- 250 frases + un salto de numeración (251-299) → **«NO»**, 49 ids sin
  explicar. **Las fugas de verdad se siguen viendo.**

Las cuatro quedan como comprobaciones de regresión en
`tests/test-cronometro.mjs` (75 pasadas, 0 fallidas).

---

## 5. Hipótesis descartada

Pensaste que podían ser **ids intermedios generados por el lote-con-
continuación**. No: con ids perfectamente consecutivos y sin ninguna pérdida
el fallo se reproduce igual. El lote-con-continuación no tiene nada que ver.

## 6. La lección, para que no vuelva

**Todo contador acumulativo que se compare contra una estructura con tope
tiene que anotar las bajas por antigüedad.** Si no, el propio instrumento
fabrica el problema que dice estar midiendo.

Y conviene subrayar lo que esto implica para los datos de esa sesión: las
pérdidas que `perdidas()` te reportó **por etapa** (cola de voz, traducción,
etc.) seguían siendo reales — esas se cuentan en el momento, no por resta.
Lo único inventado era el residuo «sin explicar».
