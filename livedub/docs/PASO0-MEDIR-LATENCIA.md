# Paso 0 — ¿Desde dónde se cuentan los 15 segundos?

**Bloqueante. Sin estos números no se toca nada más.**

---

## Por qué no puedo responder yo a esto

Aquí no hay Chrome, ni tarjeta de sonido, ni YouTube, ni los pesos de los
modelos. **No puedo capturar audio real ni ejecutar Whisper.** Cualquier
cifra que te diera sería una estimación, y pediste expresamente lo
contrario.

Lo que sí he hecho es **construir el instrumento**: el código ahora anota la
marca de tiempo exacta de cada etapa de cada frase. Tú lo ejecutas, pegas la
tabla, y entonces sí habrá números reales.

## Qué mide exactamente

Para cada frase se guardan cinco instantes:

| Marca | Cuándo |
|---|---|
| `tInicioHabla` | llega el primer bloque de audio **con voz** |
| `tFinHabla` | el VAD cierra la frase (por silencio o por el tope de 12 s) |
| `tFinAsr` | Whisper devuelve el texto |
| `tFinMt` | el traductor devuelve el español |
| `tInicioVoz` | **el primer instante en que suena el doblaje** |

Y con eso calcula **las dos cifras en disputa**, por separado:

- **Desfase desde que TERMINA la frase** = `tInicioVoz − tFinHabla`
- **Desfase desde que EMPIEZA la frase** = `tInicioVoz − tInicioHabla`

La diferencia entre las dos es, exactamente, **la duración de la frase**.

> Nota sobre `tInicioVoz`: se marca cuando la voz **empieza** a sonar, no
> cuando termina. Lo que percibes como desfase es cuándo oyes la frase, no
> cuándo deja de oírse.

## Qué puede salir, y qué significaría cada cosa

| Si el desfase desde el FIN es… | Significa |
|---|---|
| **3-5 s** | El procesamiento va bien. Los 15 s eran desde el INICIO, y el grueso es la duración de la frase. La única palanca grande es el tope del VAD. |
| **8-15 s** | El procesamiento es el cuello de botella, no el VAD. Hay margen de mejora **sin** tocar la calidad de la traducción. Sería la mejor noticia posible. |

**No sé cuál de las dos saldrá.** Es justo lo que hay que averiguar.

---

# Cómo ejecutarlo

## 1. Actualizar

```
cd /c/Users/Janus/Desktop/NovaChat
git pull origin arena/5e149d9c-novachat
```

Luego, en `chrome://extensions`, pulsa **Recargar** en la tarjeta de LiveDub.

## 2. Preparar la medición

1. Abre un vídeo de YouTube **en inglés, con habla continua** (una
   entrevista, una charla, un documental). **Evita vídeos con mucha música o
   silencios largos**: darían pocas frases y la muestra saldría corta.
2. Abre el popup de LiveDub → **Iniciar**.
3. Activa el interruptor **Doblaje por voz**.
4. Abre la consola del offscreen: `chrome://extensions` → LiveDub →
   «Inspeccionar vistas» → **`offscreen.html`** → pestaña **`Console`**.

## 3. Poner el contador a cero

Pega esto en la consola:

```js
livedub.latenciaReiniciar()
```

## 4. Dejarlo correr

**Entre 3 y 5 minutos**, sin tocar nada. Necesitamos **al menos 10 frases**;
con 3-5 minutos de habla continua suelen salir entre 15 y 25.

Mientras tanto, puedes ir mirando. Un vistazo rápido:

```js
livedub.latencia()
```

## 5. Sacar el resultado

Cuando hayan pasado los minutos:

```js
livedub.latenciaTexto()
```

Eso imprime la tabla en texto plano, lista para copiar y pegar en el chat
sin que se desmonte el formato.

**Pégame la salida completa.** Incluye también, por si acaso:

```js
livedub.vadInfo()
```

---

## Qué NO hagas durante la medición

- No cambies de pestaña ni minimices (la captura podría pararse).
- No pauses el vídeo.
- No cambies la velocidad de reproducción de YouTube.
- No abras otras cosas pesadas en el equipo: competirían por el procesador
  y las cifras saldrían peor de lo que son.

---

## Columnas de la tabla, por si quieres interpretarla tú

| Columna | Qué es |
|---|---|
| `#` | número de frase |
| `duración frase (s)` | cuánto habló la persona |
| `cerró por` | `silencio` o `tope de 12 s` |
| `Whisper (ms)` | transcripción |
| `traducción (ms)` | traducción |
| `espera hasta hablar (ms)` | tiempo en cola antes de sonar |
| `DESFASE desde FIN (s)` | **cifra A** |
| `DESFASE desde INICIO (s)` | **cifra B** |
| `resultado` | `doblada`, o el motivo de que no sonara |

La columna **`cerró por`** importa mucho: si la mayoría dice `tope de 12 s`,
el habla del vídeo es continua y el tope está partiendo frases. Si dicen
`silencio`, las frases se cierran solas antes y el tope casi no interviene
— en cuyo caso **bajarlo apenas serviría de nada**, y eso cambiaría el plan
por completo.

---

## Después de esto

Con tus números haré el **paso 1** (desglose y cuello de botella real) y el
**paso 2** (opciones con su coste). No voy a tocar `MAX_FRASE_CHUNKS` ni a
proponer recortes concretos antes de ver esta tabla.
