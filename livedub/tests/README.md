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

Ninguna prueba Chrome, Web Audio, WASM ni el modelo: eso sólo se
valida a mano (ver `docs/PRUEBA-NIVEL2.md`).
