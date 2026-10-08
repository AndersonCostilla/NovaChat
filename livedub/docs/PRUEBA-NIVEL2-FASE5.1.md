# Prueba Nivel 2 — Fase 5.1 (rendimiento del doblaje)

Esta prueba **no es como las anteriores**. No se trata de comprobar que algo
funciona: se trata de **medir** si tu equipo puede con el doblaje, y comparar
dos motores para quedarnos con el bueno.

Son dos pasadas de unos 3 minutos cada una, con una tabla al final.

> **Si no quieres hacer la comparación**, haz sólo el bloque A. Con eso ya
> sabrás si el doblaje te sirve o no.

---

## Antes de empezar

Abre **Git Bash** y escribe estas líneas, una a una:

```bash
cd /c/Users/Janus/Desktop/NovaChat
git pull origin arena/5e149d9c-novachat
bash livedub/models/descargar-modelo-voz.sh
powershell -ExecutionPolicy Bypass -File livedub/models/verificar-modelos.ps1
```

La tercera línea descarga **114 MB** del motor nuevo. El que ya tenías no se
borra: a partir de ahora están los dos y se alterna con una línea de texto.

La cuarta tiene que terminar en **«TODO CORRECTO: los tres modelos estan
completos.»** Si no, no sigas: pégame lo que salga.

Luego ve a `chrome://extensions` y pulsa **Recargar (↻)**.

---

## Dónde se mira todo esto

La consola del **documento offscreen** (no la de la página, no la del popup):

1. `chrome://extensions`
2. En LiveDub, pulsa **«documento offscreen»** donde pone *Vistas inspeccionadas*.
3. Se abre una ventana de DevTools. La pestaña **Console** es la que importa.

---

## Bloque A — Medir el motor nuevo (float32)

Es el que viene activado de fábrica tras el `git pull`. No hay que tocar nada.

1. Abre el vídeo de siempre y pulsa **Iniciar** en LiveDub.
2. Marca **«Leer traducción en voz alta»**.
3. En la consola del offscreen, confirma que aparece esta línea:

   ```
   [LiveDub][sintetizador-worker] motor: COMPLETO float32 (onnx/model.onnx)
   ```

   Si pone `CUANTIZADO int8`, el `git pull` no se aplicó: avísame.

4. **Deja correr el vídeo 3 minutos.** No toques nada. Da igual si oyes el
   doblaje bien, mal o a ratos: ahora estamos midiendo, no juzgando.

5. Escribe en la consola:

   ```js
   livedub.rendimiento()
   ```

6. **Copia la tabla entera.** Ésa es la medida del motor float32.

### Qué dirá la tabla

| Si «ms por segundo de audio» está… | Significa |
|---|---|
| por debajo de 850 | Tu equipo va sobrado. Veredicto `apto` |
| entre 850 y 1000 | Llega justo. Veredicto `justo` |
| por encima de 1000 | No alcanza. Veredicto `insuficiente`, y el doblaje se apaga solo |

Si se apaga solo, **verás un mensaje en ámbar bajo el interruptor explicando
por qué**. Eso es el comportamiento correcto, no un fallo.

**La cifra a batir es 2.000** (lo que daba el motor viejo en tu equipo).

---

## Bloque B — Medir el motor viejo (int8), para comparar

Sólo si quieres la comparación completa.

1. Abre con el Bloc de notas el archivo:

   `C:\Users\Janus\Desktop\NovaChat\livedub\messages.js`

2. Busca esta línea (está sobre la línea 139, bajo un comentario largo):

   ```js
   USAR_CUANTIZADO: false,
   ```

3. Cámbiala a:

   ```js
   USAR_CUANTIZADO: true,
   ```

4. Guarda, ve a `chrome://extensions`, **Recargar (↻)**.
5. Repite los pasos 1 a 6 del Bloque A.
6. Confirma que ahora la consola dice `motor: CUANTIZADO int8`.
7. **Deja la línea en `true` o devuélvela a `false`, según cuál haya salido
   mejor.** Dímelo y lo dejo fijado en el repositorio.

> ⚠️ Estás editando un archivo del programa. Si algo se tuerce,
> `git checkout livedub/messages.js` en Git Bash lo deja como estaba.

---

## Bloque C — La velocidad, a tu oído

Con el doblaje sonando, prueba en la consola:

```js
livedub.setVelocidadVoz(1.0)   // velocidad natural
livedub.setVelocidadVoz(1.2)   // la de fábrica
livedub.setVelocidadVoz(1.35)  // bastante rápida
```

Cada cambio afecta **a la frase siguiente**, no a la que esté sonando.

Acelerar también **sube un poco el tono** (a 1,2 suena algo más agudo). Dime
qué número te parece el mejor equilibrio entre «se entiende bien» y «no suena
a dibujos animados». Lo dejo como valor por defecto.

---

## Bloque D — Que los subtítulos no se resientan

Lo importante: el doblaje **no debe estropear lo que ya funciona**.

1. Con el doblaje **apagado**, mira unos 2 minutos de vídeo y fíjate en si los
   subtítulos van fluidos.
2. Enciéndelo y mira otros 2 minutos.
3. ¿Notas que los subtítulos tarden más en aparecer? ¿Se saltan frases?

Si la respuesta es sí, dímelo: significa que el doblaje le está robando
demasiada CPU a la transcripción y habría que limitarlo más.

---

## Qué necesito que me mandes

1. La tabla de `livedub.rendimiento()` del **Bloque A**.
2. Si hiciste el B, la tabla del **Bloque B**.
3. Tu número preferido de velocidad (Bloque C).
4. Si los subtítulos empeoran con el doblaje encendido (Bloque D).
5. Si el doblaje se apagó solo: **el texto exacto del mensaje en ámbar**.

Con eso decido si el doblaje se queda, se queda con advertencia, o se declara
inviable en equipos como el tuyo. Y lo que salga, saldrá escrito tal cual.

---

## Si algo se rompe

| Qué ves | Qué hacer |
|---|---|
| «Voz no disponible» en rojo | Faltan archivos: `bash livedub/models/descargar-modelo-voz.sh` |
| La consola dice `motor:` con el valor que no tocaba | No recargaste la extensión tras editar `messages.js` |
| `livedub.rendimiento()` devuelve `null` | No hay captura activa o el doblaje está apagado |
| «Equipo insuficiente» en ámbar | Es correcto. `livedub.reintentarVoz()` lo reactiva para seguir probando |
| Nada de lo anterior | `livedub.doblaje()` y pégame la tabla |
