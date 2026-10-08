# Checklist de prueba Nivel 2 — LiveDub Fase 5 (voz en español + ducking)

Rellena los huecos mientras pruebas. Al terminar, pégame el archivo entero.

- **Fecha:** ____________________
- **CPU:** ____________________
- **Vídeo en inglés usado:** ____________________

---

## PASO 1 — Descargar el modelo de voz

**Cuánto pesa:** unos **38 MB** (un solo archivo `.onnx` cuantizado), más tres
JSON pequeños. Es **el más ligero de los tres modelos** del proyecto: menos que
el traductor (~113 MB) y menos que Whisper.

Abre **PowerShell**, sitúate en la carpeta que contiene `livedub`, y escribe
esto **literalmente**:

```powershell
bash livedub/models/descargar-modelo-voz.sh
```

- ¿Terminó con «Modelo de voz completo»? Sí / No
- Si falló algo, pega aquí el RESUMEN del script:

```
```

Ahora comprueba que los **tres** modelos están completos:

```powershell
powershell -ExecutionPolicy Bypass -File livedub\models\verificar-modelos.ps1
```

- ¿Dijo `TODO CORRECTO`? Sí / No

> Si el script de descarga diera 404 en algún archivo: la lista de nombres está
> tomada de la estructura estándar de los repos `Xenova/mms-tts-*`, pero **no
> he podido verificarla en vivo** (este entorno no llega a huggingface.co). Los
> nombres reales están en <https://huggingface.co/Xenova/mms-tts-spa/tree/main>.
> Pásame el error y lo ajusto.

## PASO 2 — Activar el doblaje

1. `chrome://extensions` → LiveDub → **Recargar (↻)**.
2. Abre el vídeo en inglés y pulsa **Iniciar**.
3. En el popup verás una casilla nueva: **«Leer traducción en voz alta»**.
   Márcala.

> El modelo de voz **sólo se carga cuando marcas la casilla**. Es intencionado:
> si sólo quieres subtítulos, no se gastan 38 MB ni CPU. La primera vez que la
> marques tardará unos segundos en cargar.

- ¿Apareció una **tercera insignia** («Voz …») junto a las otras dos? Sí / No
- Tiempo desde que marcaste la casilla hasta «Voz lista»: ______ segundos

---

## 1. El doblaje suena

| # | ¿Se oyó la voz en español? | ¿Se entiende? | ¿Coincide con el subtítulo `ES:`? |
|---|---|---|---|
| 1 | Sí / No | Sí / Regular / No | Sí / No |
| 2 | Sí / No | Sí / Regular / No | Sí / No |
| 3 | Sí / No | Sí / Regular / No | Sí / No |

- ¿La voz suena natural o muy robótica? ____________________
- ¿Se corta o se solapa con la frase siguiente? Sí / No

## 2. Ducking — lo más importante de esta fase

- Mientras habla el doblaje, ¿**baja** el volumen del vídeo original? Sí / No
- ¿Vuelve a subir al terminar? Sí / No
- ¿El cambio se siente **suave** o como un corte brusco? Suave / Brusco
- ¿Se sigue oyendo el original de fondo (no se silencia del todo)? Sí / No
- Con dos frases seguidas de doblaje, ¿sube y baja entre medias
  (efecto «bombeo»)? Sí / No → **debería ser NO**
- ¿Queda el volumen agachado después de pulsar **Detener**? Sí / No
  → **debería ser NO**

## 3. Latencia y desfase — qué esperar

**Lo que ya sabemos medido:** transcripción ~2,5 s + traducción ~0,4-2,3 s.

**Estimación para la voz, y es una ESTIMACIÓN, no una medida:** VITS genera
bastante más rápido que el tiempo real, así que una frase de 5 s de audio
debería sintetizarse en torno a **0,5–2 s** en un núcleo. No lo he medido: no
puedo ejecutar Chrome. Mídelo tú:

| # | Duración de la frase | Transcripción | Traducción | Voz (consola) | Total hasta oír |
|---|---|---|---|---|---|
| 1 | ____ s | ____ s | ____ s | ____ ms | ____ s |
| 2 | ____ s | ____ s | ____ s | ____ ms | ____ s |
| 3 | ____ s | ____ s | ____ s | ____ ms | ____ s |
| 4 | ____ s | ____ s | ____ s | ____ ms | ____ s |
| 5 | ____ s | ____ s | ____ s | ____ ms | ____ s |

En la consola del offscreen, filtra por `sintetizador` y busca la línea:
`N s de voz generados en M ms (xK tiempo real)`.

- Valor de `xK` observado (cuántas veces más rápido que el tiempo real): ______

**ADVERTENCIA QUE HAY QUE DAR AL USUARIO, y quiero tu opinión sobre ella:**

> El doblaje va **entre 4 y 9 segundos por detrás** del vídeo. No es un error
> corregible: es la suma de esperar a que termine la frase (hasta 12 s),
> transcribirla, traducirla y sintetizarla. LiveDub sirve para **entender**
> contenido hablado, no para sincronía labial.

- ¿Te parece aceptable ese desfase para el uso real? Sí / No
- ¿Llega a molestar oír el original y el doblaje desfasados? ____________________

## 4. El interruptor funciona de verdad

- Desmarcar la casilla **con el vídeo en marcha**: ¿deja de hablar? Sí / No
- ¿Vuelve el volumen original a su nivel al desmarcar? Sí / No
- ¿Siguen apareciendo los subtítulos con la casilla desmarcada? Sí / No
- Volver a marcarla: ¿vuelve a hablar sin recargar la extensión? Sí / No
- Cerrar y reabrir el popup: ¿la casilla **recuerda** cómo estaba? Sí / No

## 5. Fallo controlado del modelo de voz

Con la extensión parada:

```powershell
Copy-Item livedub\models\mms-tts-spa\tokenizer.json $env:TEMP\voz-backup.json
Remove-Item livedub\models\mms-tts-spa\tokenizer.json
```

> ⚠ Esta vez uso `Copy-Item` + `Remove-Item` en vez de `Move-Item`, para que
> tengas una copia de seguridad aunque te olvides de restaurar.

Recarga, inicia, y marca la casilla de voz.

| Comprobación | Resultado |
|---|---|
| Insignia de **transcripción** | ____________ |
| Insignia de **traducción** | ____________ |
| Insignia de **voz** | ____________ |
| ¿Cuánto tardó en dar el error? | ______ s |
| Línea `✘ …` de la consola (cópiala) | |
| ¿Siguen apareciendo subtítulos EN + ES? | Sí / No |
| ¿El audio original se sigue oyendo con normalidad? | Sí / No |
| ¿Se quedó el volumen agachado? | Sí / No → **debe ser NO** |
| ¿Excepción con *stack trace* NO capturada? | Sí / No |

- ¿Apareció `Tiempo agotado al cargar la voz` (a los 90 s)? Sí / No
  → **debería ser NO**: el pre-chequeo tiene que cazarlo en segundos.
- **Lo importante:** ¿transcripción y traducción funcionaron con normalidad,
  ajenas al fallo de la voz? **Sí / No**

**Restaurar:**

```powershell
Copy-Item $env:TEMP\voz-backup.json livedub\models\mms-tts-spa\tokenizer.json
powershell -ExecutionPolicy Bypass -File livedub\models\verificar-modelos.ps1
```

## 6. Offline con doblaje

DevTools (en la pestaña capturada) → *Network* → **Offline**.

- ¿Sigue transcribiendo? Sí / No
- ¿Sigue traduciendo? Sí / No
- ¿Sigue **hablando**? Sí / No
- ¿Alguna petición de red en la pestaña *Network* del offscreen? Sí / No
  - Si sí, pega la URL: ____________________

## 7. Sin regresiones (Fases 1-4)

| Criterio | Resultado |
|---|---|
| El audio original se oye con normalidad (sin doblaje) | Sí / No |
| El medidor se mueve | Sí / No |
| `livedub.setGain(0.2)` / `livedub.setGain(1)` funcionan | Sí / No |
| Detener y volver a Iniciar sin recargar | Sí / No |
| Los subtítulos EN/ES siguen bien formados | Sí / No |
| «Llama» se sigue preservando sin traducir | Sí / No |
| Tras ~1 min sin tocar nada, el popup sigue diciendo «Capturando» | Sí / No |

- `livedub.estado()` — pega la salida (ahora trae `sintetizador`,
  `doblajeActivo` y `doblandoAhora`):

```
```

## 8. Carga de CPU

Con los tres modelos activos a la vez:

- ¿El audio original se entrecorta? Sí / No
- ¿El vídeo se ve a tirones? Sí / No
- ¿El equipo se calienta o se oye el ventilador? Sí / No
- ¿Recomendarías dejar el doblaje activado por defecto? Sí / No

Notas / cualquier cosa anómala:

```
```
