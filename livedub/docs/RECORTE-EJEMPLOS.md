# Recorte de traducciones (opción A) — ejemplos antes/después

**Fecha:** 8-oct-2026 · **El recorte está APAGADO.** No se activa hasta que lo
digas. Se enciende con `livedub.recorte(true)` y se apaga con `livedub.recorte(false)`,
en caliente y sin recargar nada.

---

## Por qué se recorta

La proporción medida en dos tandas independientes es **1,11**: el doblaje en
español dura un 11 % más que el original en inglés. Ese número es **toda** la
causa de la pérdida estructural. Está demostrado en `cronometro.js` que con
Whisper y la traducción a 0 ms la ocupación sale **idéntica**: no es velocidad
de cálculo, es la proporción entre los dos idiomas.

```
1,11 × (1 − 0,12) = 0,977   →  por debajo de 1, la pérdida estructural desaparece
```

Por eso el objetivo es **12 %**, el centro de la horquilla que pediste.

## Qué hace y qué NO hace

**Sí:** cambia maneras largas de decir lo mismo por maneras cortas.
**No:** resumir, omitir frases ni decidir qué es importante. Si con las reglas
no llega al objetivo, **se queda corto y lo dice**, en vez de empezar a tirar
contenido por su cuenta.

Se para **en cuanto alcanza el objetivo**, regla a regla: una frase que ya cabe
en su hueco no se toca. Cada rodeo que se quita de más es una oportunidad de
más de estropear algo.

---

## Los 10 ejemplos

> **Honestidad sobre el origen.** No son frases de tus tandas: las traducciones
> reales nunca se guardaron en el repo, sólo las tablas de tiempos. Éstas son
> construcciones típicas de OPUS-MT que **yo** he escrito, y por eso están
> cargadas de rodeos a propósito. **La cifra real de tu vídeo será más baja.**
> Para verla con tus frases, hay un comando nuevo: `livedub.recorteEjemplos()`,
> que pasa el recortador por las traducciones que el cronómetro tenga guardadas
> de la sesión en curso. Eso sí son tus frases.

| # | ANTES (lo que sale hoy de OPUS-MT) | DESPUÉS (con recorte) | −% | s |
|---|---|---|---|---|
| 1 | Bueno, en este momento vamos a hablar sobre la razón por la que esto sucede. | Bueno, **ahora** vamos a hablar sobre la razón por la que esto sucede. | 13,2 % | 0,58 |
| 2 | A pesar de que el sistema es capaz de llevar a cabo la tarea, el resultado es peor. | **Aunque** el sistema **puede** llevar a cabo la tarea, el resultado es peor. | 16,9 % | 0,81 |
| 3 | De acuerdo con el informe, la mayor parte de los usuarios usa la aplicación a diario. | **Según** el informe, **la mayoría de** los usuarios usa la aplicación a diario. | 15,3 % | 0,76 |
| 4 | Hoy en día, debido a que la memoria es limitada, hay que tener mucho cuidado con esto. | **Hoy**, **porque** la memoria es limitada, hay que tener mucho cuidado con esto. | 15,1 % | 0,76 |
| 5 | Lo que quiero decir es que el hecho de que funcione no significa que sea bueno. | El hecho de que funcione no significa que sea bueno. | 34,2 % | 1,57 |
| 6 | Sin embargo, con el fin de entenderlo, tenemos que ver de qué manera se comporta. | Sin embargo, **para** entenderlo, tenemos que ver de qué manera se comporta. | 11,1 % | 0,52 |
| 7 | En el caso de que no funcione, por lo tanto, vamos a tener que hacer uno nuevo. | En el caso de que no funcione, vamos a tener que hacer uno nuevo. | 17,7 % | 0,81 |
| 8 | Y básicamente, ya sabes, esto es realmente una gran cantidad de trabajo. | Y básicamente, ya sabes, esto es realmente **un montón de** trabajo. | 11,1 % | 0,47 |
| 9 | Gracias por ver el vídeo. | *(sin cambios)* | 0 % | 0 |
| 10 | Esto es increíble. | *(sin cambios)* | 0 % | 0 |

**Media: 15,8 % · 6,28 s ahorrados en 10 frases · 2 frases no se tocaron.**

**El 15,8 % se pasa un poco de la horquilla**, y es por la #5: `lo que quiero
decir es que` se va entera y se lleva un 34 % de una sola vez. Si prefieres
quedarte dentro del 10-15 %, se baja el objetivo con
`livedub.recorteObjetivo(0.10)`, o se quita esa regla.

### Lo que me gusta menos de esta tabla

La **#5**. El resultado es correcto y hasta mejor español, pero es la única
donde el recorte **borra** en vez de **sustituir**. Las demás cambian una
palabra por otra más corta y son difíciles de discutir. Si te chirría, dilo y
quito el nivel 2 entero (muletillas): se pierde algo de ahorro pero el recorte
queda reducido a puras equivalencias.

---

## Dos reglas que escribí, probé y tuve que quitar

Al generar esta tabla salieron dos frases rotas. No las dejo pasar y las anoto
aquí para que no vuelvan por descuido (hay una comprobación en
`tests/test-recortador.mjs` que las caza si alguien las repone):

| Regla | Lo que producía | Por qué está mal |
|---|---|---|
| `en el caso de que` → `si` | «**Si no funcione**, vamos a…» | `si` pide indicativo; `en el caso de que`, subjuntivo |
| `el hecho de que` → `que` | «es **que funcione** no significa…» | se come el sujeto de la oración |
| `es necesario que` → `hay que` | «**hay que vayas**» | `hay que` va con infinitivo |
| `de manera que` → `así que` | — | cambia finalidad por consecuencia |
| `una gran cantidad de` → `muchos` | «**muchos personas**» | concordancia de género |

Las cinco ahorraban tiempo y las cinco producían español incorrecto.
**Una regla que rompe la frase no vale ningún segundo.**

---

## Cómo probarlo tú

```
cd /c/Users/Janus/Desktop/NovaChat
git pull origin arena/5e149d9c-novachat
```

Recarga la extensión, pon un vídeo y deja correr 2-3 minutos. Luego, en la
consola del documento offscreen:

```js
livedub.recorteEjemplos()      // antes/después con TUS frases
```

Lee los DESPUÉS **en voz alta**. Si alguno suena mal o pierde algo, pégame la
fila y quito esa regla. Cuando te convenza:

```js
livedub.recorte(true)          // enciende el recorte
livedub.recorte(false)         // y lo apaga, si no te gusta cómo suena
livedub.recorteObjetivo(0.10)  // recortar menos
```

El recorte **no toca nada más de la tubería**: con él apagado, el texto pasa
tal cual, exactamente como hoy.

---

## Detalle técnico

- **Dónde:** `recortador.js`, un archivo nuevo. Se aplica en `offscreen.js`
  después de traducir y antes de hablar.
- **El subtítulo enseña el MISMO texto que se pronuncia.** Si la voz dijera una
  cosa y el subtítulo otra, no sabrías a cuál creer. La traducción sin recortar
  se guarda en el cronómetro para poder auditarla.
- **Tres niveles**, de menos a más invasivo: (1) perífrasis, (2) muletillas de
  arranque, (3) intensificadores vacíos. Sólo se sube de nivel si el anterior
  no ha bastado.
- **Los segundos ahorrados** salen de la velocidad medida de tu voz del sistema:
  **17,2 caracteres por segundo**. No es una estimación inventada.
