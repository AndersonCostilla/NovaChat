# Checklist de prueba Nivel 2 — LiveDub Fase 4 (traducción EN → ES)

Rellena los huecos mientras pruebas. Al terminar, pégame el archivo entero.

- **Fecha:** ____________________
- **Versión de Chrome** (`chrome://version`): ____________________
- **CPU:** ____________________ (referencia de Fase 3: Intel i5-12400)
- **Vídeo en inglés usado:** ____________________
- **Vídeo en otro idioma usado:** ____________________

---

## 0. ANTES DE EMPEZAR — cómo funciona el selector de idioma

**Respuesta a tu pregunta: el selector «Idioma origen» del popup YA existe y YA
está conectado a esta lógica.** No tienes que usar «Detectar automáticamente» a
la fuerza. Comportamiento exacto:

| Selección en el popup | Qué hace Whisper | Qué hace la traducción |
|---|---|---|
| **Inglés** | Se le fuerza `language: 'en'` | **Traduce siempre.** La heurística NO se consulta |
| **Detectar automáticamente** | Detecta él solo el idioma | Aplica la heurística de `detector-idioma.js`; si el texto no parece inglés, **no traduce** y avisa |
| Francés, alemán, etc. | Se le fuerza ese idioma | **No traduce** y avisa (esta fase es sólo en→es) |

La selección se guarda en `chrome.storage.local` y, desde este commit, **se
aplica en caliente**: si la cambias con la captura en marcha, afecta a la
siguiente frase, sin necesidad de Detener e Iniciar. Lo verás en la consola del
offscreen: `[LiveDub] Idioma origen cambiado a "en"`.

**Recomendación para la sesión:** haz el bloque 1 con **«Inglés»** seleccionado
(aísla la traducción de la heurística) y el bloque 2 con **«Detectar
automáticamente»** (que es justo lo que pone a prueba la heurística).

## Preparación

```powershell
bash livedub/models/descargar-modelo-traductor.sh
```

- ¿Terminó con «Traductor completo»? Sí / No
- Si falló algún archivo, pega aquí el RESUMEN del script:

```
```

- ¿Hubo archivos marcados como «opcional, se omite»? ¿Cuáles? ____________________

Después: `chrome://extensions` → LiveDub → **Recargar (↻)** → abrir el vídeo → **Iniciar**.

---

## 1. Carga del traductor

El popup tiene ahora **dos insignias** en la cabecera del panel: la de
transcripción (arriba) y la de traducción (abajo).

| Dato | Valor |
|---|---|
| Hora del clic en «Iniciar» | ____________ |
| Hora en que la insignia de abajo pasó a «Traductor listo» | ____________ |
| **Total** | **______ segundos** |

- ¿Las dos insignias cargaron en paralelo o una esperó a la otra? ____________________
- ¿Se oía el audio con normalidad durante las dos cargas? Sí / No
- `livedub.estado()` en la consola del offscreen — pega la salida:

```
```

## 2. Latencias separadas (4-5 muestras) — vídeo en INGLÉS

Con **«Inglés»** seleccionado como idioma origen. Cada subtítulo muestra en su
cabecera `hora · idioma · transcripción + traducción = total`.

| # | Duración aprox. de la frase | Transcripción | Traducción | Total | ¿Traducción correcta? |
|---|---|---|---|---|---|
| 1 | ______ s | ______ s | ______ s | ______ s | Sí / Aceptable / No |
| 2 | ______ s | ______ s | ______ s | ______ s | Sí / Aceptable / No |
| 3 | ______ s | ______ s | ______ s | ______ s | Sí / Aceptable / No |
| 4 | ______ s | ______ s | ______ s | ______ s | Sí / Aceptable / No |
| 5 | ______ s | ______ s | ______ s | ______ s | Sí / Aceptable / No |

- ¿La traducción añade décimas de segundo o segundos completos? ____________________
- ¿Se ven las dos líneas `EN:` / `ES:` claramente diferenciadas? Sí / No
- ¿La insignia de abajo parpadea a «Traduciendo…» durante la inferencia? Sí / No
- ¿El audio original se entrecorta ahora que hay dos modelos trabajando? Sí / No

## 3. Criterio 2 — vídeo en idioma NO inglés

Pon un vídeo en francés (o alemán, español, italiano…) y selecciona
**«Detectar automáticamente»** en el popup.

| # | Texto transcrito (copia 1 frase) | ¿Tradujo? | ¿Debía traducir? |
|---|---|---|---|
| 1 | | Sí / No | No |
| 2 | | Sí / No | No |
| 3 | | Sí / No | No |

- **Aviso mostrado literalmente** (cópialo tal cual del popup):

```
```

- ¿El aviso se entiende sin ser técnico? Sí / No — ¿cómo lo redactarías tú? ____________________
- ¿Acertó la heurística con el idioma? (dice «francés», «alemán»…) Sí / No / Dijo «idioma no identificado»
- ¿Hubo algún **falso positivo** (tradujo algo que no era inglés)? Sí / No
  - Si sí, pega el texto: ____________________
- **Prueba cruzada:** con ese mismo vídeo, cambia el selector a **«Inglés»**.
  ¿Ahora intenta traducir (y sale mal)? Sí / No
  *(Debe intentarlo: con selección manual tu elección manda sobre la heurística.
  Sirve para confirmar que la heurística solo actúa en modo automático.)*

## 4. Independencia de los dos módulos (insignias)

**Cómo forzar el fallo del traductor** — sí, igual que hicimos con Whisper en
Fase 3, pero sobre la carpeta `opus-mt-en-es`. Con la extensión parada:

**Variante A — pesos ausentes (PowerShell):**

```powershell
Move-Item livedub\models\opus-mt-en-es\onnx $env:TEMP\onnx-traductor-backup
# restaurar:  Move-Item $env:TEMP\onnx-traductor-backup livedub\models\opus-mt-en-es\onnx
```

**Variante B — encoder truncado (PowerShell):**

```powershell
cd livedub\models\opus-mt-en-es\onnx
Copy-Item encoder_model_quantized.onnx $env:TEMP\enc-trad.bak
$f = Get-Item encoder_model_quantized.onnx
$s = [System.IO.File]::Open($f.FullName,'Open','ReadWrite')
$s.SetLength([int64]($f.Length / 2)); $s.Close()
# restaurar:  Copy-Item $env:TEMP\enc-trad.bak encoder_model_quantized.onnx -Force
```

Recarga la extensión y pulsa Iniciar con un vídeo en inglés.

| Comprobación | Variante A (ausente) | Variante B (truncado) |
|---|---|---|
| Insignia de **transcripción** | ____________ | ____________ |
| Insignia de **traducción** | ____________ | ____________ |
| ¿Siguen apareciendo subtítulos en inglés? | Sí / No | Sí / No |
| ¿Medidor y captura siguen bien? | Sí / No | Sí / No |
| Aviso en cada subtítulo (cópialo) | | |
| Mensaje en la consola del offscreen | | |
| ¿Excepción con *stack trace* NO capturada? | Sí / No | Sí / No |

*(Recordatorio de Fase 3: las líneas rojas de `404` / `ERR_FILE_NOT_FOUND` son
ruido esperado del navegador, no cuentan como excepción sin capturar.)*

- Pasa el ratón por encima de la insignia de traducción: ¿el tooltip explica la
  causa concreta (falta / corrupto)? ____________________
- **Lo importante:** ¿la transcripción funcionó con normalidad, completamente
  ajena al fallo del traductor? **Sí / No**

Restaura los pesos antes de seguir.

## 5. Persistencia del par completo (original + traducción)

Con sesión activa y varios subtítulos bilingües en pantalla:

- Cerrar y reabrir el popup → ¿se conservan los subtítulos? Sí / No
- ¿Se conservan **las dos líneas** (`EN:` y `ES:`), no solo el original? **Sí / No**
- ¿Se conservan los tiempos (`2.1 s + 0.4 s = 2.5 s`) en la cabecera? Sí / No
- ¿Se conservan los avisos de los subtítulos sin traducción? Sí / No
- ¿Las dos insignias muestran su estado real al reabrir (no «inactivo»)? Sí / No
- Opcional, en la consola del **service worker**:

```js
chrome.storage.session.get(null, (d) => console.log(JSON.stringify(d, null, 2)))
```

Pega el resultado (debe haber `livedub.subtitulos` con `traduccion`, más
`livedub.modelo` y `livedub.traductor` por separado):

```
```

## 6. Offline

DevTools (en la pestaña capturada) → *Network* → **Offline**.

- ¿Sigue transcribiendo? Sí / No
- ¿Sigue **traduciendo**? **Sí / No**
- ¿Aparece alguna petición de red en la pestaña *Network* del offscreen? Sí / No
  - Si sí, pega la URL: ____________________

## 7. Sin regresiones en lo ya cerrado (Fases 1-3)

| Criterio | Resultado |
|---|---|
| El audio se sigue oyendo con normalidad | Sí / No |
| El medidor se mueve | Sí / No |
| `livedub.setGain(0.2)` / `livedub.setGain(1)` funcionan | Sí / No |
| Detener y volver a Iniciar sin recargar la extensión | Sí / No |
| Los cortes de frase siguen siendo razonables (máx. ~12 s) | Sí / No |
| Tras ~1 min sin tocar nada, reabrir el popup sigue diciendo «Capturando» | Sí / No |

Notas / cualquier cosa anómala:

```
```
