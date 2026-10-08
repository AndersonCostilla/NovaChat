# Prompt de continuación — LiveDub

Copia todo lo que hay debajo de la línea y pégalo al empezar una sesión nueva.

---

## Contexto del proyecto

Estoy construyendo **LiveDub**, una extensión de Chrome (Manifest V3) que
dobla al español, en tiempo real y **100 % en local**, el audio en inglés de
la pestaña activa. Mi objetivo es **entender contenido hablado en otro idioma
sin tener que leer subtítulos**.

**No soy programador.** Uso Windows y PowerShell. Necesito comandos literales
para copiar y pegar, y explicaciones sin jerga. Toda entrega empieza con:

```
cd /c/Users/Janus/Desktop/NovaChat
git pull origin arena/5e149d9c-novachat
```

## Reglas permanentes del proyecto

- JavaScript vanilla con módulos ES. Sin React, sin frameworks, sin build.
- Prohibido cargar scripts desde CDN. Todo local, gratis, sin API keys, sin
  backend, sin telemetría, sin Python.
- **Prohibido pasar a servicios de voz o traducción en la nube** sin pedirme
  autorización explícita.
- Comentarios y textos de interfaz **en español**.
- Un archivo por responsabilidad. Los tipos de mensaje viven todos en
  `messages.js`; nada de strings sueltos.
- **Prohibido borrar o renombrar archivos del repo sin preguntarme antes.**
- El estado del service worker va en `chrome.storage.session`, nunca en
  memoria.
- **No tocar la lógica de captura, el doble AudioContext ni la transcripción
  base.** Están confirmados funcionando.
- Los pesos de los modelos no entran en Git.
- **Verificación de dos niveles, siempre:** Nivel 1 estático (`node --check`,
  suite de pruebas, manifiesto) en el sandbox; Nivel 2 humano, yo en Chrome.
  **No me presentes como verificado lo que solo es revisión de código**, y si
  una comprobación tiene alcance limitado déjalo escrito **en el repo**, no
  solo en el chat.
- Una entrega = un commit con mensaje claro, y en el chat el resumen por
  archivo.
- **Si hace falta que acepte un compromiso, explícamelo ANTES de
  implementarlo.** Si algo no se puede saber sin medir, dímelo en vez de
  adivinar. **Exijo mediciones en mi equipo, no promesas de rendimiento.**
- **Prohibido prometer «cero latencia».**
- **Prohibido conseguir continuidad omitiendo contenido o resumiendo** lo que
  dicen sin avisarme.
- Valoro que corrijas tus propios datos erróneos en vez de dejarlos pasar.

## Dónde está el código

Repositorio `AndersonCostilla/NovaChat`, rama **`arena/5e149d9c-novachat`**.
Todo el proyecto está en la carpeta `livedub/`. HEAD actual: **`0cdfa4e`**.

## Qué está hecho y funcionando

| Fase | Estado |
|---|---|
| 1-2 Captura de pestaña + VAD | ✅ verificado en Chrome |
| 3 Transcripción (Whisper tiny, ONNX int8, local) | ✅ verificado en Chrome |
| 4 Traducción (OPUS-MT en→es, local) | ✅ verificado en Chrome |
| 5 Voz | ✅ **recién verificado y funcionando** |
| 6 Overlay en la página | pausada, no empezada |

**La prueba del motor de voz nuevo salió bien.** El doblaje suena, es
continuo y el desfase es estable.

### Cómo se llegó aquí (resumen de las dos últimas entregas)

1. **Se corrigió un bug de concurrencia** en las colas (commit `96b8633`). Al
   vencer el timeout, el código declaraba libre un worker que seguía
   calculando y le metía otra tarea encima; además los workers no
   serializaban. Llegaba a haber 5 inferencias solapadas. Ahora hay un único
   `id` en vuelo, cancelación real con acuse, y nada libera el hueco salvo un
   único punto que comprueba el id.

2. **Se cambió el motor de voz** (commit `0cdfa4e`). Antes era MMS-TTS por
   ONNX: tardaba ~2.000 ms en generar cada segundo de voz y el retraso crecía
   sin límite. Ahora habla la **voz española instalada en Windows**
   («Microsoft Raul», SAPI) vía `speechSynthesis` desde el documento
   offscreen. Coste de CPU prácticamente nulo. **Comprobado que es realmente
   offline** (idéntico con y sin cable de red) y que funciona con el popup
   cerrado. **No hizo falta el permiso `"tts"`**: el manifiesto no cambió.
   MMS-TTS se conserva como **reserva automática** para quien no tenga voz
   española instalada.

### Archivos relevantes del doblaje

- `livedub/voz-sistema.js` — motor por defecto. Cola serializada, troceado
  por oraciones, vigilante por si el evento `end` no llega.
- `livedub/motor-voz.js` — fachada: elige motor y coordina el ducking.
- `livedub/ducking.js` — baja y sube el audio original (común a los dos).
- `livedub/sintetizador.js` + `sintetizador-worker.js` + 
  `reproductor-doblaje.js` — motor de **reserva** MMS-TTS. No borrar.
- `livedub/offscreen.js` — VAD, orquestación y comandos de consola.
- `livedub/messages.js` — todas las constantes.
- 12 suites de pruebas en `livedub/tests/`, todas en verde.

### Decisiones ya tomadas (no reabrir sin preguntarme)

- `NUM_BEAMS` se queda en **1**.
- El motor **float32** de MMS-TTS está descartado **con dato medido**: fue
  un 14 % más lento que int8, no más rápido.
- El parámetro `rate` de la voz del sistema **no funciona** con las voces
  SAPI de Windows: medido, a 1.2 la locución dura lo mismo que a 1.0. Está
  fijado en 1 y no se diseña nada sobre él.
- **Rechacé retrasar o manipular el vídeo** (pausarlo, ralentizarlo, usar
  `playbackRate` adaptativo). El vídeo se reproduce normal, a su ritmo, y no
  se toca. Mi caso de uso es YouTube.
- Solo se usan voces con `localService === true`. Las voces «Google español»
  son de red y enviarían el texto fuera: están filtradas a propósito.

---

## EL ENCARGO ACTUAL

**El desfase medido es de unos 15 segundos, es estable y no crece. Ahora
quiero bajarlo todo lo que se pueda.**

Lo que ya me has explicado y he entendido: el retraso **no** viene de la
velocidad de la síntesis, sino de la causalidad del proceso. Está repartido
así, aproximadamente:

| Etapa | Coste estimado |
|---|---|
| Esperar a que la frase termine (VAD) | **hasta 12 s** ← el grueso |
| Transcribir con Whisper | 2 – 3 s |
| Traducir con OPUS-MT | 1 – 2 s |
| Sintetizar la voz | ~0 s |

Las constantes actuales del VAD, en `livedub/offscreen.js`:

```
FRECUENCIA_PROCESO  = 16000   // Hz
bloque              = 4096 muestras = 0,256 s
MAX_FRASE_CHUNKS    = 47      // 47 × 0,256 = 12,03 s de tope por frase
MAX_SILENCE_CHUNKS  = 3       // 0,77 s de silencio para dar la frase por cerrada
VAD_THRESHOLD       = 0.005
```

### Lo que te pido, en este orden

**1. MEDIR ANTES DE TOCAR NADA.** No quiero que optimices a ciegas. Necesito
saber **dónde se va realmente el tiempo en una sesión real**, no en teoría.
Instrumenta la tubería para que cada frase registre: cuánto duró, si se cerró
por silencio o por llegar al tope de 12 s, cuánto tardó Whisper, cuánto el
traductor, cuánto esperó en cola y cuándo empezó a sonar. Dame un comando de
consola que me saque esa tabla y dime exactamente qué vídeo probar y qué
pegarte.

**Aclara también una ambigüedad de mi medición anterior:** no tengo claro si
los ~15 s los medí desde que **empieza** la frase en inglés o desde que
**termina**. Dime cuál de las dos cosas hay que medir y por qué, porque creo
que cambia bastante el diagnóstico.

**2. DESPUÉS, proponme las opciones para bajarlo, con su coste.** Sé que la
palanca grande es el tope de 12 s del VAD y que bajarlo parte las frases y
empeora la traducción. **Antes lo rechacé por ese motivo, pero ahora mi
prioridad ha cambiado: quiero recortar el desfase.** Aun así **no lo cambies
por tu cuenta**: explícame cuánto bajaría el retraso y cuánto empeoraría la
traducción con cada valor, y decido yo. Si hay otras vías (cerrar las frases
antes por silencio, solapar etapas, empezar a hablar por cláusulas en vez de
esperar a la frase entera), ponlas sobre la mesa con sus riesgos.

**3. Dime cuál es el suelo.** Cuánto es lo mínimo teórico al que se puede
llegar con esta arquitectura y qué habría que sacrificar para acercarse.
Prefiero un número honesto a una promesa.

### Condiciones

- **No toques el vídeo.** Sigue en pie.
- **No omitas ni resumas contenido** para ganar tiempo.
- **No cambies a la nube.**
- Si para recortar el desfase hay que empeorar la traducción, **dímelo con
  números antes de implementarlo**, no después.
- Actualiza `livedub/docs/ALCANCE-DOBLAJE.md`, que ahora mismo dice que
  acepté 15-18 s como definitivo. Esa decisión ha cambiado.

### Pendientes menores que siguen abiertos

- Quitar la etiqueta **EXPERIMENTAL** del interruptor de doblaje en el popup
  (el motor ya está verificado; quedó pendiente de la prueba larga).
- Bloque 3 de `docs/PRUEBA-NIVEL2-FASE4.md` (vídeo en idioma no inglés).
- Bloque D de `docs/PRUEBA-NIVEL2-FASE5.1.md` (impacto en los subtítulos).
- La prueba larga de 5 minutos con los 9 criterios de aceptación.
