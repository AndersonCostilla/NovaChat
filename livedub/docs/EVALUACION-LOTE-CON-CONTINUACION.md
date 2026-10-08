# Evaluación: tope de trozos **con continuación**

**Fecha:** 8-oct-2026 · **Nada de esto está implementado.** Es la respuesta al encargo
de evaluar la tercera opción antes de plantear ninguna elección.

> La propuesta de Anderson, literal: *«si un lote excede, por ejemplo, 8-10 trozos,
> traducir solo los primeros N en esta vuelta (con el timeout normal) y reencolar el
> resto para la siguiente vuelta»*.

**Veredicto: viable, y es mejor que las dos opciones que yo había planteado.**
Con un matiz importante sobre el "reencolar", y con un hallazgo que no era evidente
y que habría hecho fracasar la implementación ingenua.

---

## 1. El hallazgo que cambia la implementación

La idea depende de que, al partir el lote, el worker pueda **enterarse** de que le
han mandado `CANCELAR` a mitad de camino. Eso no pasa solo.

Los mensajes que llegan a un worker son **macrotareas**. `await` sobre una promesa
ya resuelta drena **microtareas**. Partir el lote en cinco llamadas a `generate()`
con `await` entre ellas **no entrega el `CANCELAR`**: el worker sigue ciego y el
rescate de 20 s se dispararía igual.

Comprobado en `tests/test-lote-continuacion.mjs`, apartado A:

```
A) bucle con await a secas:     5 grupos ejecutados -> el CANCELAR NO se atendió
B) cediendo el turno:           abandonado en el grupo 1
```

La diferencia es **una línea** entre grupo y grupo:

```js
await new Promise((r) => setTimeout(r, 0));  // ceder el turno al bucle de eventos
```

Sin ella, toda la idea no sirve de nada y parecería implementada. Lo dejo escrito
porque es exactamente el tipo de cosa que da un verde falso.

---

## 2. El matiz: **reencolar al final desordena el doblaje**

«La siguiente vuelta» admite dos lecturas, y sólo una funciona.

| Dónde vuelve el resto | Qué oye el espectador |
|---|---|
| Al **final** de la cola (lectura literal) | `4.1` → `5` → `6` → **`4.2`** · media frase, dos frases, y el final de la primera |
| Al **principio** de la cola | `4.1` → `4.2` → `5` → `6` · orden correcto |

Comprobado en el test, apartado C. Reencolar al final rompe la secuencia del vídeo,
y eso es peor que una pérdida limpia: una pérdida se nota como un hueco, un
desorden se nota como que el doblaje dice cosas que no tocan.

Y aquí está lo útil: **reencolar al principio es, exactamente, un bucle dentro del
worker.** Si el resto siempre vuelve a la cabeza de la cola, no hace falta ninguna
cola nueva, ni un protocolo de partes, ni ids compuestos. Basta con un `for` sobre
los grupos dentro de `traducir()`.

Eso reduce muchísimo el coste de la opción, y es por lo que la recomiendo.

---

## 3. Qué se gana, con números

Simulado en el test, apartado B, con la alucinación real de 40 trozos y el coste
que implica lo observado (~1 s por trozo):

| | Hoy (lote entero) | Con grupos de 8 |
|---|---|---|
| Trozos traducidos al vencer los 30 s | **0 de 40** | **32 de 40 (80 %)** |
| Worker ocupado | **50 s** (30 de espera + 20 de rescate) | **32 s**, y libre al instante |
| Peor espera para poder abandonar | 50 s | **8 s** (lo que dura un grupo) |
| ¿Se reinicia el worker? | **Sí**, y recarga 113 MB | **No** |
| ¿Se vacía la cola de golpe? | **Sí** → #7, #8, #9 | **No** |
| Habla normal (1-2 trozos) | 1 lote | **1 grupo: idéntico** |

Lo decisivo no es el 80 % recuperado. Es que **el peor caso del worker pasa de 50 s
a 8 s**, y con eso desaparece la cascada entera: sin reinicio no hay recarga del
modelo, sin recarga no hay desbordamiento de la cola, y sin la ráfaga de
traducciones liberadas a la vez no revienta la cola de voz.

---

## 4. ¿Es viable con la arquitectura actual?

**Sí.** Cambia **una función de un archivo**: `traducir()` en `traductor-worker.js`.
`traductor.js` no cambia, la cola no cambia, el protocolo de mensajes no cambia.

Hoy:

```js
const salida = await modelo(entradas, { max_new_tokens: maxTokens, num_beams: NUM_BEAMS });
```

Sería:

```js
const lista = [];
for (let i = 0; i < entradas.length; i += TROZOS_POR_GRUPO) {
  if (estaCancelado(id)) break;                 // ahora SÍ se entera
  const grupo = entradas.slice(i, i + TROZOS_POR_GRUPO);
  const parte = await modelo(grupo, { max_new_tokens: maxTokens, num_beams: NUM_BEAMS });
  lista.push(...(Array.isArray(parte) ? parte : [parte]));
  await new Promise((r) => setTimeout(r, 0));   // ceder el turno (apartado 1)
}
```

**Unas 10 líneas.** El resto de `traducir()` (proteger, restaurar, unir) ya funciona
sobre arrays y no se entera.

### Lo que sí hay que decidir, y no decido yo

**Una traducción incompleta no se puede entregar en silencio.** La regla del proyecto
es que no hay continuidad a base de omitir contenido sin avisar. Así que la parte que
no es gratis es ésta: cuando se abandone a mitad, el worker tiene que devolver lo
traducido **marcado como parcial**, y eso tiene que llegar al subtítulo y al contador
de pérdidas como "frase doblada a medias", que es una categoría nueva. Son otras
~20 líneas repartidas entre `traductor.js`, `offscreen.js` y `cronometro.js`.

**Coste total estimado: ~30 líneas, 4 archivos, ningún cambio de arquitectura.**

### Riesgos que introduce, dichos antes

1. **Un lote partido es algo más lento que uno entero** cuando no hay atasco. El
   ahorro de agrupar es real. Con habla normal (1-2 trozos) **no hay ninguna
   diferencia**, porque nunca se alcanza el tope; el coste sólo aparece en frases
   largas de 9-20 trozos, que son raras. No lo he medido: no puedo.
2. **La calidad por trozo debería ser idéntica** —OPUS-MT traduce cada oración por
   separado de todos modos—, pero el relleno (*padding*) de un lote de 8 no es el de
   un lote de 40 y eso puede mover algún resultado. **Es la única afirmación de este
   documento que habría que comprobar en tu equipo** antes de darla por buena.
3. **Elegir N es un compromiso**: N pequeño = reacciona antes, menos agrupación;
   N grande = al revés. 8-10 parece razonable, pero el dato que lo fija es cuántos
   trozos tienen tus frases reales, y eso lo dice la columna `trozos MT`.

---

## 5. Esto **es** el arreglo del bug del temporizador

No son dos tareas. Son la misma.

El bug es: `TIMEOUT_MS` vence y **no libera el hueco del worker**, porque el worker
no puede acusar la cancelación mientras está dentro de `generate()`. Los arreglos
posibles son tres:

| Arreglo | Veredicto |
|---|---|
| Liberar el hueco por las bravas al vencer el tiempo | **Rechazado.** Es exactamente el bug que se arregló el 7-oct: dos `generate()` en paralelo en el mismo núcleo. |
| Bajar `TIMEOUT_RESCATE_MS` de 20 s a 2 s | **Paliativo.** Ahorra 18 s pero sigue reiniciando el worker, recargando 113 MB y vaciando la cola. La cascada se mantiene. |
| **Crear puntos de abandono** (= esta opción) | **Correcto.** El `CANCELAR` empieza a funcionar, así que el rescate deja de dispararse y el hueco se libera en un grupo. |

Es decir: **la opción de continuación no es una alternativa al arreglo del
temporizador, es el arreglo del temporizador.** Y tienes razón en que es un bug
concreto y no un límite estructural: arreglarlo va antes que cualquier decisión
sobre A o C.

---

## 6. Lo que NO puedo hacer: confirmar la hipótesis de las alucinaciones

**Sigo sin la medición nueva.** La columna `trozos MT` existe desde el commit
anterior, pero aquí no hay Chrome, ni audio, ni YouTube, ni los pesos: **no puedo
producir la tabla**. La hipótesis de música/careta **sigue siendo una hipótesis**
y no la voy a dar por confirmada con un razonamiento.

Para que quede cerrado en cuanto corras la tanda, el criterio está escrito **de
antemano**, para que no pueda acomodarlo luego al resultado:

| `trozos MT` de las frases lentas | Qué significa |
|---|---|
| **20 o más** | **Hipótesis confirmada.** Es el tamaño del lote. Se implementa esta opción. |
| **8-19** | Confirmada en parte: el lote influye pero no lo explica todo. Hay que mirar también el texto de esas frases. |
| **1-2** | **Me he equivocado.** El modelo tardó de verdad; hay que mirar hacia la contención de CPU, y esta evaluación no sirve para nada. |
| Vacía (`null`) | La frase **nunca llegó a entrar en `generate()`**: estaba esperando detrás de otra. Entonces la lenta es la anterior. |

Y una pregunta de sí o no que decide el otro extremo: ¿aparece en la consola
`el worker no soltó la frase #N tras cancelarla. Se reinicia.`? Si aparece, el
rescate de 20 s se disparó y la reconstrucción de los 50 s es correcta.

---

## 7. Entonces, ¿hay que elegir entre las dos opciones originales?

**No, de momento.** Ése era el plan B del encargo y no hace falta: la tercera
opción es viable con un coste razonable y no obliga a elegir entre bloquear el
worker y perder contenido. Evita las dos cosas.

La única decisión que sigue siendo tuya, y que te pediré **con la tabla delante**,
es qué hacer con el trozo que no se llega a traducir cuando aun así se agota el
tiempo: entregarlo marcado como parcial o descartar la frase entera. Eso ya es una
elección pequeña y reversible, no una de arquitectura.
