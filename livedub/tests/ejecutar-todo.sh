#!/usr/bin/env bash
# Ejecuta toda la suite de pruebas de Node. Sale con 1 si alguna falla.
set -u
cd "$(dirname "${BASH_SOURCE[0]}")"
fallos=0
for t in test-*.mjs; do
  printf '%-28s ' "${t}"
  if node "${t}" > /tmp/livedub-test.log 2>&1; then
    echo 'PASA ✔'
  else
    echo 'FALLA ✘'
    sed 's/^/    /' /tmp/livedub-test.log | tail -20
    fallos=$((fallos + 1))
  fi
done
echo
[ "${fallos}" -eq 0 ] && echo 'SUITE COMPLETA: TODO CORRECTO ✔' || echo "SUITE: ${fallos} prueba(s) con fallos ✘"
exit $([ "${fallos}" -eq 0 ] && echo 0 || echo 1)
