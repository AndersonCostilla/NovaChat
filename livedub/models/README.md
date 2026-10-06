# Modelos locales de LiveDub

Aquí van los pesos del modelo de reconocimiento de voz. **No están en el
repositorio** y hay que colocarlos a mano una vez.

## Por qué no están en Git

Los pesos cuantizados de `whisper-tiny` pesan **decenas de MB**. Meterlos en el
historial de Git lo hincharía para siempre y cada cambio futuro arrastraría esos
binarios. Decisión tomada en la Fase 3: **los pesos se quedan fuera de Git** y se
obtienen con el script de descarga. Lo versionado es sólo este README, el script
y el `.gitkeep` que mantiene visible la estructura de carpetas.

## Cómo obtenerlos

```bash
bash livedub/models/descargar-modelo.sh
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

## Modelo elegido

`Xenova/whisper-tiny`, multilingüe, ONNX **cuantizado a int8** (`quantized: true`
en el pipeline). Es el compromiso razonable para CPU + WASM dentro de una
extensión: `whisper-base` da mejor calidad pero triplica el tamaño y la latencia
por frase. Si al probar la calidad resulta insuficiente, cambiar de modelo es
sustituir esta carpeta y el id en `montarTranscriptor()` (`offscreen.js`).

## Sin pesos, ¿qué pasa?

Nada grave y a propósito: el worker falla al cargar, el popup muestra
**«Modelo no disponible»** con el motivo, y LiveDub sigue en **modo solo captura**
(audio audible, medidor de nivel y segmentación VAD siguen funcionando).
