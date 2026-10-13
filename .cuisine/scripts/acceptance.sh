#!/usr/bin/env bash
# Recette du lot en cours (et des lots précédents) contre l'API de test.
# Usage : bash .cuisine/scripts/acceptance.sh [options jest]   (lit .cuisine-run/lot.env s'il existe)
# Avec acceptance/variants.yaml (variantes de l'API de test, déclarées par la QA), chaque fichier tourne contre l'API
# démarrée dans sa variante (.cuisine/scripts/variantes.py), qui revient ensuite à la variante par défaut ;
# sans ce fichier, tout tourne contre l'API de test qui tourne.
# Durée bornée par CUISINE_TEST_TIMEOUT (900 s par défaut, par variante) : au-delà, statut 124 « BLOQUÉ », distinct d'un échec.
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
FILES=""
[ -f "$ROOT/.cuisine-run/lot.env" ] && . "$ROOT/.cuisine-run/lot.env" && FILES="$ACCEPTANCE_FILES"
# shellcheck disable=SC2086
[ -f "$ROOT/acceptance/variants.yaml" ] && exec python3 "$ROOT/.cuisine/scripts/variantes.py" run "$@" $FILES
cd "$ROOT/acceptance" && timeout -k 10 "${CUISINE_TEST_TIMEOUT:-900}" npx jest --runInBand -c jest.config.js "$@" $FILES
r=$?
[ $r -eq 124 ] && echo "BLOQUÉ : recette arrêtée après ${CUISINE_TEST_TIMEOUT:-900} s sans réponse ; ce n'est pas un échec d'assertion"
exit $r
