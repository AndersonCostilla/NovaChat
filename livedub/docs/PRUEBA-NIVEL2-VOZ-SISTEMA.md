# Prueba Nivel 2 — motor de voz del sistema

**Nivel 1 (sandbox) ya pasado:** `node --check` en los 40 archivos, 12 suites
en verde (58 comprobaciones nuevas), 0 URLs remotas, `manifest.json` válido y
**sin el permiso `"tts"`**.

**Nada de lo de abajo está verificado todavía.** Lo que sigue sólo se puede
comprobar en tu Chrome, con sonido real.

---

## Antes de empezar

```
cd /c/Users/Janus/Desktop/NovaChat
git pull origin arena/5e149d9c-novachat
```

No hace falta volver a verificar los modelos: **la voz del sistema no
descarga nada**. Los pesos de Whisper y del traductor ya los tienes.

Luego, en `chrome://extensions`, pulsa **Recargar** en la tarjeta de LiveDub.

> **Si quieres estar seguro de que cargó el código nuevo**, mira la consola
> del offscreen tras pulsar Iniciar: debe aparecer una línea
> `[LiveDub][motor-voz] motor activo: voz del sistema (Microsoft Raul…)`.

---

## Bloque A — Arranque y elección de voz (1 minuto)

1. Abre un vídeo de YouTube **en inglés**.
2. Abre el popup de LiveDub → **Iniciar**.
3. Activa el interruptor **Doblaje por voz**.
4. Abre la consola del offscreen (`chrome://extensions` → LiveDub →
   «Inspeccionar vistas» → `offscreen.html` → pestaña `Console`).

Escribe en la consola:

```js
livedub.voces()
```

| Qué anotar | Esperado |
|---|---|
| A1. ¿Salen Raul y Sabina con «SÍ (local)»? | sí |
| A2. ¿Salen las dos «Google español» con «no — es de red»? | sí |
| A3. `livedub.motorVoz()` | `'sistema'` |

**A2 es la comprobación de privacidad.** Si alguna voz «Google» apareciera
como usable, es un fallo grave y hay que parar: significaría que el texto
traducido puede salir de tu equipo.

---

## Bloque B — ¿Habla, y suena bien? (2 minutos)

Deja correr el vídeo un par de minutos con el doblaje activo.

| Qué anotar | Esperado |
|---|---|
| B1. ¿Se oye voz en español? | sí |
| B2. ¿Se entiende bien, sin cortes a media palabra? | sí |
| B3. ¿El audio original baja cuando habla la voz? | sí, a ~18 % |
| B4. ¿Vuelve a su volumen normal al callar? | sí, suavemente |
| B5. ¿Hay frases que se oyen **encima** de otras? | **no debería** |
| B6. Si bajas el volumen con `livedub.setGain(0.5)` antes de que hable, ¿lo respeta al volver? | sí, vuelve a 0.5 y no a 1 |

**B5 es lo que arreglamos con las colas.** Si oyes dos voces solapadas,
anótalo: sería un fallo nuevo.

---

## Bloque C — El desfase (3 minutos) — EL BLOQUE IMPORTANTE

Esto es lo que decide si el proyecto sirve o no. Necesitas el reloj del
vídeo de YouTube a la vista.

Elige una frase que reconozcas bien. Cuando **el inglés** la diga, apunta el
minuto del vídeo. Cuando **la voz española** la diga, apunta otra vez.

| | Momento en inglés | Momento en español | Desfase |
|---|---|---|---|
| Frase al principio (~min 1) | | | |
| Frase a mitad (~min 3) | | | |
| Frase al final (~min 5) | | | |

**Lo que estamos midiendo no es cuánto es el desfase, sino si CRECE.**

| Qué anotar | Esperado |
|---|---|
| C1. Desfase aproximado | 15-18 s |
| C2. ¿El desfase del minuto 5 es parecido al del minuto 1? | **sí** |
| C3. Si creció, ¿cuánto? | menos de 2 s |

> Si el desfase crece sin parar, el doblaje no es utilizable y hay que
> replanteárselo. Es el riesgo que queda por descartar.

---

## Bloque D — Continuidad (el mismo rato del bloque C)

| Qué anotar | Esperado |
|---|---|
| D1. ¿Hubo silencios largos con gente hablando en pantalla? | no |
| D2. Busca en la consola `descartada`. ¿Cuántas veces? | 0, o muy pocas |
| D3. `livedub.doblaje()` → «frases en cola» | 0, 1 o 2. Nunca más |
| D4. ¿Se dobló lo que decían, sin resumir? | sí |

Al terminar, pega el resultado de:

```js
livedub.rendimiento()
```

Debe decir «coste de CPU de la síntesis: ninguno: lo hace Windows» y darte
los caracteres por segundo medidos **en material real** (no en la frase de
laboratorio de la sonda).

---

## Bloque E — Que no se rompa nada (1 minuto)

| Qué anotar | Esperado |
|---|---|
| E1. Apaga el interruptor de doblaje mientras habla | corta al instante y el volumen vuelve |
| E2. Los subtítulos siguen funcionando con el doblaje apagado | sí |
| E3. Pulsa **Detener** mientras habla | para y el volumen vuelve a normal |
| E4. Tras Detener, ¿el audio de YouTube suena normal? | **sí — comprobar sí o sí** |
| E5. Iniciar otra vez y volver a activar el doblaje | funciona sin recargar |

**E4 es el riesgo del que te avisé:** si el evento de fin no llegara, el
audio se quedaría bajo. Hay un vigilante y una restauración de emergencia,
pero es justo lo que no puedo verificar sin tu Chrome.

---

## Bloque F — El motor de reserva sigue vivo (opcional, 2 minutos)

Sólo si quieres confirmar que no rompimos MMS-TTS. Necesitas sus pesos ya
descargados.

```js
livedub.setMotorVoz('mms')
```

Apaga y enciende el interruptor de doblaje. Debe cargar el modelo y hablar
(lento, como antes). Para volver:

```js
livedub.setMotorVoz('sistema')
```

…y apagar/encender el interruptor otra vez.

| Qué anotar | Esperado |
|---|---|
| F1. ¿La reserva llega a hablar? | sí, aunque vaya muy por detrás |
| F2. Al volver a `sistema`, ¿funciona de nuevo? | sí |

---

## Qué mandarme

1. Las respuestas de A1-A3, B1-B6, C1-C3, D1-D4, E1-E5 (y F si lo haces).
2. **La tabla de desfase del bloque C rellenada.** Es el dato que decide.
3. La salida de `livedub.rendimiento()` y de `livedub.doblaje()`.
4. Cualquier línea roja de la consola.

Con eso se cierra la verificación de Nivel 2 de este motor y se puede
plantear la prueba larga de 5 minutos con los 9 criterios de aceptación.
