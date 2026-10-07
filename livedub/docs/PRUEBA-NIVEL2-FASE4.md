# Checklist de prueba Nivel 2 — LiveDub Fase 4 (traducción EN → ES)

> **Revisión 2** — actualizada tras los commits `732f940`, `7f0677e`, `c8abf21`
> y `b176cce`. La revisión 1 describía comportamientos que ya no son ciertos,
> sobre todo en el bloque 4.

Rellena los huecos mientras pruebas. Al terminar, pégame el archivo entero.

- **Fecha:** ____________________
- **Versión de Chrome** (`chrome://version`): ____________________
- **CPU:** ____________________ (referencia de Fase 3: Intel i5-12400)
- **Vídeo en inglés usado:** ____________________
- **Vídeo en otro idioma usado:** ____________________

---

## ⚠ Aviso de numeración

Tu lista de pendientes va **desfasada un número** respecto a esta plantilla.
Equivalencias, para que no repitas ni te saltes nada:

| Como lo llamaste tú | Bloque real aquí |
|---|---|
| «bloque 2 — detección automática» | **Bloque 3** |
| «bloque 3 — vídeo en otro idioma» | **Bloque 3** (es el mismo) |
| «bloque 4 — fallo del modelo» | **Bloque 4** ✔ coincide |
| «bloque 5, 6, 7» | **5, 6, 7** ✔ coinciden |

**Pendiente real: bloques 3, 4, 5, 6 y 7.** Los bloques 0, 1, 2 y 2-bis ya están
cerrados con tus datos y quedan registrados abajo.

---

## 0. Cómo funciona el selector de idioma — CERRADO

| Selección en el popup | Qué hace Whisper | Qué hace la traducción |
|---|---|---|
| **Inglés** | Se le fuerza `language: 'en'` | **Traduce siempre.** La heurística NO se consulta |
| **Detectar automáticamente** | Detecta él solo el idioma | Aplica la heurística de `detector-idioma.js`; si el texto no parece inglés, **no traduce** y avisa |
| Francés, alemán, etc. | Se le fuerza ese idioma | **No traduce** y avisa (esta fase es sólo en→es) |

Se aplica **en caliente**: si lo cambias con la captura en marcha, afecta a la
siguiente frase. En la consola del offscreen verás
`[LiveDub] Idioma origen cambiado a "en" (afecta a la próxima frase).`

> Cambio respecto a la revisión 1: la preferencia ya **no** la lee el offscreen
> de `chrome.storage` (allí no existe). La lee el service worker y se la manda
> por mensaje. El comportamiento visible es el mismo.

## 1. Carga del traductor — CERRADO ✔

Resultado: el traductor carga y pasa a «listo». Tras corregir el
`tokenizer.json` ausente y añadir el vigilante de 90 s, no vuelve a quedarse
colgado en «cargando».

## 2. Latencias — CERRADO ✔ (11 muestras)

| Tanda | Traducción | Nota |
|---|---|---|
| 1ª (`num_beams=4`, sin troceo) | 5,0 – 10,2 s | perdía oraciones enteras |
| 2ª (`num_beams=1` + troceo + lote) | 0,2 – 2,5 s | sin pérdida de oraciones |
| 3ª (+ términos protegidos) | 0,4 – 2,3 s | sin coste añadido |

## 2-bis. Términos protegidos — CERRADO ✔

`"So the llama models…"` → `"Así que los modelos Llama…"`. Sin marcadores
sueltos, sin pérdida del término, sin coste de latencia.

---

# PENDIENTE A PARTIR DE AQUÍ

## 3. Criterio 2 — vídeo en idioma NO inglés + heurística

Pon un vídeo en francés (o alemán, italiano…) y selecciona **«Detectar
automáticamente»**.

| # | Texto transcrito (copia 1 frase) | ¿Tradujo? | ¿Debía traducir? |
|---|---|---|---|
| 1 | | Sí / No | No |
| 2 | | Sí / No | No |
| 3 | | Sí / No | No |

- **Aviso mostrado literalmente** (cópialo tal cual del popup):

```
```

- ¿El aviso se entiende sin ser técnico? Sí / No — ¿cómo lo redactarías tú? ____________________
- ¿Acertó la heurística con el idioma? Sí / No / Dijo «idioma no identificado»
- ¿Hubo algún **falso positivo** (tradujo algo que no era inglés)? Sí / No
  - Si sí, pega el texto: ____________________

**Prueba cruzada** — con ese mismo vídeo, cambia el selector a **«Inglés»**:

- ¿Ahora intenta traducir (y sale mal)? Sí / No
  *(Debe intentarlo: con selección manual tu elección manda sobre la heurística.
  Confirma que la heurística solo actúa en modo automático.)*
- ¿El cambio surtió efecto **sin** Detener/Iniciar? Sí / No
- ¿Apareció `[LiveDub] Idioma origen cambiado a "en"` en la consola? Sí / No

## 4. Independencia de los dos módulos — ⚠ EXPECTATIVAS NUEVAS

> **Esto cambió desde la revisión 1.** El worker ahora comprueba los archivos
> con `fetch()` **antes** de arrancar el pipeline. Por eso cada variante falla
> de una forma distinta, y conviene saber cuál esperar: si ves otra cosa,
> es un hallazgo de verdad.

Con la extensión parada. **Prueba las tres variantes**, restaurando entre una y otra.

### Variante A — carpeta `onnx` ausente

```powershell
Move-Item livedub\models\opus-mt-en-es\onnx $env:TEMP\onnx-traductor-backup
# restaurar:  Move-Item $env:TEMP\onnx-traductor-backup livedub\models\opus-mt-en-es\onnx
```

**Esperado:** el pre-chequeo lo caza en **segundos**, no en 90 s. En consola:
`✘ onnx/encoder_model_quantized.onnx → HTTP 404`.

### Variante A2 — falta `tokenizer.json` (el bug real de esta sesión)

```powershell
Move-Item livedub\models\opus-mt-en-es\tokenizer.json $env:TEMP\tokenizer-backup.json
# restaurar:  Move-Item $env:TEMP\tokenizer-backup.json livedub\models\opus-mt-en-es\tokenizer.json
```

**Esperado:** `✘ tokenizer.json → HTTP 404` y error inmediato. Esta variante es
la que valida la corrección: antes dejaba el traductor colgado en «cargando».

### Variante B — encoder truncado

```powershell
cd livedub\models\opus-mt-en-es\onnx
Copy-Item encoder_model_quantized.onnx $env:TEMP\enc-trad.bak
$f = Get-Item encoder_model_quantized.onnx
$s = [System.IO.File]::Open($f.FullName,'Open','ReadWrite')
$s.SetLength([int64]($f.Length / 2)); $s.Close()
# restaurar:  Copy-Item $env:TEMP\enc-trad.bak encoder_model_quantized.onnx -Force
```

**Esperado (y distinto a propósito):** el pre-chequeo **pasa en verde**, porque
sólo mira si el archivo responde `HTTP 200` y un archivo truncado existe. El
fallo salta después, dentro de ONNX, con un error de *protobuf*, y la insignia
debe decir «corrupto o incompleto».

### Resultados

| Comprobación | A (ausente) | A2 (sin tokenizer) | B (truncado) |
|---|---|---|---|
| Insignia de **transcripción** | ______ | ______ | ______ |
| Insignia de **traducción** | ______ | ______ | ______ |
| ¿Cuánto tardó en dar el error? | ____ s | ____ s | ____ s |
| Línea `✘ …` de la consola (cópiala) | | | |
| ¿Siguen apareciendo subtítulos en inglés? | Sí/No | Sí/No | Sí/No |
| ¿Medidor y captura siguen bien? | Sí/No | Sí/No | Sí/No |
| Aviso en cada subtítulo (cópialo) | | | |
| ¿Excepción con *stack trace* NO capturada? | Sí/No | Sí/No | Sí/No |

- ¿Apareció en algún caso **`Tiempo agotado al cargar el traductor`** (a los 90 s)?
  Sí / No → **Debería ser NO en las tres.** Si sale que sí, es un modo de fallo
  nuevo que no habíamos visto: anótalo.
- Tooltip de la insignia de traducción: ¿explica la causa concreta? ____________________
- **Lo importante:** ¿la transcripción funcionó con normalidad, ajena al fallo
  del traductor? **Sí / No**

*(Las líneas rojas de `404` / `ERR_FILE_NOT_FOUND` son ruido esperado del
navegador, no cuentan como excepción sin capturar.)*

**Restaura los tres archivos antes de seguir.**

## 5. Persistencia del par completo (original + traducción)

Con sesión activa y varios subtítulos bilingües en pantalla:

- Cerrar y reabrir el popup → ¿se conservan los subtítulos? Sí / No
- ¿Se conservan **las dos líneas** (`EN:` y `ES:`), no solo el original? **Sí / No**
- ¿Se conservan los tiempos (`2.1 s + 0.4 s = 2.5 s`) en la cabecera? Sí / No
- ¿Se conservan los avisos de los subtítulos sin traducción? Sí / No
- ¿Las dos insignias muestran su estado real al reabrir (no «inactivo»)? Sí / No
- En la consola del **service worker**:

```js
chrome.storage.session.get(null, (d) => console.log(JSON.stringify(d, null, 2)))
```

Pega el resultado. Debe haber `livedub.subtitulos` con `traduccion`, más
`livedub.modelo` y `livedub.traductor` **en claves separadas**:

```
```

- ¿Aparecen los campos nuevos `trozos` y `terminosProtegidos` en algún subtítulo? Sí / No
  *(Son informativos; que falten no es un fallo, pero confirma que llegan.)*

## 6. Offline

DevTools (en la pestaña capturada) → *Network* → **Offline**.

- ¿Sigue transcribiendo? Sí / No
- ¿Sigue **traduciendo**? **Sí / No**
- ¿Aparece alguna petición de red en la pestaña *Network* del offscreen? Sí / No
  - Si sí, pega la URL: ____________________
  - *(Las peticiones a `chrome-extension://` son locales y NO cuentan.)*

## 7. Sin regresiones en lo ya cerrado (Fases 1-3)

| Criterio | Resultado |
|---|---|
| El audio se sigue oyendo con normalidad | Sí / No |
| El medidor se mueve | Sí / No |
| `livedub.setGain(0.2)` / `livedub.setGain(1)` funcionan | Sí / No |
| Detener y volver a Iniciar sin recargar la extensión | Sí / No |
| Los cortes de frase siguen siendo razonables (máx. ~12 s) | Sí / No |
| Tras ~1 min sin tocar nada, reabrir el popup sigue diciendo «Capturando» | Sí / No |
| `livedub.estado()` devuelve `modelo` y `traductor` por separado | Sí / No |

En la consola del **popup** (clic derecho sobre el popup → Inspeccionar), ahora
hay avisos que antes se callaban:

- ¿Aparece algún `[LiveDub] GET_SUBTITLES falló…` o `[LiveDub] GET_STATE falló…`? Sí / No
  *(Lo normal es que NO. Si aparecen, el popup está tirando del plan B y
  queremos saberlo — antes esto pasaba en silencio.)*

Notas / cualquier cosa anómala:

```
```
