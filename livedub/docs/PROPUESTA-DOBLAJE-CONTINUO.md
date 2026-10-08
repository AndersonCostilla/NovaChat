# Propuesta: doblaje continuo y sincronizado

**Estado: PROPUESTA. No se ha modificado ni una línea de código.**
Fecha: 7 de octubre de 2026. Responde al cambio de prioridad de Anderson.

---

## Resumen en una página

El objetivo —voz española continua que acompañe a la escena— **no se consiguió
porque hay tres problemas distintos, y hasta ahora sólo se atacó uno.**

| # | Problema | ¿Se atacó? | ¿Tiene solución? |
|---|---|---|---|
| 1 | El motor de voz es 3,5× más lento que el tiempo real | Sí, sin éxito | **Sí: cambiar de motor** |
| 2 | **Defecto en la gestión de colas que multiplica la carga** | **No. No se había detectado** | **Sí, y es barato** |
| 3 | La imagen va ~15 s por delante de la voz | No | **Parcialmente, y es caro** |

El problema 2 es un **defecto de programación mío, no una limitación del
equipo**, y probablemente explica buena parte de la degradación de 2.000 a
3.600 ms/s que achacamos al procesador.

---

## 1. Auditoría de colas y timeouts (el punto 3 de tu encargo)

**Lo pediste con razón y tenías razón.** Esto es lo que encontré leyendo el
código, no suponiendo.

### 1.1 Al vencer el timeout, la inferencia NO se cancela

`sintetizador.js`, líneas 259-264:

```js
const temporizador = setTimeout(() => {
  onError?.(`La síntesis ${tarea.id} superó 30 s y se descartó.`);
  resolverPendiente(tarea.id, { audio: null, motivo: 'tiempo agotado' });
  enVuelo = false;        // ← se declara el worker libre…
  procesarCola();         // ← …y se le manda OTRA frase
}, TIMEOUT_MS);
```

**Sólo se abandona la espera.** No hay ningún mensaje de cancelación al worker
—de hecho `grep -E "abort|cancel|terminate"` sobre el worker no devuelve
nada—, así que **la inferencia sigue corriendo**. Y acto seguido se le envía
otra frase.

### 1.2 El worker no serializa: ejecuta las dos a la vez

`sintetizador-worker.js`:

```js
self.onmessage = async (evento) => {
  ...
  case ENTRADA.SINTETIZAR:
    await sintetizar(mensaje);   // ← sin guarda de concurrencia
```

Un `onmessage` **async** no espera a terminar antes de atender el mensaje
siguiente. Verificado: **cero** apariciones de `ocupado`, `enVuelo`, `mutex` o
equivalente en el worker. Dos inferencias comparten el único núcleo y cada una
tarda el doble.

### 1.3 El resultado caducado vuelve a liberar el hueco

`case 'RESULTADO'` hace `enVuelo = false; procesarCola();` **sin comprobar si
el id es el que esperaba**. Cuando por fin llega el resultado de la frase que
dimos por perdida, el código cree que se ha liberado el worker y **manda una
tercera frase**. Verificado: ningún módulo compara el id recibido con el id en
vuelo.

### 1.4 Y la medición se contamina con el resultado caducado

En el mismo bloque, `banco.registrar(...)` se llama **antes** y **sin
condición**, así que el `duracionMs` de un trabajo que estuvo compitiendo con
otro entra en la estadística como si fuera un tiempo limpio. **Es exactamente
lo que pediste que no pasara: procesar resultados caducados como actuales.**

### 1.5 El mismo defecto está en el traductor

`traductor.js` líneas 223-226: patrón idéntico. `transcriptor.js` usa un
esquema distinto (`cancelarEnVuelo`) y no parece afectado.

### 1.6 Simulación de la cascada

Reproduje la lógica real en un reloj simulado, partiendo de un coste **limpio
de 2.000 ms/s** (el de tus frases 1 a 4) y alimentándolo con tus duraciones
reales llegando cada 12 s:

```
t=84s   TIMEOUT #4 (su inferencia SIGUE viva en el worker)
t=86s   resultado CADUCADO #4 -> igual libera enVuelo
t=114s  TIMEOUT #6 (su inferencia SIGUE viva en el worker)
t=116s  TIMEOUT #7 (su inferencia SIGUE viva en el worker)
t=144s  TIMEOUT #9 (su inferencia SIGUE viva en el worker)

Máximo de inferencias SOLAPADAS en el worker: 5
Inferencias todavía vivas al final:          5
```

**La primera cascada arranca en la frase #4.** Tus mediciones:

| Frase | ms/s medidos | |
|---|---|---|
| 1 | 2.001 | |
| 2 | 1.987 | |
| 3 | 2.005 | 29.656 ms — a 344 ms del límite |
| 4 | 1.957 | **30.572 ms — PRIMER TIMEOUT** |
| 7 | 2.899 | |
| 8 | 3.640 | |
| 9 | 3.666 | |
| 10 | 3.555 | |

Las cuatro primeras son limpias y constantes (±2 %). **La degradación empieza
justo después del primer timeout** y se estabiliza en ~1,8× el valor limpio —
que es lo que cuesta repartir un núcleo entre **dos** inferencias.

> **Conclusión honesta:** el coste real del motor de voz en tu equipo es del
> orden de **2.000 ms/s**, no 3.600. El resto es un defecto mío.
>
> **Pero 2.000 ms/s sigue siendo el doble de lo necesario.** Arreglar esto
> deja de empeorar, no lo arregla. Por eso el punto siguiente es el que decide.

---

## 2. Motor de voz viable (el punto 1 de tu encargo)

### 2.1 La vía que pides: voz del sistema vía `chrome.tts`

**Es la vía correcta y la recomiendo**, con reservas que hay que medir.

Lo verificado en la documentación oficial de Chrome y en el código fuente de
Chromium (`chrome/common/extensions/api/tts.json`):

- **`chrome.tts` existe en MV3** y devuelve promesas desde Chrome 101.
- `chrome.tts.getVoices()` devuelve objetos con una propiedad
  **`remote: boolean`** — *«If true, the synthesis engine is a remote network
  resource»*. **Ésta es la comprobación exacta que pediste**: no hay que
  suponer si una voz es local, se puede leer.
- Tiene eventos `start` / `end` / `error`, que es lo que necesitamos para el
  ducking preciso del audio original.
- Tiene parámetro **`rate`**, que cambia la velocidad **sin alterar el tono**
  (al contrario que nuestro `playbackRate`, que es acelerar la cinta). Esto
  ataca directamente la expansión de 1,14× que te preocupa.

**No presupongo que sea offline.** Las voces «Google …» del navegador **sí son
remotas**: envían el texto a servidores de Google. Las voces del sistema
Windows (SAPI5: Microsoft Helena, Sabina, Laura, Pablo) son locales. El filtro
`remote === false` las distingue, y además lo verificaremos **en modo avión**.

### 2.2 Las tres reservas, dichas antes de empezar

1. **`chrome.tts` NO está disponible en el documento offscreen.** La
   documentación oficial dice: *«The runtime API is the only extensions API
   supported by offscreen documents»*. Habría que llamarlo desde el service
   worker y que éste avise al offscreen para el ducking. Es un rodeo, no un
   bloqueo — pero cambia la arquitectura.
2. **El audio de `chrome.tts` no pasa por nuestro AudioContext.** No podemos
   mezclarlo ni medirlo. Sí podemos agachar el original, que sí controlamos.
   *(Efecto colateral bueno: al no salir por la pestaña, `tabCapture` no lo
   recoge y no hay realimentación.)*
3. **Puede que no tengas voz española instalada.** Windows no siempre la trae.
   Se comprueba en un minuto y se instala desde Configuración → Hora e idioma
   → Voz.

### 2.3 Lo que NO propongo

- **Nada en la nube.** No lo plantearé sin autorización expresa.
- **Piper TTS.** Más rápido que MMS-TTS, pero sigue siendo inferencia en
  nuestro hilo de WebAssembly. Mismo techo.
- **Servidor local en Python.** Lo descartaste al definir el proyecto.

---

## 3. Sincronización real (el punto 2 de tu encargo)

Aquí es donde necesito ser más claro, porque hay un límite que no se puede
sortear con ingeniería.

### 3.1 Por qué NO se puede «procesar por adelantado»

`tabCapture` entrega el audio **según se reproduce**. No existe «el audio del
minuto siguiente»: todavía no ha sonado.

Y la trampa evidente —reproducir un trozo oculto, adelantarse y rebobinar— **no
funciona**, y conviene entender por qué para no perder tiempo en ella:

> Lo que capturamos **es** lo que el usuario está viendo. Un solo flujo, un
> solo reloj. Si rebobinas para ganar ventaja, al volver a avanzar estás
> capturando otra vez lo mismo: el adelanto se **consume** y no se repone.
> **Una ventaja inicial sólo se puede gastar, nunca mantener.**

### 3.2 Lo que sí determina si esto funciona

Sea **C** el coste del procesamiento en segundos de CPU por segundo de audio,
y **r** la velocidad de reproducción del vídeo.

- Si **r · C < 1** → el retraso se estabiliza en un valor fijo y **no crece**.
- Si **r · C > 1** → **ningún búfer lo arregla.** Crecerá para siempre.

| Motor | C estimado | r máximo viable |
|---|---|---|
| MMS-TTS int8 (hoy) | ~2,3 (voz 2,0 + ASR/MT 0,3) | **0,43×** — invisible como vídeo |
| `chrome.tts` local | ~0,3 (sólo ASR + MT) | **3,3×** — sobra margen |

**Ésta es la razón de fondo por la que el punto 1 va antes que el punto 2.**
Un búfer fijo no compensa un procesamiento permanentemente lento — lo dijiste
tú y es exactamente así.

### 3.3 El retraso mínimo, y por qué no puede ser cero

Aunque el procesamiento fuese instantáneo, el doblaje de una frase no puede
existir hasta que **la frase haya terminado de sonar**. Con el VAD actual:

| Componente | Segundos |
|---|---|
| Esperar a que acabe la frase | hasta 12 (corte del VAD) |
| Transcribir (Whisper tiny) | 2 – 3 |
| Traducir (OPUS-MT) | 1 – 2 |
| Arrancar la voz del sistema | 0,1 – 0,3 |
| **Retraso total** | **~15 s (entre 4 y 16 según la frase)** |

**Te pido que aceptes un retardo fijo de 15-20 segundos.** No es negociable por
la vía técnica: es causalidad. Lo que sí se puede es **bajar el corte del VAD**
de 12 s a 5-6 s, lo que dejaría el retraso en **~8-10 s** a cambio de frases
más cortas y traducciones algo peores (sin tanto contexto). Eso **sí** es una
decisión tuya, y toca el VAD, que hasta ahora estaba vetado.

### 3.4 Cómo conseguir que la imagen acompañe

Dijiste lo importante: *retrasar solamente el audio no sincroniza la escena*.
Correcto. Hay dos formas, y son muy distintas de coste.

#### Opción A — Control de la reproducción (barata, fea a ratos)

Un content script gobierna el `<video>` de la página. La extensión mantiene un
retraso objetivo D. Si el doblaje se queda corto, **baja `playbackRate` a
0,85-0,95×** o, en el peor caso, **pausa**.

- **Imagen y sonido se frenan juntos**, así que la escena nunca se descoloca.
- Coste de implementación: bajo. Coste de CPU: cero.
- **Precio:** el vídeo se ve ligeramente ralentizado o con micro-pausas, como
  un vídeo que almacena en búfer.
- **No alinea la imagen con la voz**: sólo impide que la distancia crezca. La
  imagen seguiría ~15 s por delante.

#### Opción B — Línea de retardo de vídeo (cara, es la de verdad)

Capturar también el **vídeo** de la pestaña, grabarlo en trozos con
`MediaRecorder`, y reproducirlo **D segundos después** en una capa `<video>`
sobre la página mediante `MediaSource`.

- **Esto sí alinea imagen, audio original y voz española**, porque retrasa
  las tres cosas por igual. Es la técnica clásica de «delay line».
- **Precio honesto:**
  - Codificar y decodificar vídeo en continuo. Suele ir acelerado por
    hardware, pero **no está medido en tu equipo**.
  - 15-20 s de vídeo en memoria (decenas de MB, asumible).
  - **Contenido con DRM (Netflix, Disney+, Prime) se captura en negro.**
    Funcionaría en YouTube y similares, no en plataformas de pago.
  - Complejidad alta: es, de largo, la pieza más difícil del proyecto.

**Mi recomendación: A primero, B después y sólo si A demuestra que la cadena
aguanta.** Construir B sobre una cadena que no cumple `r · C < 1` sería tirar
el trabajo.

---

## 4. Lo que puedo comprobar y lo que no

| Puedo comprobarlo yo, aquí | Sólo se puede medir en tu equipo |
|---|---|
| El defecto de colas (hecho, arriba) | Si tienes voz española local instalada |
| Que `chrome.tts` expone `remote` (hecho) | La latencia real de `chrome.tts.speak()` |
| Que no está en offscreen (hecho) | Si sigue hablando en modo avión |
| Simular la cascada (hecho) | Caracteres por segundo de la voz del sistema |
| Escribir las pruebas de la lógica | Si la línea de retardo de vídeo es asumible |

**No voy a prometerte rendimiento.** Lo que propongo es medirlo **antes** de
escribir nada, con el paso 0 de aquí abajo.

---

## 5. Plan por pasos

### Paso 0 — Sonda de voces (CERO cambios en el repo, 5 minutos)

Un fragmento que pegas en la consola del **service worker**. No modifica nada:
sólo pregunta y mide. Decide si todo lo demás tiene sentido.

Responde: qué voces hay, cuáles son `remote: false`, si hay español, cuánto
tarda en empezar a hablar, y cuántos caracteres por segundo dice. Y lo repites
**en modo avión** para probar que es local de verdad.

### Paso 1 — Arreglar colas y timeouts (pequeño, independiente, útil igual)

Cancelación real, serialización en los workers, ignorar resultados caducados y
no contaminar la medición. **Beneficia también a Whisper y al traductor.** Hay
que hacerlo decidas lo que decidas sobre la voz.

Medible: con MMS-TTS, el coste debería volver a ~2.000 ms/s y dejar de crecer.

### Paso 2 — Motor `chrome.tts` como alternativa seleccionable

El sintetizador actual **no se borra**: se añade un segundo motor y un
selector. Si tu equipo tiene voz local, la usa; si no, avisa.

### Paso 3 — Control de reproducción (Opción A) y reloj de medios

Que subtítulo, voz y escena se coordinen por **tiempos del audio original**, no
por el orden de llegada. Esto es lo que pediste en el punto 4.

### Paso 4 — Decisión informada sobre la línea de retardo de vídeo (Opción B)

Con datos de los pasos anteriores, no antes.

---

## 6. Prueba mínima (el punto 4 de tu encargo)

Tras los pasos 1-3, **5 minutos de vídeo** con transcripción, traducción y voz
activas. Criterios de aceptación, todos medibles y todos pensados para que
**no se pueda aprobar omitiendo contenido**:

| # | Criterio | Cómo se mide | Umbral |
|---|---|---|---|
| 1 | **Cobertura**: no se omite contenido | frases habladas ÷ frases traducidas | **≥ 95 %** |
| 2 | **Nada resumido sin avisar** | caracteres dichos ÷ caracteres traducidos | **≥ 98 %** |
| 3 | **Voz continua** | huecos de silencio con cola pendiente | **ninguno > 2 s** |
| 4 | **Retraso estable, no creciente** | retraso en el minuto 1 vs. minuto 5 | **crecimiento < 2 s** |
| 5 | **Colas acotadas** | máximo de elementos en cola | **≤ 2 todo el rato** |
| 6 | **Sin descartes masivos** | frases descartadas | **0** |
| 7 | **Sin solapamiento oculto** | inferencias vivas a la vez | **siempre 1** |
| 8 | **Coordinación por tiempo de medios** | desfase entre subtítulo, voz y escena | **< 1 s entre sí** |
| 9 | **Ducking** | ganancia del original mientras habla | **≤ 20 %** |

El informe lo emitirá la extensión en una sola tabla; no tendrás que pegar
logs ni hacer cuentas.

> **Criterio 1 y 2 son los importantes.** Están puestos precisamente para que
> no se pueda declarar victoria leyendo la mitad del contenido.

---

## 7. Lo que te pido que decidas

1. **¿Ejecutas el paso 0?** Es gratis, no toca el repo y decide todo lo demás.
2. **¿Autorizas el paso 1** (colas y timeouts) en cualquier caso? Es un
   defecto real y beneficia a los tres módulos.
3. **¿Aceptas un retardo fijo de 15-20 s?** Y si no, ¿autorizas **bajar el
   corte del VAD** a 5-6 s para dejarlo en ~8-10 s, sabiendo que las
   traducciones perderán algo de contexto? **El VAD estaba vetado hasta ahora
   y no lo toco sin permiso.**
4. **¿La imagen debe quedar alineada con la voz** (Opción B, cara y sin DRM) o
   te vale con que **la voz no se pierda ni crezca el desfase** (Opción A)?

---

## 8. Lo que seguirá sin resolverse

- **Con contenido DRM** (Netflix, Disney+, Prime) la Opción B no funciona:
  se captura en negro. La Opción A sí.
- **Sincronía labial: imposible.** El retraso mínimo es la duración de la
  frase. No lo prometeré nunca.
- **Si no tienes voz española local**, hay que instalarla en Windows. Si no se
  puede, esta vía se cierra y habría que volver a hablar.
- **Calidad de voz**: las voces SAPI de Windows suenan más robóticas que
  MMS-TTS. Se gana continuidad y se pierde naturalidad. Es un intercambio, y
  es tuyo.
- **Whisper tiny seguirá equivocándose**, y la voz leerá esos errores en voz
  alta — que es más molesto que leerlos en un subtítulo.
