# Tanda 3 — tercera muestra para el tope, con vídeo distinto

**Objetivo:** tener **3 muestras independientes** antes de tocar
`transcriptor-worker.js`. Estado: **pendiente de ejecutar.**

**Esta tanda no cambia nada en el código.** Se corre con exactamente la misma
configuración que la tanda 2: detector **encendido**, `toparVozLarga`
**apagado**, `simularRecorte()` **congelado**. Un solo cambio por medición —
aquí el cambio es **el vídeo**, así que no puede haber ningún otro.

---

## 0. Antes de empezar

```
cd /c/Users/Janus/Desktop/NovaChat
git pull origin arena/5e149d9c-novachat
```

Recarga la extensión en `chrome://extensions`.

## 1. Elige un vídeo que sea lo contrario del anterior

Lo que se busca **no** es que salga bien: es **intentar romper el tope**. Lo
ideal es material con habla densa:

- alguien que hable rápido (entrevista, comentario deportivo, stand-up),
- acento distinto del habitual,
- dos personas solapándose,
- o música/ruido de fondo — que es lo que más alucinaciones provoca.

**Si el vídeo nuevo es tan tranquilo como el anterior, la tanda 3 no aporta
nada**, porque repetiría la misma condición con otro nombre.

Unos **8-10 minutos** bastan: la tanda 2 dio 58 frases.

## 2. Durante la tanda

Déjala correr entera sin tocar la consola. Si paras a medias, la deriva y el
ajuste de `costeWhisper()` salen con menos puntos y valen menos.

## 3. Al terminar — en este orden

```
livedub.cortes()
```
**Primero esto, siempre, antes que cualquier porcentaje.** Dime cuántos
cortes hubo y de qué categoría.

```
livedub.probarTope(180)
```
El número que decide. Pásame el veredicto, la línea **`frase más larga NO
sospechosa`** con su margen, y la tabla `detalle` si hay filas.

```
livedub.informeTanda()
```
```
livedub.costeWhisper()
```
```
livedub.deriva()
```
De `deriva()` me interesan la columna **`Whisper normalizado`** y la fila
**`¿y sin los eventos catastróficos?`**.

## 4. Lectura manual, que no la hace el programa

Si `cortes()` trae frases de la categoría **«texto recortado parcialmente»**,
**léelas**. El informe automático no vale como validación — eso ya quedó
dicho el 9-oct.

---

## Qué pasa con cada resultado

| resultado de `probarTope(180)` | qué hago |
|---|---|
| `SÍ` y margen **≥ x2** | aplico el tope: una línea en `transcriptor-worker.js` + `TOPE_TOKENS_ASR = 180` en `offscreen.js`. |
| `SÍ` pero margen **entre x1,5 y x2** | te lo digo y propongo **224 tokens** en vez de 180. Tú decides. |
| `SÍ` con margen **< x1,5** | **no lo aplico.** El tope está demasiado cerca del habla real de ese vídeo. |
| `NO` — alguna frase real cortada | **no lo aplico** y te paso las filas. Dos tandas limpias no borran una sucia. |

## Y después de aplicarlo, si se aplica

Cambiar el transcriptor **invalida todo lo validado hasta ahora**. Hay que
repetir la tanda entera:

```
livedub.informeTanda()
livedub.probarTope(180)
livedub.deriva()
livedub.truncadas()
```

`truncadas()` es el que de verdad importa esa vez: dice si el tope cortó
alguna frase a mitad de palabra. **Si aparece una sola que no fuera
alucinación, el tope se revierte.**
