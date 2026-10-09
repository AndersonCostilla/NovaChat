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

---

# Resultado de la tanda 3, y la tanda 4 (post-tope)

**Tanda 3 ejecutada el 9-oct-2026: 75 frases, margen x3,3, una sola frase
tocada y era la alucinación ya confirmada. El tope se aplicó.**

La tanda 4 es la **validación del tope ya aplicado**. Cambiar el
transcriptor invalida lo validado antes, así que se repite entera.

```
cd /c/Users/Janus/Desktop/NovaChat
git pull origin arena/5e149d9c-novachat
```

Recarga la extensión. Graba una tanda normal y al terminar, en este orden:

```
livedub.cortes()
```
```
livedub.truncadas()
```
```
livedub.informeTanda()
```
```
livedub.probarTope(180)
```
```
livedub.costeWhisper()
```
```
livedub.deriva()
```
```
livedub.contencion()
```

## El comando nuevo que importa: `truncadas()`

Es el que vigila el riesgo del tope: frases que llegaron **al borde de los
720 caracteres y no terminan en signo de cierre**. **Si aparece una sola que
no fuera alucinación, el tope se revierte** — son dos líneas.

## Con qué expectativa leerlo

**Se espera que desaparezcan los eventos de Whisper con texto masivo
detrás** (tipo #10). **No se espera que desaparezcan todos los eventos
≥16 s**: los del tipo #11 —frase corta ralentizada por una vecina pesada— el
tope no los toca. Si quedan algunos de ésos, el arreglo funciona igual.
Razonado en [`CONTENCION-WHISPER.md`](CONTENCION-WHISPER.md).

Lo que sí es señal de que ha funcionado:

- `costeWhisper()` → **el R² debería subir** respecto al 0,333 de la tanda 3,
  porque desaparece el punto extremo de los 1.889 caracteres.
- `informeTanda()` → menos pérdidas en cascada tras los eventos.
- `contencion()` → si los residuos de las frases vecinas bajan solos, parte
  del problema era la memoria que dejaba la alucinación larga.
