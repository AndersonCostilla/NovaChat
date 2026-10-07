#!/usr/bin/env bash
# descargar-modelo-traductor.sh
#
# HERRAMIENTA DE DESARROLLO. No forma parte de la extensión: no se empaqueta,
# no se ejecuta desde el navegador y ningún archivo de LiveDub lo invoca.
# Descarga los pesos del traductor OPUS-MT inglés → español.
#
# Uso:   bash livedub/models/descargar-modelo-traductor.sh
# Deja los archivos en:  livedub/models/opus-mt-en-es/
#
# ⚠ La lista ARCHIVOS es ORIENTATIVA y NO está verificada en vivo (el entorno
#   donde se escribió este script no tiene acceso a huggingface.co). Si alguna
#   descarga da 404, mira los nombres reales en
#   https://huggingface.co/Xenova/opus-mt-en-es/tree/main y ajústala.

set -u

REPO="Xenova/opus-mt-en-es"
BASE="https://huggingface.co/${REPO}/resolve/main"
DESTINO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/opus-mt-en-es"

# Rutas RELATIVAS dentro del repo del modelo. Se respeta la estructura (onnx/).
# transformers.js NO usa los SentencePiece (source.spm / target.spm) ni
# vocab.json: le basta tokenizer.json + tokenizer_config.json. Se descargan
# igualmente por completitud, pero están en OPCIONALES.
ARCHIVOS=(
  "config.json"
  # tokenizer.json es OBLIGATORIO: verificado leyendo la librería vendorizada,
  # que hace getModelJSON(..., "tokenizer.json", fatal=true). Sin él la carga
  # del traductor falla. Faltaba en la primera versión de este script.
  "tokenizer.json"
  "generation_config.json"
  "tokenizer_config.json"
  "vocab.json"
  "source.spm"
  "target.spm"
  "onnx/encoder_model_quantized.onnx"
  "onnx/decoder_model_merged_quantized.onnx"
)

# Archivos que, si faltan, NO deben hacer fracasar el script: algunos repos
# publican tokenizer.json en lugar de los .spm, o no traen generation_config.
OPCIONALES=("generation_config.json" "source.spm" "target.spm" "vocab.json")

MINIMO_JSON=50
MINIMO_ONNX=500000
MINIMO_SPM=10000

echo "Descargando ${REPO} en: ${DESTINO}"
echo

mkdir -p "${DESTINO}/onnx"

descargados=()
fallidos=()
omitidos=()

es_opcional() {
  local busca="$1"
  for o in "${OPCIONALES[@]}"; do [ "${o}" = "${busca}" ] && return 0; done
  return 1
}

for ruta in "${ARCHIVOS[@]}"; do
  url="${BASE}/${ruta}"
  salida="${DESTINO}/${ruta}"
  mkdir -p "$(dirname "${salida}")"

  printf '→ %s ... ' "${ruta}"

  if curl -L --fail --silent --show-error -o "${salida}" "${url}"; then
    tam=$(wc -c < "${salida}" | tr -d ' ')
    case "${ruta}" in
      *.onnx) minimo=${MINIMO_ONNX} ;;
      *.spm)  minimo=${MINIMO_SPM} ;;
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
    rm -f "${salida}"
    if es_opcional "${ruta}"; then
      echo "no está (opcional, se omite)"
      omitidos+=("${ruta}")
    else
      echo "FALLÓ"
      fallidos+=("${ruta} (error de descarga)")
    fi
  fi
done

echo
echo "================ RESUMEN ================"
echo "Descargados correctamente: ${#descargados[@]}"
for a in "${descargados[@]:-}"; do [ -n "${a}" ] && echo "   ✔ ${a}"; done

if [ "${#omitidos[@]}" -gt 0 ]; then
  echo "Opcionales ausentes: ${#omitidos[@]}"
  for a in "${omitidos[@]:-}"; do [ -n "${a}" ] && echo "   – ${a}"; done
fi

echo "Con problemas: ${#fallidos[@]}"
for a in "${fallidos[@]:-}"; do [ -n "${a}" ] && echo "   ✖ ${a}"; done
echo "========================================="

if [ "${#fallidos[@]}" -gt 0 ]; then
  echo
  echo "Hay archivos obligatorios que faltan o parecen truncados. Revisa los"
  echo "nombres en https://huggingface.co/${REPO}/tree/main y ajusta ARCHIVOS."
  exit 1
fi

echo
echo "Traductor completo. Recarga la extensión en chrome://extensions y vuelve a Iniciar."
