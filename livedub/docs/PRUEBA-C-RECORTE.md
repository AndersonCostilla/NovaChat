# Prueba C — ¿baja la pérdida con el recorte activo?

**Esta guía existe porque la primera vez salió mal, y la culpa fue de la guía,
no tuya.** No dije que el interruptor no se puede tocar mientras corre la
prueba, ni que hay que reiniciar el contador antes. El resultado fue una tabla
que mezclaba tramos con recorte y tramos sin recorte, **sin forma de saber qué
fila era de cuál**. Esa tabla no se puede interpretar y no voy a intentarlo.

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
livedub.recorteEjemplos()
```

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

## Y la prueba de control, si te sobra paciencia

Lo ideal sería repetir lo mismo con `livedub.recorte(false)` y el **mismo
vídeo desde el mismo punto**, para comparar manzanas con manzanas. Son otros
5 minutos. Si no te apetece, comparamos con la tanda del 7,1 % y ya; es menos
riguroso porque el vídeo no es idéntico, y lo diré así cuando escriba el
resultado.
