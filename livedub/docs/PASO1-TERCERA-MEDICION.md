# Tercera medición — la magnitud real de la pérdida

**Esta medición la tienes que ejecutar tú. Yo no puedo.**

En este sandbox no hay Chrome, ni tarjeta de sonido, ni YouTube, ni los
pesos de los modelos. Puedo construir el instrumento y razonar sobre los
números, pero **no puedo producir una medición real**. Lo digo claro para
que no se quede esperando una tabla que no va a llegar de mi parte.

Lo que sí he hecho para que te cueste lo menos posible: **la verificación
cruzada que pedías la hace ahora el propio código.** No tienes que buscar
huecos en la columna `#` a mano.

---

## Antes de empezar

```
cd /c/Users/Janus/Desktop/NovaChat
git pull origin arena/5e149d9c-novachat
```

Recargar en `chrome://extensions`.

### Pon el selector de idioma en «Inglés»

Importante. Con «Automático» se te van a caer frases por la heurística
—exactamente lo de la #23— y eso **contamina el recuento de pérdidas** con
un problema distinto del que queremos medir.

---

## La tanda

1. Vídeo en inglés con **habla continua**, el mismo tipo que las veces
   anteriores.
2. **Iniciar** → activar **Doblaje por voz**.
3. Consola del offscreen (`chrome://extensions` → LiveDub → «Inspeccionar
   vistas» → `offscreen.html` → `Console`).
4. Poner a cero:

```js
livedub.latenciaReiniciar()
```

5. **Dejarlo correr 5 minutos sin tocar nada.**

6. Sacar los tres informes, en este orden:

```js
livedub.latenciaTexto()
```

```js
livedub.perdidas()
```

```js
livedub.limiteTeorico()
```

**Pégame la salida de los tres.** De `latenciaTexto()` quiero todas las
filas, no sólo el resumen.

---

## Lo que ha cambiado desde la vez pasada

**El comportamiento de descarte es idéntico.** No se ha tocado ningún tope
ni ninguna cola: sólo se ha hecho visible lo que antes pasaba a oscuras.

| | Antes | Ahora |
|---|---|---|
| Descarte en la cola de Whisper | **sin rastro alguno** | avisa, cuenta y aparece en la tabla |
| Descarte en la cola de voz | sólo `console.warn` | contado, con los segundos perdidos |
| Aviso al usuario | ninguno | el popup pasa a error con el número de frases perdidas |
| Hueco negativo (−117 %) | ocurría | corregido |

### `livedub.perdidas()` te va a dar

- Cuántas frases se han perdido y en **qué etapa** de las cuatro.
- **Cuántos segundos de vídeo** se han quedado sin doblar.
- **Qué porcentaje** del total representa.
- Y la verificación cruzada: **«¿cuadra el contador?»**

Esa última línea es la importante. Compara los ids que entraron con los que
salieron y dice una de dos cosas:

- **«SÍ — todas las frases están explicadas»** → el recuento es fiable y las
  cifras son el total real.
- **«NO — N frases desaparecieron sin que ningún contador las recogiera»** →
  hay una vía de pérdida que todavía no he encontrado, y entonces **las
  cifras son un mínimo, no el total**. Saldría también un error en rojo.

Prefiero que el instrumento sepa decir «no te fíes de mí» a que dé un
número redondo y falso.

---

## Qué voy a hacer con esos datos

Con el porcentaje de pérdida real delante, la decisión entre **(A) recortar
traducciones** y **(C) reconsiderar el búfer** deja de ser abstracta:

- Si la pérdida es del **1-3 %**, A probablemente baste y C sería
  desproporcionado.
- Si es del **10-20 %**, A sola no llega: recortar un 15 % de texto no
  compensa una ocupación del 120 %, y habría que hablar en serio de C.
- Si el contador **no cuadra**, lo primero es encontrar la fuga. No se
  decide nada sobre datos que el propio instrumento declara incompletos.

**No voy a escribir código de A ni de C hasta que elijas.**

---

## Recordatorio de Nivel 1

A partir de ahora la verificación estática es un solo comando y
`test-modulos-cargan.mjs` va dentro de forma fija:

```
node livedub/tests/nivel1.mjs
```

Seis comprobaciones: sintaxis, **que los módulos se importen de verdad**,
las 14 suites, que no haya ninguna URL remota, el manifiesto (incluido que
siga sin pedir el permiso `"tts"`) y la coherencia de la mensajería.

No tienes que ejecutarlo tú: es mi deber antes de cada entrega. Lo dejo
escrito para que puedas comprobarlo cuando quieras.
