# Propuesta: arreglar `detectarIdioma()`

**PROPUESTA. No se ha tocado ni una línea de `detector-idioma.js`.**

---

## El fallo, en una frase

La heurística **exige evidencia positiva de que el texto es inglés**. Si no
encuentra ninguna de sus 17 palabras, devuelve «idioma no identificado» y la
frase no se traduce ni se dobla:

```js
if (mejorPuntos === 0) {
  return { idioma: 'desconocido', esIngles: false, confianza: 0 };
}
```

**El problema no es que la lista sea corta: es la dirección de la prueba.**
Se está pidiendo demostrar que algo es inglés, en un producto cuyo único
caso de uso declarado es traducir inglés. La carga de la prueba está del
revés.

---

## Antes de las opciones: la vía ideal sigue cerrada (verificado hoy)

Lo correcto sería **preguntarle a Whisper**, que ya detecta el idioma
internamente. Revisé el bundle vendorizado (`libs/transformers/`) en vez de
fiarme del comentario que había en el código:

| Busqué | Resultado |
|---|---|
| `detected_language` | 0 apariciones |
| `lang_to_id` | 0 apariciones |
| Lo que devuelve el pipeline ASR | `{ text, chunks? }` — sin idioma |
| `language code "…" detected` | **existe, pero es del tokenizador de NLLB**, no del ASR |

Sí existen `skip_special_tokens` y `forced_decoder_ids` en el bundle, así
que **en teoría** se podría recuperar el token `<|en|>` que Whisper emite al
principio. Pero el pipeline no lo expone, habría que trastear dentro del
worker y **no sé si funciona**. Lo dejo como opción D, marcada como no
verificada.

---

## Las opciones

### A. Ampliar la lista de palabras

Pasar de 17 a ~100 palabras frecuentes del inglés.

| | |
|---|---|
| **Se gana** | Menos falsos «desconocido» en frases de longitud normal. |
| **Riesgo nuevo** | Más colisiones con otros idiomas: `no`, `son`, `a`, `me`, `as`, `is`, `me` existen en español, francés o italiano. La detección de «esto NO es inglés» empeora. |
| **Coste** | ~20 líneas. Cero riesgo estructural. |
| **Lo que NO arregla** | **El caso real que te falló.** «Absolutely incredible.» no tiene ninguna palabra frecuente ni en una lista de 17 ni en una de 100. Las frases cortas seguirían cayéndose. |

**Mi lectura: es un parche que no toca la causa.** Reduce la frecuencia del
fallo sin eliminarlo.

### B. Invertir la carga de la prueba ← **la que recomiendo**

Traducir **salvo que haya evidencia positiva de OTRO idioma**. La heurística
pasa de «¿es inglés?» a «¿hay pruebas de que no lo es?».

```
si (hay acentos marcados O ganan claramente las pistas de otro idioma)
    → no traducir, avisar
si no
    → traducir
```

| | |
|---|---|
| **Se gana** | Desaparece el fallo exacto que viste. «Absolutely incredible.» se traduce, porque no hay nada que indique otro idioma. |
| **Se conserva** | La protección contra vídeos en francés o alemán, que es para lo que se escribió la heurística: ésos sí disparan acentos y palabras propias. |
| **Riesgo nuevo 1** | Un vídeo en un idioma latino **sin acentos y con frases cortas** podría colarse y salir traducido a basura. Riesgo bajo y, sobre todo, **el usuario ya tiene el selector manual** para ese caso. |
| **Riesgo nuevo 2** | **Las alucinaciones de Whisper se traducirían.** Sobre música o silencio, Whisper tiende a inventar («Thank you.», «Subtitles by…»). Hoy muchas de ésas se caen por no tener palabras frecuentes; con la opción B se doblarían. **Es un riesgo real y lo pongo sobre la mesa en vez de esconderlo.** |
| **Coste** | ~30 líneas, dentro del mismo archivo. |

El riesgo 2 se puede acotar con un filtro aparte de frases sospechosas
(muy cortas y repetidas), pero eso es otra tarea y no la mezclaría con ésta.

### C. Eliminar la detección y asumir siempre inglés

| | |
|---|---|
| **Se gana** | Simplicidad máxima. Cero falsos negativos. |
| **Riesgo nuevo** | Con un vídeo en francés y el selector en «Automático», **todas** las frases saldrían traducidas a basura, sin ningún aviso. |
| **Problema añadido** | La opción «Detectar automáticamente» del popup pasaría a ser mentira. Habría que quitarla, y eso es tocar la interfaz. |
| **Y además** | Implica borrar `detector-idioma.js`, su suite y la heurística que verificaste en la Fase 4. **No borro nada sin que me lo digas explícitamente.** |

**Mi lectura: resuelve el síntoma rompiendo una función que ya funcionaba
para lo suyo.** La opción B da el mismo resultado práctico conservándola.

### D. Preguntarle a Whisper (no verificada)

| | |
|---|---|
| **Se gana** | Sería la solución correcta: detección real, no una cuenta de palabras. |
| **Riesgo** | **No sé si se puede con el bundle vendorizado.** Habría que experimentar dentro del worker, y toca `transcriptor-worker.js`, que es código que me pediste no mover. |
| **Coste** | Desconocido. Entre media hora y «no se puede». |

No la recomiendo **ahora**, pero la dejo escrita porque si algún día se
actualiza transformers.js sería la buena.

---

## Resumen

| | Arregla tu fallo | Riesgo nuevo | Toca otros archivos |
|---|---|---|---|
| A. Más palabras | **no, sólo lo reduce** | colisiones entre idiomas | no |
| **B. Invertir la prueba** | **sí** | alucinaciones traducidas | no |
| C. Quitar la detección | sí | vídeos no ingleses sin aviso | popup, borrar archivos |
| D. Preguntar a Whisper | sí | no se sabe si es posible | worker |

**Recomiendo B.** Es la que ataca la causa (la dirección de la prueba),
conserva lo que ya funcionaba, no borra nada y no toca más archivos.

**No la implemento hasta que me lo digas.** Y si eliges B, el riesgo de las
alucinaciones de Whisper es un compromiso que te pido aceptar por
adelantado, no algo que descubras después.

---

## Mientras decides

**Pon el selector en «Inglés».** Salta la heurística por completo y el fallo
desaparece sin tocar nada. Es también lo que hay que hacer para la medición
del paso siguiente, para que los datos no se contaminen con frases que se
caen por este motivo.
