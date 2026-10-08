#!/usr/bin/env bash
# descargar-modelo-voz.sh
#
# HERRAMIENTA DE DESARROLLO. No forma parte de la extensión: no se empaqueta,
# no se ejecuta desde el navegador y ningún archivo de LiveDub lo invoca.
# Descarga los pesos del modelo de VOZ en español (MMS-TTS, arquitectura VITS).
#
# Uso:   bash livedub/models/descargar-modelo-voz.sh
# Deja los archivos en:  livedub/models/mms-tts-spa/
#
# ⚠ La lista ARCHIVOS es ORIENTATIVA y NO está verificada en vivo (el entorno
#   donde se escribió este script no tiene acceso a huggingface.co). Si alguna
#   descarga da 404, mira los nombres reales en
#   https://huggingface.co/Xenova/mms-tts-spa/tree/main y ajústala.

set -u

REPO="Xenova/mms-tts-spa"
BASE="https://huggingface.co/${REPO}/resolve/main"
DESTINO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/mms-tts-spa"

# Rutas RELATIVAS dentro del repo del modelo. Se respeta la estructura (onnx/).
# transformers.js NO usa los SentencePiece (source.spm / target.spm) ni
# vocab.json: le basta tokenizer.json + tokenizer_config.json. Se descargan
# igualmente por completitud, pero están en OPCIONALES.
ARCHIVOS=(
  "config.json"
  "tokenizer.json"
  "tokenizer_config.json"
  # VITS es de UNA SOLA PIEZA: aquí no hay encoder + decoder como en OPUS-MT,
  # y tampoco hace falta vocoder ni speaker embeddings (eso es de SpeechT5).
  #
  # Fase 5.1: se bajan LOS DOS motores, porque cuál es el rápido depende del
  # equipo y sólo se sabe midiendo. Teniéndolos los dos en disco, alternar es
  # cambiar VOZ.USAR_CUANTIZADO en livedub/messages.js y recargar: no hay que
  # volver a descargar nada.
  #
  #   model_quantized.onnx → ~38 MB, int8.
  #   model.onnx           → ~114 MB, float32. En VITS suele ser el RÁPIDO,
  #                          porque su decodificador es casi todo
  #                          convoluciones y ONNX Runtime no las ejecuta en
  #                          int8: mete conversiones de ida y vuelta en cada
  #                          capa. El ejemplo oficial del modelo usa float32.
  "onnx/model_quantized.onnx"
  "onnx/model.onnx"
)

# Archivos que, si faltan, NO deben hacer fracasar el script: algunos repos
# publican tokenizer.json en lugar de los .spm, o no traen generation_config.
OPCIONALES=()

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
echo "Modelo de voz completo (los DOS motores: int8 y float32)."
echo
echo "Motor activo ahora mismo: mira VOZ.USAR_CUANTIZADO en livedub/messages.js"
echo "   false -> onnx/model.onnx           (114 MB, float32)  <- por defecto"
echo "   true  -> onnx/model_quantized.onnx (38 MB,  int8)"
echo
echo "Recarga la extensión en chrome://extensions y vuelve a Iniciar."
echo "Con el doblaje activo, escribe  livedub.rendimiento()  en la consola del"
echo "documento offscreen para ver qué tal se le da a tu equipo."

