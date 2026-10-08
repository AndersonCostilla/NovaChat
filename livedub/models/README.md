# Modelos locales de LiveDub

Aquí van los pesos de los modelos de IA. **No están en el repositorio** y hay
que colocarlos a mano una vez.

| Carpeta | Para qué | Script |
|---|---|---|
| `whisper-tiny/` | Transcripción de voz (Fase 3) | `descargar-modelo.sh` |
| `opus-mt-en-es/` | Traducción inglés → español (Fase 4) | `descargar-modelo-traductor.sh` |

Los dos módulos son **independientes**: si falta el traductor, LiveDub sigue
transcribiendo; si falta Whisper, sigue capturando audio.

## Por qué no están en Git

Los pesos cuantizados de `whisper-tiny` pesan **decenas de MB**. Meterlos en el
historial de Git lo hincharía para siempre y cada cambio futuro arrastraría esos
binarios. Decisión tomada en la Fase 3: **los pesos se quedan fuera de Git** y se
obtienen con el script de descarga. Lo versionado es sólo este README, el script
y el `.gitkeep` que mantiene visible la estructura de carpetas.

## Cómo obtenerlos

```bash
bash livedub/models/descargar-modelo.sh            # Whisper (transcripción)
bash livedub/models/descargar-modelo-traductor.sh  # OPUS-MT (traducción)
```

El script usa `curl -L --fail`, comprueba que ningún archivo haya quedado vacío o
truncado e imprime un resumen de qué se descargó y qué falló. **No se ejecuta
desde el navegador ni desde ningún código de la extensión**: es una utilidad de
desarrollo, nada más. Si falla algo, el script termina con código 1 y te lo dice.

> ⚠️ **Los nombres de archivo no están verificados en vivo.** Se corresponden con
> lo que publica hoy el repositorio `Xenova/whisper-tiny` en Hugging Face, pero si
> al ejecutar el script alguna descarga falla con 404, abre
> <https://huggingface.co/Xenova/whisper-tiny/tree/main>, mira cómo se llaman
> realmente los archivos y **ajusta la lista `ARCHIVOS` del script**.

## Estructura esperada

```
livedub/models/
  whisper-tiny/
    config.json
    generation_config.json
    preprocessor_config.json
    tokenizer.json
    tokenizer_config.json
    onnx/
      encoder_model_quantized.onnx
      decoder_model_merged_quantized.onnx
```

La carpeta `whisper-tiny/` debe llamarse exactamente así: `transcriptor-worker.js`
pide el modelo con el id `whisper-tiny` y `env.localModelPath` apunta a
`chrome-extension://<id>/models/`, de modo que transformers.js busca justo en
`models/whisper-tiny/...`.

## Traductor: `Xenova/opus-mt-en-es`

Familia OPUS-MT (Helsinki-NLP), ONNX cuantizado int8. Estructura esperada:

```
livedub/models/
  opus-mt-en-es/
    config.json
    tokenizer_config.json
    vocab.json            (o tokenizer.json, según publique el repo)
    source.spm            (SentencePiece, opcional según el repo)
    target.spm
    onnx/
      encoder_model_quantized.onnx
      decoder_model_merged_quantized.onnx
```

> ⚠️ **Lista orientativa, no verificada en vivo.** Igual que con Whisper, el
> entorno donde se escribió el script no tiene acceso a huggingface.co. Los
> archivos marcados como opcionales en el script (`generation_config.json`,
> `source.spm`, `target.spm`, `vocab.json`) no hacen fracasar la descarga si no
> existen, porque distintos repos de Marian publican combinaciones distintas.
> Si al cargar falla por un archivo concreto, añádelo a `ARCHIVOS` en el script.

La carpeta debe llamarse exactamente `opus-mt-en-es`: el worker pide el modelo
con ese id y `env.localModelPath` apunta a `models/`.

## Modelo de transcripción elegido

`Xenova/whisper-tiny`, multilingüe, ONNX **cuantizado a int8** (`quantized: true`
en el pipeline). Es el compromiso razonable para CPU + WASM dentro de una
extensión: `whisper-base` da mejor calidad pero triplica el tamaño y la latencia
por frase. Si al probar la calidad resulta insuficiente, cambiar de modelo es
sustituir esta carpeta y el id en `montarTranscriptor()` (`offscreen.js`).

## Sin pesos, ¿qué pasa?

Nada grave y a propósito, con degradación **independiente por módulo**:

- **Sin Whisper**: el popup muestra «Modelo no disponible» y LiveDub queda en
  modo solo captura (audio audible, medidor y VAD siguen funcionando).
- **Sin el traductor**: la transcripción sigue apareciendo con normalidad; cada
  subtítulo lleva el aviso «Traducción no disponible…» y la insignia muestra
  «Traductor no disponible».


## Comprobar que los pesos están completos

```powershell
powershell -ExecutionPolicy Bypass -File livedub\models\verificar-modelos.ps1
```

Revisa **los dos** modelos (`whisper-tiny` y `opus-mt-en-es`) archivo por
archivo y avisa de los que falten o estén truncados. Es utilidad de desarrollo:
no forma parte de lo que carga Chrome.

> Recuerda que los pesos **no están en Git** (ver `.gitignore`): cada quien los
> descarga en su máquina con los scripts de esta carpeta. Si clonas el
> repositorio en otro sitio, `models/` llegará vacía y es lo esperado.
