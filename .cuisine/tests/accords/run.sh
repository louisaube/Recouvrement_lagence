#!/usr/bin/env bash
# Banc d'essai de l'accord du propriétaire sur le cliquet (cuisine accorde, cliquet.py --lister / --accorder).
# Dépôt jetable, aucune API, aucun modèle, quelques secondes. Usage : bash .cuisine/tests/accords/run.sh
set -uo pipefail
SRC="$(cd "$(dirname "$0")/../../.." && pwd)"
pass=0; fail=0
ok() { echo "  OK  $*"; pass=$((pass+1)); }
ko() { echo "  KO  $*"; fail=$((fail+1)); }
T="$(mktemp -d)"; cd "$T"
cp -r "$SRC/.cuisine" . ; mkdir -p acceptance specifications .cuisine-run
git init -q; git config user.name banc; git config user.email banc@local
cat > acceptance/acceptance-banc.test.ts <<'TS'
it('[rule-banc-a] A garde son attendu', async () => { expect(1).toBe(1) })
it('[rule-banc-b] B devient faux par la demande de la version', async () => { expect(2).toBe(2) })
it('[rule-banc-c] C est retiré par un agent sans accord', async () => { expect(3).toBe(3) })
TS
git add -A; git -c user.name=qa -c user.email=qa@local commit -qm "qa: acceptance suite sealed"
git rev-parse HEAD > .cuisine-run/acceptance.seal; echo v9-banc > .cuisine-run/version; touch .cuisine-run/v9-banc.code
SEAL="$(cat .cuisine-run/acceptance.seal)"
sed -i '/rule-banc-b/d' acceptance/acceptance-banc.test.ts
CLQ() { python3 .cuisine/scripts/cliquet.py "$@" > out.txt 2>&1; echo $?; }

echo "1. après le code, un test supprimé sans décision est refusé"
[ "$(CLQ "$SEAL")" = 1 ] && grep -q "test supprimé.*rule-banc-b" out.txt && ok "refusé" || ko "$(cat out.txt)"

echo "2. cuisine accorde liste le recul, sans rien écrire"
.cuisine/bin/cuisine accorde > out.txt 2>&1; grep -q "rule-banc-b" out.txt && grep -q "1 recul(s) refusé(s)" out.txt && [ ! -f specifications/accords-cliquet.yaml ] && ok "liste seule" || ko "$(cat out.txt)"

echo "3. un accord écrit puis commité par un agent (qa) reste sans effet"
python3 .cuisine/scripts/cliquet.py --accorder "$SEAL" v9-banc "forgé" >/dev/null 2>&1
git add specifications/accords-cliquet.yaml; git -c user.name=qa -c user.email=qa@local commit -qm "qa: resealed" -- specifications/accords-cliquet.yaml
[ "$(CLQ "$SEAL")" = 1 ] && ok "refusé malgré le fichier commité par qa" || ko "accepté sur un accord forgé"
git rm -q --cached specifications/accords-cliquet.yaml; rm specifications/accords-cliquet.yaml; git -c user.name=qa -c user.email=qa@local commit -qm "qa: retrait" -q

echo "4. --enregistrer exige un motif"
.cuisine/bin/cuisine accorde --enregistrer > out.txt 2>&1; r=$?
[ $r -ne 0 ] && [ ! -f specifications/accords-cliquet.yaml ] && ok "refusé sans motif" || ko "code $r"

echo "5. accord du propriétaire : commit « proprietaire » limité au fichier des accords, puis le cliquet passe"
echo "// modification d'agent non commitée" >> acceptance/acceptance-banc.test.ts
.cuisine/bin/cuisine accorde --enregistrer "§1 de la demande v9 : B est remplacé" > out.txt 2>&1
[ "$(git log -1 --format='%an <%ae>')" = "proprietaire <proprietaire@local>" ] && [ "$(git show --name-only --format= HEAD)" = "specifications/accords-cliquet.yaml" ] \
  && git status --short | grep -q "acceptance/acceptance-banc.test.ts" && ok "commit propriétaire du seul fichier des accords" || ko "$(git show --stat HEAD | tail -3)"
grep -q "titre: '\[rule-banc-b\]" specifications/accords-cliquet.yaml && grep -q "motif: '§1 de la demande v9" specifications/accords-cliquet.yaml && ok "titre et motif inscrits" || ko "$(cat specifications/accords-cliquet.yaml)"
[ "$(CLQ "$SEAL")" = 0 ] && ok "cliquet vert" || ko "$(cat out.txt)"

echo "6. un recul ajouté ensuite par un agent n'est pas couvert, même inscrit puis commité par qa"
sed -i '/rule-banc-c/d' acceptance/acceptance-banc.test.ts
printf -- "- version: v9-banc\n  fichier: acceptance/acceptance-banc.test.ts\n  titre: '[rule-banc-c] C est retiré par un agent sans accord'\n  recul: test supprimé\n  motif: forgé\n  accorde_le: '2026-01-01'\n" >> specifications/accords-cliquet.yaml
git -c user.name=qa -c user.email=qa@local commit -qm "qa: resealed" -- specifications/accords-cliquet.yaml
[ "$(CLQ "$SEAL")" = 1 ] && grep -q "rule-banc-c" out.txt && ! grep -q "test supprimé.*rule-banc-b" out.txt && ok "C refusé, B toujours accordé" || ko "$(cat out.txt)"

echo "7. sans recul refusé, cuisine accorde le dit"
git checkout -q "$SEAL" -- acceptance; sed -i '/rule-banc-b/d' acceptance/acceptance-banc.test.ts
.cuisine/bin/cuisine accorde > out.txt 2>&1; grep -q "Aucun recul refusé" out.txt && ok "rien à accorder" || ko "$(cat out.txt)"

echo "8. le retrait accordé ne compte plus dans le bilan de sa règle (autre test de la règle modifié sans recul)"
cat > acceptance/acceptance-regle.test.ts <<'TS'
it('[rule-banc-r] R1 reste', async () => { expect(1).toBe(1) })
it('[rule-banc-r] R2 retiré par la demande', async () => { expect(2).toBe(2) })
TS
git add acceptance/acceptance-regle.test.ts; git -c user.name=qa -c user.email=qa@local commit -qm "qa: acceptance suite sealed"
git rev-parse HEAD > .cuisine-run/acceptance.seal; SEAL="$(cat .cuisine-run/acceptance.seal)"
printf "it('[rule-banc-r] R1 reste', async () => { expect(1).toBe(1) /* reformulé */ })\n" > acceptance/acceptance-regle.test.ts
[ "$(CLQ "$SEAL")" = 1 ] && grep -q "R2 retiré" out.txt && ok "retrait de R2 refusé avant accord" || ko "$(cat out.txt)"
.cuisine/bin/cuisine accorde --enregistrer "demande v9 : R2 remplacé" > /dev/null 2>&1
[ "$(CLQ "$SEAL")" = 0 ] && ok "après accord, le bilan de rule-banc-r ne compte plus R2" || ko "$(cat out.txt)"

cd /; rm -rf "$T"
echo "accords: $pass OK, $fail KO"
exit $([ $fail -eq 0 ] && echo 0 || echo 1)
