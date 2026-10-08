# Segunda medición — confirmar o tumbar las dos hipótesis

**Unos 6 minutos.** Igual que la anterior, pero ahora la tabla trae las
columnas que faltaban.

---

## Qué se va a decidir con esto

| Hipótesis | Se confirma si… | Se tumba si… |
|---|---|---|
| **El canal de voz está saturado** | `OCUPACIÓN` ≥ 100 % y `el español dura x veces el original` ≈ 1,1 | `OCUPACIÓN` < 85 % |
| **Whisper cuesta lo mismo sea cual sea la frase** | `Whisper en frases cortas` ≈ `Whisper en frases largas` | las cortas cuestan mucho menos |

---

## Paso 1 — Actualizar

```
cd /c/Users/Janus/Desktop/NovaChat
git pull origin arena/5e149d9c-novachat
```

Recargar en `chrome://extensions`.

## Paso 2 — Mirar el selector de idioma (importante, 10 segundos)

Abre el popup y **mira en qué está el selector de idioma de origen**.

**Dime en cuál está antes de cambiarlo.** Es el dato que resuelve la causa
de la frase #9.

Luego, **ponlo en «Inglés»** para esta prueba. Así la heurística de
detección no interviene y la medición no se contamina con frases que se
caen por ese motivo.

## Paso 3 — Medir

Mismo vídeo que la vez pasada, si puede ser: así los dos juegos de datos
son comparables.

1. **Iniciar** en el popup.
2. Activar **Doblaje por voz**.
3. Abrir la consola del offscreen (`chrome://extensions` → LiveDub →
   «Inspeccionar vistas» → `offscreen.html` → `Console`).
4. Poner el contador a cero:

```js
livedub.latenciaReiniciar()
```

5. **Dejarlo correr 5 minutos sin tocar nada.** Esta vez conviene que sean
   5 y no 3: para ver si la espera crece hacen falta bastantes frases
   seguidas de habla continua.

6. Sacar el resultado:

```js
livedub.latenciaTexto()
```

**Pégame la salida COMPLETA, con todas las filas.** La vez pasada me
mandaste el resumen; esta vez necesito las filas una a una, porque lo que
hay que ver es **si la espera crece frase a frase o se mantiene**.

---

## Lo que voy a mirar en tu tabla

1. **La columna `ocupación (%)`.** Si la mayoría pasa de 100, el sistema no
   da abasto de forma estructural.
2. **Si la columna `espera hasta hablar (ms)` crece** dentro de una racha de
   frases seguidas con `cerró por = tope de 12 s`. Eso sería el atasco
   acumulativo en directo.
3. **`frases descartadas por retraso`.** Si es mayor que cero, la
   continuidad se está consiguiendo tirando contenido, y eso hay que
   decirlo tal cual.
4. **La columna `resultado`** de cualquier frase que no se doblara: ahora
   dice el motivo exacto en vez de un genérico.
5. **La comparación de Whisper entre frases cortas y largas.**

---

## Si no salen frases cortas

El resumen necesita algunas frases de menos de 6 s para comparar el coste de
Whisper. Si el vídeo es de habla muy continua, puede que no haya ninguna y
salga `sin muestras`.

En ese caso, haz **30 segundos extra** con un vídeo de diálogo con pausas
(una entrevista con preguntas y respuestas cortas) **sin reiniciar el
contador**, y vuelve a sacar la tabla.

---

## Lo que NO vamos a hacer todavía

- No se toca `MAX_FRASE_CHUNKS`. Sigue bloqueado.
- No se propone ninguna optimización hasta ver estos números.

Si la hipótesis del canal de voz se confirma, la conversación del paso 2
será distinta de lo que parecía: el problema no sería «Whisper tarda 4,27 s»
sino «el español ocupa más tiempo del que hay disponible», y eso tiene otras
salidas —algunas de las cuales rozan decisiones que diste por cerradas, así
que te las plantearé antes de tocar nada.
