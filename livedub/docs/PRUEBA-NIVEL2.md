# Checklist de prueba Nivel 2 — LiveDub Fase 3

Rellena los huecos mientras pruebas. Al terminar, pégame el archivo entero.

- **Fecha:** ____________________
- **Versión de Chrome** (`chrome://version`): ____________________
- **Sistema operativo:** ____________________
- **Material de prueba** (URL o descripción del vídeo): ____________________

## Preparación

```bash
bash livedub/models/descargar-modelo.sh     # ¿terminó con "Modelo completo"? Sí / No
```

- Si falló algo, pega aquí el RESUMEN del script:

```
```

Después: `chrome://extensions` → LiveDub → **Recargar (↻)** → abrir el vídeo → **Iniciar**.

Consolas útiles:
- Offscreen: `chrome://extensions` → LiveDub → *Inspeccionar vistas* → `offscreen.html`
- Popup: clic derecho sobre el popup → *Inspeccionar*

---

## 1. Primera carga del modelo

| Dato | Valor |
|---|---|
| Hora del clic en «Iniciar» | ____________ |
| Hora en que el popup pasó a «Modelo listo» | ____________ |
| **Total** | **______ segundos** |

- ¿El popup llegó a mostrar porcentaje de carga? Sí / No
- ¿Se oía el audio de la pestaña con normalidad durante la carga? Sí / No

## 2. Latencia (3-4 muestras)

El propio subtítulo muestra `hora · idioma · X.X s`. Ese número es **solo
inferencia**; no incluye los ~750 ms que el VAD espera en silencio antes de cerrar
la frase.

| # | Duración aprox. de la frase | Latencia reportada (`duracionMs`) | ¿Texto correcto? |
|---|---|---|---|
| 1 | ______ s | ______ s | Sí / Parcial / No |
| 2 | ______ s | ______ s | Sí / Parcial / No |
| 3 | ______ s | ______ s | Sí / Parcial / No |
| 4 | ______ s | ______ s | Sí / Parcial / No |

- **CPU** (modelo, generación, núcleos): ____________________
- ¿Notaste que el audio original se entrecortara al transcribir? Sí / No

## 3. Persistencia del popup

- Cerrar y reabrir el popup con la sesión activa → ¿se conservan los últimos subtítulos? **Sí / No**
- ¿Se conserva también el estado «Capturando» y el botón «Detener»? Sí / No

## 4. Offline

DevTools (en la pestaña capturada) → *Network* → **Offline**.

- ¿Sigue transcribiendo con normalidad? **Sí / No**
- ¿Aparece alguna petición de red en la pestaña *Network* del offscreen? Sí / No
  - Si sí, pega la URL: ____________________

## 5. Fallo — variante A (carpeta del modelo vacía / 404)

Mueve los pesos fuera (`mv livedub/models/whisper-tiny/onnx /tmp/`), recarga la extensión y pulsa Iniciar.

- Mensaje exacto en la consola del offscreen:

```
```

- Texto mostrado en el popup: ____________________
- ¿Hay alguna excepción con *stack trace* NO capturada? Sí / No
  *(Las líneas rojas de `404` / `net::ERR_FILE_NOT_FOUND` son ruido esperado, no cuentan.)*
- ¿Captura / medidor / VAD siguen funcionando? **Sí / No**

## 6. Fallo — variante B (`.onnx` truncado a la mitad)

Linux / macOS:

```bash
cd livedub/models/whisper-tiny/onnx
cp encoder_model_quantized.onnx /tmp/encoder.bak            # copia de seguridad
truncate -s 50% encoder_model_quantized.onnx                # lo parte por la mitad
# restaurar después:  cp /tmp/encoder.bak encoder_model_quantized.onnx
```

Windows (PowerShell) — `truncate` no existe, se corta a mano:

```powershell
cd livedub\models\whisper-tiny\onnx
Copy-Item encoder_model_quantized.onnx $env:TEMP\encoder.bak   # copia de seguridad
$f = Get-Item encoder_model_quantized.onnx
$s = [System.IO.File]::Open($f.FullName,'Open','ReadWrite')
$s.SetLength([int64]($f.Length / 2)); $s.Close()               # lo parte por la mitad
# restaurar después:
# Copy-Item $env:TEMP\encoder.bak encoder_model_quantized.onnx -Force
```

- Mensaje exacto en la consola del offscreen:

```
```

- Texto mostrado en el popup: ____________________
- ¿El mensaje es comprensible o es un volcado técnico sin traducir? ____________________
- ¿Captura / medidor / VAD siguen funcionando? **Sí / No**

## 7. Si algo falla o el VAD no dispara

Salida completa de `livedub.estado()` en la consola del offscreen:

```
```

- Con música de fondo, ¿el medidor se mantiene siempre alto sin bajar? Sí / No
- ¿Cuántas frases se detectaron en ~2 minutos de vídeo? ______

## 8. De paso: Fases 1 y 2

| Criterio | Resultado |
|---|---|
| (a) El audio se sigue oyendo con normalidad | Sí / No |
| (b) El medidor se mueve con el audio | Sí / No |
| (c) `livedub.setGain(0.2)` baja el volumen y `livedub.setGain(1)` lo restaura | Sí / No |
| (d) Detener deja todo limpio y se puede volver a Iniciar sin recargar | Sí / No |
| (Fase 2) Los cortes de frase son razonables (ni eternos ni picados) | Sí / No |
| Tras ~1 min sin tocar nada, reabrir el popup sigue diciendo «Capturando» | Sí / No |

Notas / cualquier cosa anómala:

```
```
