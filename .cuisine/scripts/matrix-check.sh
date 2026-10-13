#!/bin/bash
# Matrice de complétude, déterministe : toute règle `rule-...` déclarée dans specifications/ doit être citée
# entre crochets par un titre de test de recette (acceptance/*.test.ts) ou de navigateur (acceptance/e2e/*.spec.ts),
# ou déclarée « not observable » dans un fichier acceptance/COVERAGE*.md.
# Pendant une reconstruction par lots (.cuisine-run/lot.env avec MATRIX=info), le résultat est informatif.
cd "$(dirname "$0")/../.."
MATRIX=strict; [ -f .cuisine-run/lot.env ] && . .cuisine-run/lot.env
missing=0
ids=$(grep -rhoE 'rule-[a-z0-9]+(-[a-z0-9]+)+' specifications --include=*.md | sort -u)
for id in $ids; do
  if grep -rqE "\[[^]]*$id[^]]*\]" acceptance --include=*.test.ts --include=*.spec.ts --exclude-dir=node_modules; then continue; fi
  if grep -rqE "$id.*not observable" acceptance --include=COVERAGE*.md --exclude-dir=node_modules; then continue; fi
  echo "UNCOVERED $id"; missing=$((missing+1))
done
total=$(echo "$ids" | grep -c .)
echo "matrix: $((total-missing))/$total rules covered or justified"
[ "$MATRIX" = info ] && { echo "matrix: informative during this lot"; exit 0; }
exit $([ $missing -eq 0 ] && echo 0 || echo 1)
