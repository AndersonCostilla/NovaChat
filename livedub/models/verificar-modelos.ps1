# verificar-modelos.ps1
# Comprueba que los pesos de los DOS modelos estan completos y no truncados.
#
# Utilidad de desarrollo: NO forma parte de lo que carga Chrome.
#
# Como usarlo (Windows):
#   1. Abre PowerShell.
#   2. Situate en la carpeta del proyecto (la que contiene la carpeta "livedub").
#   3. Escribe:   powershell -ExecutionPolicy Bypass -File livedub\models\verificar-modelos.ps1
#
# Devuelve codigo 0 si todo esta bien y 1 si falta o esta truncado algo.

$ErrorActionPreference = 'Stop'

# Carpeta "models", calculada a partir de la ubicacion de este script.
$Models = Split-Path -Parent $MyInvocation.MyCommand.Path

# Tamanos minimos razonables. No son los tamanos exactos: sirven para detectar
# archivos a 0 bytes, paginas de error HTML guardadas por equivocacion y
# descargas cortadas a medias.
$MinJson = 50
$MinOnnx = 500000

$Modelos = @(
    @{
        Nombre   = 'whisper-tiny (transcripcion)'
        Carpeta  = 'whisper-tiny'
        Archivos = @(
            'config.json',
            'tokenizer.json',
            'tokenizer_config.json',
            'generation_config.json',
            'preprocessor_config.json',
            'onnx\encoder_model_quantized.onnx',
            'onnx\decoder_model_merged_quantized.onnx'
        )
    },
    @{
        Nombre   = 'opus-mt-en-es (traduccion)'
        Carpeta  = 'opus-mt-en-es'
        Archivos = @(
            'config.json',
            'tokenizer.json',
            'tokenizer_config.json',
            'generation_config.json',
            'onnx\encoder_model_quantized.onnx',
            'onnx\decoder_model_merged_quantized.onnx'
        )
    }
)

$problemas = 0

foreach ($modelo in $Modelos) {
    Write-Host ''
    Write-Host "=== $($modelo.Nombre) ===" -ForegroundColor Cyan

    $base = Join-Path $Models $modelo.Carpeta
    if (-not (Test-Path $base)) {
        Write-Host "  FALTA la carpeta entera: $base" -ForegroundColor Red
        $problemas++
        continue
    }

    foreach ($relativa in $modelo.Archivos) {
        $ruta = Join-Path $base $relativa

        if (-not (Test-Path $ruta)) {
            Write-Host ("  FALTA     {0}" -f $relativa) -ForegroundColor Red
            $problemas++
            continue
        }

        $bytes = (Get-Item $ruta).Length
        $minimo = if ($relativa -like '*.onnx') { $MinOnnx } else { $MinJson }
        $legible = '{0:N0}' -f $bytes

        if ($bytes -lt $minimo) {
            Write-Host ("  TRUNCADO  {0}  ({1} bytes, se esperaban mas de {2:N0})" -f $relativa, $legible, $minimo) -ForegroundColor Red
            $problemas++
        }
        else {
            Write-Host ("  OK        {0}  ({1} bytes)" -f $relativa, $legible) -ForegroundColor Green
        }
    }
}

Write-Host ''
if ($problemas -eq 0) {
    Write-Host 'TODO CORRECTO: los dos modelos estan completos.' -ForegroundColor Green
    exit 0
}
else {
    Write-Host "HAY $problemas PROBLEMA(S). Vuelve a descargar lo que aparezca en rojo." -ForegroundColor Red
    Write-Host 'Traduccion:   bash livedub/models/descargar-modelo-traductor.sh'
    Write-Host 'Transcripcion: bash livedub/models/descargar-modelo.sh'
    exit 1
}
