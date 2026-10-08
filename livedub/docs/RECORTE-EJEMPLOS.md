# Recorte de traducciones (opción A) — ejemplos antes/después

**Última revisión: 8-oct-2026, tras romper tres frases reales.**
**El recorte está APAGADO.** Se enciende con `livedub.recorte(true)` y se apaga
con `livedub.recorte(false)`, en caliente y sin recargar nada.

---

## Lo primero: el fallo que encontraste

Las tres frases que capturaste no eran recortes agresivos. Eran **frases rotas**:

| Lo que dijo el vídeo | Lo que salió por el altavoz |
|---|---|
| Se siente muy **bien** y de manera similar | «Se siente muy y de manera similar» |
| Se siente muy **bien**. Sí, creo que… | «Se siente muy. Sí, creo que…» |
| …entregas una cosa y es **bueno**. Esto es… | «…entregas una cosa y es. Esto es…» |

**Causa, y es un fallo mío de bulto.** La lista de nivel 2 se llama «muletillas
**de arranque**» desde que la escribí, pero el código la aplicaba **en cualquier
posición de la frase**. Así que `bien` y `bueno` se borraban también cuando eran
el complemento del verbo, no relleno. El comentario decía una cosa y el código
hacía otra.

### Qué he cambiado, en tres capas

**1. Las muletillas sólo disparan al arrancar una oración y seguidas de coma.**
Que es como aparece una muletilla de verdad: «Bueno, …». Nunca en medio.

**2. Las cinco más ambiguas se han quitado del todo** — `bien`, `vale`, `sabes`,
`la verdad`, `pues` — porque aunque vayan al principio, muchas veces no son
relleno.

**3. Una red de seguridad que no existía.** Ahora, después de aplicar **cada**
regla, se comprueba si el resultado sigue siendo una frase: que ninguna oración
se quede en una sola palabra, y que ninguna termine o corte en una palabra que
pide complemento (`muy`, `tan`, `es`, `está`, `y`, `de`…). **Si una regla no
pasa, se descarta esa regla, no la frase.**

Las dos primeras arreglan el fallo concreto. **La tercera es la que importa:**
es la que tiene que cazar la próxima regla mal escrita antes de que llegue a tus
oídos. Es la segunda tanda de reglas mías que rompe español, así que el problema
no era esa regla, era que no había nadie vigilando.

Tus tres frases están ahora **como casos de prueba fijos** en
`tests/test-recortador.mjs`, con el texto exacto. Si vuelven a romperse, la
suite se pone roja.

---

## Los 10 ejemplos, regenerados

Las tres primeras son **tus frases reales**. El resto son construcciones típicas
de OPUS-MT escritas por mí.

| # | ANTES | DESPUÉS | −% |
|---|---|---|---|
| 1 | Se siente muy bien y de manera similar. | **(sin cambios)** | 0 % |
| 2 | Se siente muy bien. Sí, creo que es importante. | **(sin cambios)** | 0 % |
| 3 | Cuando entregas una cosa y es bueno. Esto es como lo esperaba. | **(sin cambios)** | 0 % |
| 4 | **Bueno,** **en este momento** vamos a hablar sobre la razón por la que esto sucede. | **Ahora** vamos a hablar sobre la razón por la que esto sucede. | 13,2 % |
| 5 | **A pesar de que** el sistema **es capaz de** llevar a cabo la tarea, el resultado es peor. | **Aunque** el sistema **puede** llevar a cabo la tarea, el resultado es peor. | 16,9 % |
| 6 | **De acuerdo con** el informe, **la mayor parte de** los usuarios usa la aplicación a diario. | **Según** el informe, **la mayoría de** los usuarios usa la aplicación a diario. | 15,3 % |
| 7 | **Hoy en día**, **debido a que** la memoria es limitada, hay que tener mucho cuidado con esto. | **Hoy**, **porque** la memoria es limitada, hay que tener mucho cuidado con esto. | 15,1 % |
| 8 | Sin embargo, **con el fin de** entenderlo, tenemos que ver de qué manera se comporta. | Sin embargo, **para** entenderlo, tenemos que ver de qué manera se comporta. | 11,1 % |
| 9 | Y básicamente, ya sabes, esto es realmente **una gran cantidad de** trabajo. | Y básicamente, ya sabes, esto es realmente **un montón de** trabajo. | 11,1 % |
| 10 | Gracias por ver el vídeo. | **(sin cambios)** | 0 % |

**Media: 10,2 % · 3,9 s ahorrados · 4 de 10 frases no se tocaron.**

### El coste de haberlo arreglado, dicho claro

La media baja de **15,8 % a 10,2 %**. Está en el borde bajo de tu horquilla
(10-15 %) y **deja menos margen**: `1,11 × 0,898 = 0,997`. Sigue por debajo de
1, pero por los pelos.

Eso significa que **el recorte por sí solo quizá no baje la pérdida tanto como
esperábamos**. Lo prefiero así: una media alta conseguida rompiendo frases no
vale nada. Si al medir resulta que no basta, hay margen para añadir reglas
nuevas — pero ahora pasan primero por la red de seguridad.

---

## Reglas probadas y descartadas

Ninguna de éstas volverá por descuido: hay comprobaciones que las cazan.

| Regla | Producía | Por qué está mal |
|---|---|---|
| `bien` / `bueno` en cualquier posición | «Se siente muy» | se comía el complemento del verbo |
| `vale`, `sabes`, `la verdad`, `pues` | — | ambiguas: muchas veces no son relleno |
| `en el caso de que` → `si` | «Si no funcione» | `si` pide indicativo |
| `el hecho de que` → `que` | «es que funcione no significa» | se comía el sujeto |
| `es necesario que` → `hay que` | «hay que vayas» | va con infinitivo |
| `de manera que` → `así que` | — | finalidad ≠ consecuencia |
| `una gran cantidad de` → `muchos` | «muchos personas» | concordancia de género |

**Todas ahorraban tiempo y todas producían español incorrecto.**
Una regla que rompe la frase no vale ningún segundo.

---

## Detalle técnico

- **Dónde:** `recortador.js`. Se aplica en `offscreen.js` después de traducir y
  antes de hablar.
- **El subtítulo enseña el MISMO texto que se pronuncia.**
- **Tres niveles**, de menos a más invasivo: (1) perífrasis, (2) muletillas de
  arranque *(ancladas al principio de oración)*, (3) intensificadores vacíos
  *(con guarda de palabra anterior)*. Sólo se sube de nivel si el anterior no
  ha bastado, y se para **en cuanto** se alcanza el objetivo.
- **Los segundos ahorrados** salen de la velocidad medida de tu voz:
  **17,2 caracteres por segundo**.
- Para verlo con **tus** frases: `livedub.recorteEjemplos()`.
