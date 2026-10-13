#!/usr/bin/env bash
# Démarre l'API de test dans une variante de la recette (acceptance/variants.yaml) :
#   bash .cuisine/scripts/api-variante.sh <variante>    démarre l'API (port 4000) avec l'environnement de la variante
#   bash .cuisine/scripts/api-variante.sh               liste les variantes et la répartition des fichiers de recette
# La variante par défaut est celle que donne `cd api && NODE_ENV=test bash scripts/server/start.sh`.
# Pour jouer la recette, inutile : bash .cuisine/scripts/acceptance.sh démarre lui-même chaque variante.
HERE="$(cd "$(dirname "$0")" && pwd)"
[ $# -eq 0 ] && exec python3 "$HERE/variantes.py" list
exec python3 "$HERE/variantes.py" start "$@"
