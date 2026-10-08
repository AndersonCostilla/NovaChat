# Investigación: el episodio de traducción lenta (#4, #5, #6)

**Fecha:** 8-oct-2026
**Datos de partida:** tanda de Anderson. `traducción (ms)` = **30001**, **29745**, **40003**
en las frases **#4**, **#5** y **#6**, contra una mediana de 1-3 s en el resto de la sesión.
Después, descartes en **#7, #8, #9 y #13**.

**Lo que se puede afirmar y lo que no.** Lo de abajo está dividido a propósito en
*verificado aquí* y *pendiente de tu consola*. Aquí no hay Chrome, ni audio, ni los
pesos: puedo demostrar de dónde salen los números y qué los puede producir, pero no
puedo ver qué dijo Whisper en tu frase #4.

---

## 1. Lo primero: **no son traducciones lentas**

Las tres cifras no son tiempo de cálculo. Son **temporizadores de `traductor.js`
disparándose**. Las dos constantes implicadas ya estaban en el código:

```js
const TIMEOUT_MS = 30000;          // traductor.js:18 — se da la frase por perdida
const TIMEOUT_RESCATE_MS = 20000;  // traductor.js:27 — margen para acusar la cancelación
```

Reconstrucción de la línea de tiempo con las reglas reales del código
(comprobada en `tests/test-traductor-lento.mjs`, apartado A):

| t (s) | Qué pasa |
|---|---|
| 0 | **#4** sale de la cola y entra en `generate()`. Arranca su espera de 30 s. |
| 0,26 | **#5** se pide. Se queda en la cola: `procesarCola()` no saca nada con `enVuelo = true`. |
| ~10 | **#6** se pide. También a la cola. |
| **30** | Vence la espera de #4 → se resuelve vacía. **`traducción (ms)` = 30001.** Se manda `CANCELAR`. **`enVuelo` NO se libera.** |
| 30→50 | El worker sigue dentro de `generate()`. No puede atender `CANCELAR`: es un hilo y está ocupado. Nada avanza. |
| **50** | Vence el rescate → `destruir()` + `fallarTodo()` → **#5 y #6 se resuelven vacías en el mismo instante**. #6 llegó a los 10 s → **40003**. |
| 50+ | El worker se reinicia y vuelve a **`cargando`**: hay que releer el modelo (~113 MB). |

Las dos cifras encajan al milisegundo con las constantes. **#6 = 40003 no tiene ninguna
otra explicación posible en este código:** no hay ningún camino que espere 40 s por nada.
50 000 − 10 000 = 40 000.

> **Discrepancia honesta sobre #5.** Con esta reconstrucción, #5 debería marcar
> **49745**, no 29745 — mismos cuatro dígitos finales, un 4 en vez de un 2 al principio.
> O lo copiaste con un dedo de más, o #5 se resolvió antes por una vía distinta
> (p. ej. que el worker muriera solo a los 30 s en vez de aguantar hasta el rescate).
> **No voy a decidirlo yo por ti:** mira en la consola si existe la línea
> `el worker no soltó la frase #4 tras cancelarla. Se reinicia.` Si está, fue el
> rescate y el número es 49745. Si no está, el worker se cayó antes y hay un
> segundo fallo que investigar. Es la única cifra de las tres que no puedo cerrar.

### Consecuencia inmediata: el techo real no es 30 s, es 50

Una sola frase atascada **bloquea la tubería 50 segundos**. En ese hueco caben
unas 4 frases más. No es un fallo que cuesta una frase: cuesta **un tramo de vídeo**.

---

## 2. La cascada de #7, #8, #9 y #13: **sí, la provocó el atasco**

Dos mecanismos encadenados, los dos en el código:

**(a) Mientras el worker se recarga, la cola del traductor se desborda.**
`procesarCola()` exige `estado === LISTO`. Durante la recarga todo se acumula, y
`MAX_EN_COLA = 4` tira lo más viejo. Con siete frases entrando durante la recarga,
las descartadas son exactamente **#7, #8 y #9** (comprobado en el test).

**(b) Al volver, todo lo retenido termina a la vez y revienta la cola de voz.**
Las traducciones que sobrevivieron se resuelven casi simultáneamente, así que
`doblar()` se llama en ráfaga contra una cola de **`VOZ_SISTEMA.MAX_EN_COLA = 2`**.
Es el mismo punto de descarte que ya identificamos en la #11 de la tanda anterior.

Dicho de otro modo: **las pérdidas de hoy no demuestran que el sistema no dé abasto
en régimen normal.** Demuestran que un atasco de 50 s arrasa con lo que pille. Por eso
tienes razón en no decidir todavía entre (A) y (C).

---

## 3. Por qué un `generate()` puede tardar 30 s: **el tamaño del lote**

Aquí está el agujero. `traductor-worker.js` trocea la frase en oraciones y manda
**todas en un solo lote**:

```js
const trozos = trocearEnOraciones(texto);          // sin ningún tope
const salida = await modelo(entradas, { max_new_tokens: maxTokens, num_beams: 1 });
```

`max_new_tokens` sí está acotado (64-512). **El número de trozos no está acotado por
nada.** Y el coste de `generate()` crece con él.

Medido hoy con el segmentador real (`tests/test-traductor-lento.mjs`, apartado B):

| Entrada | Trozos en un lote | `max_new_tokens` |
|---|---|---|
| Habla normal | **1-2** | 64 |
| Frase larga sin puntos (12 s) | 2 | 160 |
| Alucinación repetitiva: `"Thank you."` ×40 | **40** | 64 |
| Subtítulos fantasma: `"Subtitles by the Amara.org community."` ×12 | **12** | 64 |
| `"Yeah."` ×200 | **200** | 64 |

**De 1-2 a 40 trozos son 20-40 veces el trabajo en una sola llamada.** Eso convierte
1-3 s en 30-60 s sin que nada esté "roto". Es la hipótesis que mejor explica los datos:

- **Explica el salto de magnitud** (×20-40, y lo observado es ×15-20).
- **Explica que fuera al principio.** Las alucinaciones repetitivas de Whisper salen
  sobre **música, silencio o la careta de entrada** del vídeo — justo las primeras frases.
  Esto responde a tu pregunta sobre el patrón: **sospecho que no es "el principio" por
  ser el principio, sino por lo que suena al principio.**
- **Explica por qué fueron tres seguidas**: la careta dura varios segundos y produce
  varias frases basura seguidas.
- **Explica que no se pudiera cancelar**: `generate()` es una sola llamada sin puntos
  intermedios; el propio worker lo dice en un comentario.

### Hipótesis descartadas, y por qué

| Hipótesis | Veredicto |
|---|---|
| Carga del modelo | **Descartada.** El estado era `LISTO`: el modelo ya estaba en memoria. Con `cargando` no se saca nada de la cola y la cuenta de 30 s ni siquiera arranca. |
| Dos traducciones en paralelo | **Descartada.** Se arregló el 7-oct con `cadena` en el worker y `idEnVuelo` en `traductor.js`. |
| `num_beams` | **Descartada.** Está fijo en 1 y no se toca. |
| `max_new_tokens` desbocado | **Descartada como causa única.** Está acotado en 512, y con texto repetitivo se queda en el mínimo de 64. |
| Contención de CPU / recolección de basura | **Plausible como agravante, insuficiente como causa.** La contención conocida da ×1,8 (el 1.988 → 3.550 ms/s del sintetizador), no ×15. |

---

## 4. ¿Es reproducible?

**En tu equipo, sí, y en un minuto, sin esperar a que salga por casualidad.**
Abre la consola de `offscreen.html` con la extensión en marcha y pega:

```js
livedub.latenciaReiniciar()
```

Luego reproduce un vídeo que **empiece con música o careta** (un tráiler, una
intro de canal). Las alucinaciones de Whisper salen justo ahí.

Para verlo sin depender del azar, lo decisivo es la **instrumentación nueva** de
este commit: el worker avisa del tamaño del lote **antes** de entrar en `generate()`.
Ahora, cuando algo se atasque, la consola escribe:

```
[LiveDub][traductor] frase #4: lote de 40 trozos. El coste de generate() crece con
el número de trozos y NO se puede interrumpir a mitad: …
[LiveDub][traductor] frase #4: 30 s agotados — lote de 40 trozo(s), hasta 64 tokens
por trozo. generate() no se puede interrumpir, …
```

Y la tabla de `livedub.latencia()` tiene **una columna nueva, `trozos MT`**.

**Eso es lo que confirma o refuta la hipótesis.** Si la frase lenta sale con
`trozos MT` de 20-40 → confirmada. Si sale con 1-2 → **me he equivocado**, el modelo
tardó de verdad y habrá que mirar hacia la contención de CPU.

---

## 5. Lo que NO he hecho

**No he arreglado nada de esto.** La corrección evidente sería poner un tope al
número de trozos por lote, y **no la aplico sin tu visto bueno**, porque tiene un
compromiso que te toca decidir a ti: con un tope, una frase legítima muy larga se
traduciría **a medias** (se dobla lo que entre en el tope y el resto se tira).
Hoy esa frase se traduce entera o se pierde entera. Son dos formas distintas de
perder contenido y la regla del proyecto es que eso lo decides tú, con el dato
delante. Cuando tengas la columna `trozos MT` de una tanda real, te traigo las
opciones con su coste, igual que con el detector de idioma.

Tampoco he tocado `TIMEOUT_MS` ni `TIMEOUT_RESCATE_MS`, ni `MAX_EN_COLA`, ni el
comportamiento de descarte. Este commit **sólo mide y cuenta**.

---

## 6. La corrección del contador (tarea 2)

Hasta ahora, una frase que fallaba al traducir se cerraba con `abandonar()`:
salía en la tabla con su motivo, pero **no entraba en `perdidas()`**. El recuento
decía **4** cuando en realidad el espectador se quedó sin **6**.

Para quien mira el vídeo no hay ninguna diferencia entre «la cola de voz la tiró» y
«el traductor agotó los 30 s»: ese tramo pasa sin doblar. Si una cuenta, cuentan las dos.

`perdidas()` ahora distingue estas etapas:

| Etapa | Qué es |
|---|---|
| `cola de voz` | Descartada por `VOZ_SISTEMA.MAX_EN_COLA = 2`. |
| `traducción` | **NUEVA.** Tiempo agotado, cola llena del traductor, o error del worker. |
| `detector de idioma` | **NUEVA.** No se intentó traducir (el caso de la #23). |
| `cola de Whisper`, `cola del sintetizador` | Como estaban. |

**`doblaje apagado` sigue sin contar como pérdida**: es una decisión tuya, no un fallo.
Meterlo inflaría el porcentaje y sería mentir al alza, que da la misma poca confianza
que mentir a la baja.

La **verificación cruzada se mantiene intacta** y sigue cuadrando con las categorías
nuevas (comprobado en el test, apartado C).

---

## 7. Qué necesito de ti

1. `git pull`, recargar la extensión.
2. Un vídeo que **empiece con música o careta**, 3-5 min.
3. `livedub.latenciaTexto()` — mirando la columna **`trozos MT`** de las frases lentas.
4. `livedub.perdidas()` — con las etapas nuevas.
5. Si hubo atasco: busca en la consola `el worker no soltó la frase` y dime si aparece.

Con eso cierro la causa en vez de dejarla en «la hipótesis que mejor encaja».
