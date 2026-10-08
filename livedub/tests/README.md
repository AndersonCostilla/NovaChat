# Pruebas automáticas (Node, sin navegador)

Todas de golpe:

```bash
bash livedub/tests/ejecutar-todo.sh
```

O una a una, con Node a secas, sin dependencias ni paso de build:

```bash
node livedub/tests/test-subtitulos.mjs   # persistencia de subtítulos (Bug 1)
node livedub/tests/test-vad-corte.mjs    # corte forzado de frases largas
node livedub/tests/test-traduccion.mjs   # traducción: heurística, cola y persistencia
node livedub/tests/test-offscreen-apis.mjs  # APIs de chrome permitidas por contexto
node livedub/tests/test-traductor-vigilante.mjs  # límite de tiempo de carga del traductor
node livedub/tests/test-segmentador.mjs  # troceo en oraciones y truncamiento de OPUS-MT
node livedub/tests/test-terminos-protegidos.mjs  # nombres propios que no se traducen
node livedub/tests/test-doblaje.mjs  # síntesis de voz, cola y ducking
node livedub/tests/test-popup.mjs   # el popup se carga y sus controles responden
```

Cada script termina con código 0 si pasa y 1 si falla.

## Qué cubre y qué NO

- **`test-subtitulos.mjs`** importa el `background.js` **real** con un `chrome`
  simulado (storage.session en memoria). Comprueba que 25 subtítulos seguidos se
  persisten, se recortan a 20 sin perder escrituras concurrentes, avisan al popup
  y se devuelven en `GET_SUBTITLES`. Esto es lo que fallaba en el Bug 1.
- **`test-vad-corte.mjs`** es una **réplica** de la máquina de estados del VAD
  (en `offscreen.js` no es exportable sin tocar la cadena de audio). Si cambias
  el VAD, actualiza también este archivo: puede quedar desincronizado.

- **`test-traduccion.mjs`** cubre la Fase 4 en cuatro bloques: la heurística de
  `detector-idioma.js`, el facade `traductor.js` con un `Worker` simulado
  (incluida la caída del modelo: ninguna promesa se queda colgada), y la
  persistencia en el `background.js` **real** de un subtítulo con original +
  traducción y de los dos estados de módulo por separado.

- **`test-offscreen-apis.mjs`** es la prueba de regresión del bug «API de
  contexto equivocado». Hace dos cosas: un análisis estático (que `offscreen.js`,
  `transcriptor.js` y `traductor.js` sólo nombren `chrome.runtime`, y que los
  workers no usen ninguna API de chrome) y una carga real de `offscreen.js` con
  un `chrome` **restringido** —sólo `runtime`—, igual que el del offscreen real.
  Verificada reintroduciendo el bug a propósito: falla con el mismo mensaje que
  dio Chrome (`Cannot read properties of undefined (reading 'onChanged')`).

> ⚠️ **Limitación conocida de las otras pruebas:** su `chrome` simulado es
> «generoso» (expone `storage`, `tabs`, `offscreen`) porque están pensadas para
> el service worker, que sí tiene esas APIs. Por eso NO detectaban este tipo de
> fallo. Si añades código al offscreen o a un worker, ejecuta
> `test-offscreen-apis.mjs`.

- **`test-traductor-vigilante.mjs`** simula un worker de traducción **mudo**
  (acepta el `INIT` y no contesta nunca) con un reloj falso, y comprueba que a
  los 90 s el estado pasa solo a `error` y que ninguna frase encolada se queda
  colgada. Verificada desactivando el vigilante: sin él, sólo 2 de 6 promesas
  se resuelven — que es exactamente el bug que reportó Anderson.

- **`test-segmentador.mjs`** usa un modelo simulado que **imita el defecto real
  de OPUS-MT** (ante varias oraciones devuelve sólo una) y lo alimenta con los
  tres casos reales que reportó Anderson, más textos de 100+ palabras y texto
  sin puntuación. Comprueba que con troceo no se pierde ninguna oración: en el
  caso 1, 31 caracteres de salida sin trocear frente a 208 con troceo.

- **`test-terminos-protegidos.mjs`** usa un modelo simulado que **comete el
  error real** (`llama` → `las 'Joyas'`) y comprueba el ciclo entero:
  sustitución → traducción → restauración. Cubre términos de varias palabras,
  el modo estricto (`meta` minúscula no se toca, `Meta` sí), marcadores
  maltratados por el modelo, y el caso en que el marcador desaparece: entonces
  se informa y **no se inventa** el término.

- **`test-doblaje.mjs`** cubre la Fase 5 con un `AudioContext` simulado:
  comprueba que el audio original baja al 18 % cuando empieza el doblaje,
  vuelve a su nivel al terminar, **no sube entre dos frases encadenadas**
  (efecto bombeo) y se restaura al parar o al apagar el interruptor. También
  prueba el vigilante de 90 s del sintetizador y que las tres claves de estado
  de módulo son distintas.

- **`test-popup.mjs`** monta un DOM simulado con los diez elementos de
  `popup.html`, importa `popup.js` **de verdad** y dispara los eventos de los
  controles. Es la única prueba que detecta errores de EJECUCIÓN en el popup
  (funciones no definidas, controles sin manejador): `node --check` no puede
  verlos porque sólo mira la sintaxis. Nació de un bug real de la Fase 5.

Ninguna prueba Chrome, Web Audio, WASM ni el modelo: eso sólo se
valida a mano (ver `docs/PRUEBA-NIVEL2.md`).
