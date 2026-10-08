# Prueba C — ¿baja la pérdida con el recorte activo?

**Esta guía existe porque la primera vez salió mal, y la culpa fue de la guía,
no tuya.** No dije que el interruptor no se puede tocar mientras corre la
prueba, ni que hay que reiniciar el contador antes. El resultado fue una tabla
que mezclaba tramos con recorte y tramos sin recorte, **sin forma de saber qué
fila era de cuál**. Esa tabla no se puede interpretar y no voy a intentarlo.

---

## Lo que ha cambiado: ya no depende de tu memoria

**La tabla registra ahora, frase por frase, si el recorte estaba encendido.**
Columna nueva `recorte`, con `on`, `off` o `?` (las frases medidas antes de
que existiera la columna). Se lee del interruptor real en el momento de
procesar cada frase, no de lo que nadie recuerde haber escrito.

Y hay un comando que hace la comparación solo:

```js
livedub.comparar()
```

Parte las frases en dos grupos según esa columna y compara lo único que
importa: la **proporción ES/EN** y la **ocupación**. Escribe él el veredicto.
Si en un grupo hay menos de 5 frases, dice `NO SE PUEDE COMPARAR` en vez de
inventarse una conclusión.

**Consecuencia práctica:** si esta vez se te vuelve a colar el interruptor a
mitad, **la tanda ya no se pierde**. Se lee por grupos. Los pasos de abajo
siguen siendo la forma limpia de hacerlo, pero ya no son la única red.

---

## La regla de oro

> **Una vez empieza la prueba, NO se toca `livedub.recorte()`.**
> Ni para comprobar que está encendido. Encenderlo o apagarlo a mitad invalida
> la tanda entera, porque las filas de antes y las de después quedan mezcladas
> en la misma tabla.

Si te asalta la duda de si está encendido, **mira sin tocar**:

```js
livedub.recorte()
```

Sin argumentos **sólo informa**, no cambia nada. Con `true` o `false` **sí**
cambia. Esa es toda la diferencia, y es la que se coló la vez anterior.

---

## Antes de empezar

```
cd /c/Users/Janus/Desktop/NovaChat
git pull origin arena/5e149d9c-novachat
```

Recarga la extensión en `chrome://extensions` (el botón de recargar ⟳).

**Elige el vídeo ANTES de empezar.** Tiene que ser:

- **habla continua en inglés**, de alguien que hable seguido (una charla, un
  vídeo de divulgación, una entrevista). No vale música ni montajes.
- **mínimo 5 minutos** de duración, para poder dejar correr 3-5 sin tocar nada.
- **el mismo tipo** que el de las tandas anteriores, o la comparación no vale.

Pon el **selector de idioma en «Inglés»**, no en «Automático». Con «Automático»
se cuela el fallo del detector (el de la frase #23) y contamina el recuento con
pérdidas que no son del recorte.

---

## Los cuatro pasos, en este orden exacto

Abre la consola del documento offscreen y haz **sólo esto**:

### Paso 1 — Enciende el recorte (ANTES de reiniciar el contador)

```js
livedub.recorte(true)
```

Tiene que responder `true` y escribir `recorte de traducciones ENCENDIDO`.

> **Por qué primero esto y no el contador:** si enciendes el recorte después de
> reiniciar, las primeras frases que ya estaban en la tubería se doblan sin
> recortar y entran igualmente en la tabla limpia. Encendiéndolo antes, para
> cuando reinicies el contador todo lo que entre ya lleva recorte.

### Paso 2 — Deja pasar ~20 segundos de vídeo

Dale al play y espera a que suenen **dos o tres frases dobladas**. Esto vacía
la tubería de lo que quedara pendiente. No mires la consola, no escribas nada.

### Paso 3 — Reinicia el contador y NO TOQUES NADA durante 3-5 minutos

```js
livedub.latenciaReiniciar()
```

Y ahora **el vídeo corre 3-5 minutos seguidos**. Durante ese rato:

- ❌ **no** escribas `livedub.recorte(...)`
- ❌ **no** pauses ni adelantes el vídeo
- ❌ **no** cambies de pestaña ni minimices Chrome *(la captura se interrumpe)*
- ❌ **no** pidas `livedub.perdidas()` «para ir viendo»
- ✅ escucha el doblaje y apunta en un papel si alguna frase suena rara

Cronométralo. **Menos de 3 minutos no sirve**: con pocas frases, un solo
descarte ya mueve el porcentaje varios puntos.

### Paso 4 — Sólo ahora, lee los números

```js
livedub.latenciaTexto()
livedub.perdidas()
livedub.comparar()
livedub.recorteEjemplos()
```

Y una comprobación de un vistazo: en la tabla de `latenciaTexto()`, **la
columna `recorte` tiene que decir `on` en todas las filas**. Si ves alguna
`off` o `?` mezclada, no pasa nada — `livedub.comparar()` las separa — pero
dímelo para que lo tenga en cuenta.

Y págame las tres salidas enteras, tal cual.

---

## Qué voy a mirar en lo que me pases

| Dato | De dónde sale | Para qué |
|---|---|---|
| **% de pérdida** | `perdidas()` | Compararlo con el **7,1 %** de la tanda limpia anterior |
| **¿cuadra el contador?** | `perdidas()` | Si dice `NO`, las cifras son un mínimo y el resto no vale |
| **ocupación (%)** | `latenciaTexto()` | Es la cifra que de verdad decide. Tiene que bajar de 100 |
| **trozos MT** | `latenciaTexto()` | Confirmar que los atascos siguen sin volver |
| **reducción media** | `recorteEjemplos()` | Cuánto recortó **de verdad** con tus frases, no con las mías |
| **proporción ES/EN** | `comparar()` | **La cifra que decide.** Por encima de 1, la pérdida es inevitable |
| **veredicto** | `comparar()` | Lo escribe el programa, para que no dependa de quién lo cuente |

**La cifra que manda es la ocupación, no el porcentaje de pérdida.** La pérdida
es el síntoma y depende de la racha que te toque; la ocupación es la causa y es
estable. Si la ocupación mediana baja de 100 y la pérdida no baja, es que queda
otra vía que no hemos encontrado.

---

## Si algo suena mal

Apunta la frase y sigue con la prueba — **no apagues el recorte a mitad**. Al
terminar, en `recorteEjemplos()` saldrá con su columna «reglas usadas», y con
eso sé exactamente qué regla quitar.

## Si quieres abortar

Perfectamente válido. `livedub.recorte(false)` y me lo dices. Lo que no sirve
es una tanda a medias presentada como completa.

---

## El diagnóstico que hay que confirmar, dicho por adelantado

Lo escribo **antes** de la prueba para no poder acomodarlo después.

La reducción real que hemos medido hasta ahora es del **3,5 %**. Para que la
ocupación baje de 100 con una proporción de 1,11 hace falta recortar:

```
1 − (1 ÷ 1,11) = 9,9 %
```

Con 3,5 %, la proporción se queda en `1,11 × 0,965 = 1,071`. **Sigue por
encima de 1.** Si eso se confirma con la columna nueva, la conclusión es ésta
y no otra:

> **El recorte, por sí solo, no basta.** Reduce la pérdida, pero no la
> elimina, porque no llega ni a la mitad de lo que haría falta. Y no se puede
> forzar subiendo el objetivo: ya se intentó y lo que salió fueron las frases
> rotas que tú mismo capturaste.

Entonces vuelven a la mesa las dos únicas salidas reales, y la decisión es
tuya:

| | Qué implica |
|---|---|
| **Aceptar pérdida residual** | Sigues con el camino 1. En rachas de habla muy continua se pierde alguna frase, siempre avisada y contada. Es lo que ya está escrito en `ALCANCE-DOBLAJE.md`. |
| **Reconsiderar el búfer** | Una espera al principio (por ejemplo 20-30 s) absorbe las rachas y la pérdida se va casi a cero. A cambio pierdes el arranque instantáneo que elegiste expresamente. |

**No voy a implementar ninguna de las dos sin que lo digas.** Y si los números
me desmienten —si la proporción con recorte baja de 1— lo diré igual de claro.

---

## Y la prueba de control, si te sobra paciencia

Lo ideal sería repetir lo mismo con `livedub.recorte(false)` y el **mismo
vídeo desde el mismo punto**, para comparar manzanas con manzanas. Son otros
5 minutos. Si no te apetece, comparamos con la tanda del 7,1 % y ya; es menos
riguroso porque el vídeo no es idéntico, y lo diré así cuando escriba el
resultado.
