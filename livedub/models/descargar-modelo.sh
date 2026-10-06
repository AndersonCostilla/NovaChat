#!/usr/bin/env bash
# descargar-modelo.sh
#
# HERRAMIENTA DE DESARROLLO. No forma parte de la extensión: no se empaqueta,
# no se ejecuta desde el navegador y ningún archivo de LiveDub lo invoca.
# Sirve sólo para que tú, a mano, coloques los pesos de Whisper en su sitio.
#
# Uso:   bash livedub/models/descargar-modelo.sh
# Deja los archivos en:  livedub/models/whisper-tiny/
#
# Si Hugging Face cambia los nombres o las rutas de los archivos, ajusta la
# lista ARCHIVOS de abajo: no hay forma de verificarlos sin conexión al repo real.

set -u

REPO="Xenova/whisper-tiny"
BASE="https://huggingface.co/${REPO}/resolve/main"
DESTINO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/whisper-tiny"

# Rutas RELATIVAS dentro del repo del modelo. Se respeta la estructura (onnx/).
ARCHIVOS=(
  "config.json"
  "generation_config.json"
  "preprocessor_config.json"
  "tokenizer.json"
  "tokenizer_config.json"
  "onnx/encoder_model_quantized.onnx"
  "onnx/decoder_model_merged_quantized.onnx"
)

# Tamaño mínimo aceptable por archivo (bytes): detecta descargas truncadas o
# páginas de error HTML guardadas como si fueran el modelo.
MINIMO_JSON=50
MINIMO_ONNX=500000

echo "Descargando ${REPO} en: ${DESTINO}"
echo

mkdir -p "${DESTINO}/onnx"

descargados=()
fallidos=()

for ruta in "${ARCHIVOS[@]}"; do
  url="${BASE}/${ruta}"
  salida="${DESTINO}/${ruta}"
  mkdir -p "$(dirname "${salida}")"

  printf '→ %s ... ' "${ruta}"

  # -L sigue redirecciones (HF redirige a su CDN), --fail evita guardar errores HTTP.
  if curl -L --fail --silent --show-error -o "${salida}" "${url}"; then
    tam=$(wc -c < "${salida}" | tr -d ' ')
    case "${ruta}" in
      *.onnx) minimo=${MINIMO_ONNX} ;;
      *)      minimo=${MINIMO_JSON} ;;
    esac

    if [ "${tam}" -lt "${minimo}" ]; then
      echo "SOSPECHOSO (${tam} bytes, esperábamos >= ${minimo})"
      fallidos+=("${ruta} (archivo demasiado pequeño: ${tam} bytes)")
    else
      echo "OK (${tam} bytes)"
      descargados+=("${ruta} (${tam} bytes)")
    fi
  else
    echo "FALLÓ"
    rm -f "${salida}"
    fallidos+=("${ruta} (error de descarga)")
  fi
done

echo
echo "================ RESUMEN ================"
echo "Descargados correctamente: ${#descargados[@]}"
for a in "${descargados[@]:-}"; do [ -n "${a}" ] && echo "   ✔ ${a}"; done

echo "Con problemas: ${#fallidos[@]}"
for a in "${fallidos[@]:-}"; do [ -n "${a}" ] && echo "   ✖ ${a}"; done
echo "========================================="

if [ "${#fallidos[@]}" -gt 0 ]; then
  echo
  echo "Hay archivos que faltan o parecen truncados. Revisa los nombres en"
  echo "https://huggingface.co/${REPO}/tree/main y ajusta la lista ARCHIVOS"
  echo "de este script si el repositorio ha cambiado."
  exit 1
fi

echo
echo "Modelo completo. Recarga la extensión en chrome://extensions y vuelve a Iniciar."
