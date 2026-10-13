#!/usr/bin/env bash
# Banc d'essai des variantes de l'API de test (.cuisine/scripts/variantes.py, appelé par acceptance.sh).
# Dépôt jetable : le vrai lanceur, un start.sh qui note l'environnement reçu, un Jest simulé (fake-jest.py) ; sans
# base, sans API, sans modèle, quelques secondes. Usage : bash .cuisine/tests/variantes/run.sh
set -uo pipefail
SRC="$(cd "$(dirname "$0")/../../.." && pwd)"
HERE="$SRC/.cuisine/tests/variantes"
pass=0; fail=0
ok() { echo "  OK  $*"; pass=$((pass+1)); }
ko() { echo "  KO  $*"; fail=$((fail+1)); }

fixture() {
  T="$(mktemp -d)"; cd "$T"
  mkdir -p .cuisine/scripts api/scripts/server acceptance .cuisine-run
  cp "$SRC/.cuisine/scripts/variantes.py" "$SRC/.cuisine/scripts/acceptance.sh" .cuisine/scripts/
  export BANC_JOURNAL="$T/journal" CUISINE_JEST="python3 $HERE/fake-jest.py" CUISINE_VARIANTES_PORT=4999
  cat > api/scripts/server/start.sh <<'SH'
#!/usr/bin/env bash
echo "start NODE_ENV=$NODE_ENV DRIVER=${EXEMPLE_SOURCES_DRIVER-absent} SECRET=${GOOGLE_CLIENT_SECRET-absent} CLE=${SHEETS_PRIVATE_KEY:+présente}" >> "$BANC_JOURNAL"
[ -n "${BANC_START_ECHEC:-}" ] && [ "${PAYFIT_RETRY_DELAY_MS:-}" = 200 ] && { echo "le serveur s'arrête au démarrage" >&2; exit 1; }
exit 0
SH
  printf 'DATABASE_URL=postgres://database:database@localhost:5432/banc\nJWT_SECRET=change-me\nPORT=4000\n# EXEMPLE_SOURCES_DRIVER=  commentaire\n' > api/.env.template
  printf 'DATABASE_URL=postgres://database:database@localhost:5432/banc_test\nJWT_SECRET=secret-local-123\nPORT=4000\nPAYFIT_API_KEYS=valeur-ecrite-par-un-agent\n' > api/.env.test
  printf "module.exports = { testPathIgnorePatterns: ['/e2e/', '/node_modules/'] }\n" > acceptance/jest.config.js
  for f in acceptance-socle acceptance-v1 acceptance-v2-sources acceptance-v2-google acceptance-v2-unconfigured; do echo "it('$f')" > "acceptance/$f.test.ts"; done
  cat > acceptance/variants.yaml <<'YAML'
default: fake
variants:
  fake:
    description: pilote fake
    env: {EXEMPLE_SOURCES_DRIVER: fake, GOOGLE_CLIENT_SECRET: substitution}
  real:
    files: [acceptance-v2-*.test.ts]
    env: {EXEMPLE_SOURCES_DRIVER: real, GOOGLE_CLIENT_SECRET: secret-de-test, PAYFIT_RETRY_DELAY_MS: 200}
    generate: {SHEETS_PRIVATE_KEY: rsa-private-key-pem}
  unconfigured:
    files: [acceptance-v2-unconfigured.test.ts]
    env: {EXEMPLE_SOURCES_DRIVER: real, GOOGLE_CLIENT_SECRET: ''}
    jest_env: {ACCEPTANCE_VARIANT: unconfigured}
YAML
}
run() { : > "$BANC_JOURNAL"; bash .cuisine/scripts/acceptance.sh "$@" > out.txt 2>&1; echo $? > rc; }
J() { cat "$BANC_JOURNAL"; }

echo "1. motif désignant deux variantes : refusé avant tout démarrage"
fixture; run; grep -q "plusieurs variantes" out.txt && [ "$(cat rc)" = 2 ] && [ ! -s journal ] && ok "code 2, rien de démarré" || ko "$(cat rc) $(tail -3 out.txt)"
sed -i 's/files: \[acceptance-v2-\*.test.ts\]/files: [acceptance-v2-sources.test.ts, acceptance-v2-google.test.ts]/' acceptance/variants.yaml

echo "2. api/.env.test : gabarit (valeurs locales gardées) + variante par défaut ; valeur d'agent retirée"
run
grep -q "secret-local-123" api/.env.test && grep -q "banc_test" api/.env.test && ! grep -q "valeur-ecrite-par-un-agent" api/.env.test \
  && grep -q "^EXEMPLE_SOURCES_DRIVER=fake$" api/.env.test && ! grep -q "^#.*EXEMPLE_SOURCES_DRIVER=  commentaire" api/.env.test \
  && ok "base locale gardée, variable d'agent retirée, bloc de la variante par défaut" || ko "$(cat api/.env.test)"

echo "3. chaque fichier tourne une fois, contre sa variante ; défaut en dernier ; environnement exact"
[ "$(cat rc)" = 0 ] && ok "vert" || ko "code $(cat rc)"
python3 - "$BANC_JOURNAL" <<'PY' && ok "partition, ordre, environnements" || ko "$(J)"
import json, sys
L = open(sys.argv[1]).read().splitlines()
assert [l.split()[0] for l in L] == ['start', 'jest', 'start', 'jest', 'start', 'jest'], L
s = [l for l in L if l.startswith('start')]
assert 'DRIVER=real SECRET=secret-de-test CLE=présente' in s[0], s[0]
assert 'DRIVER=real SECRET= CLE=' in s[1], s[1]                      # valeur vide : variable retirée
assert 'DRIVER=absent SECRET=absent' in s[2], s[2]                   # défaut : tout vient de api/.env.test
j = [json.loads(l[5:]) for l in L if l.startswith('jest')]
assert j[0]['files'] == ['acceptance-v2-google.test.ts', 'acceptance-v2-sources.test.ts'] and j[0]['variant'] is None, j[0]
assert j[1]['files'] == ['acceptance-v2-unconfigured.test.ts'] and j[1]['variant'] == 'unconfigured', j[1]
assert j[2]['files'] == ['acceptance-socle.test.ts', 'acceptance-v1.test.ts'] and j[2]['env_file'].endswith('api/.env.test'), j[2]
real = open(j[0]['env_file']).read()
assert 'EXEMPLE_SOURCES_DRIVER=real' in real and 'EXEMPLE_SOURCES_DRIVER=fake' not in real and 'secret-local-123' in real, real
assert '-----BEGIN PRIVATE KEY-----\\n' in real and 'PAYFIT_RETRY_DELAY_MS=200' in real, 'clé générée écrite avec des \\n'
assert 'GOOGLE_CLIENT_SECRET' not in open(j[1]['env_file']).read()
PY
grep -q "^Tests:       5 passed, 5 total" out.txt && [ "$(grep -c '^Tests:' out.txt)" -ge 4 ] && [ "$(grep '^Tests:' out.txt | tail -1)" = "Tests:       5 passed, 5 total" ] \
  && ok "dernière ligne Tests: = total des variantes" || ko "$(grep '^Tests:' out.txt)"

echo "4. clé de test générée une fois, hors dépôt, puis réutilisée"
k1="$(md5sum .cuisine-run/variantes/cles/real-SHEETS_PRIVATE_KEY.pem)"; run acceptance-v2-sources; k2="$(md5sum .cuisine-run/variantes/cles/real-SHEETS_PRIVATE_KEY.pem)"
[ "$k1" = "$k2" ] && [ "$(stat -c %a .cuisine-run/variantes/cles/real-SHEETS_PRIVATE_KEY.pem)" = 600 ] && ok "même clé, droits 600" || ko "clé régénérée ou lisible"

echo "5. un seul fichier hors défaut : sa variante, puis retour à la variante par défaut"
[ "$(grep -c '^start' journal)" = 2 ] && tail -1 journal | grep -q "DRIVER=absent" && grep -c '^jest' journal | grep -qx 1 && ok "démarrage real, jeu, retour au défaut" || ko "$(J)"

echo "6. échec dans une variante : les autres sont jouées, code 1"
echo "ECHEC" >> acceptance/acceptance-v2-unconfigured.test.ts; run
[ "$(cat rc)" = 1 ] && [ "$(grep -c '^jest' journal)" = 3 ] && grep -q "^Tests:       1 failed, 4 passed, 5 total" out.txt && ok "code 1, trois jeux, total juste" || ko "$(cat rc) $(grep '^Tests:' out.txt)"
sed -i '/ECHEC/d' acceptance/acceptance-v2-unconfigured.test.ts

echo "7. --json --outputFile : un rapport fusionné ; stdout reste vide"
run --json --outputFile="$T/r.json" -t "titre"
python3 -c "import json;d=json.load(open('$T/r.json'));assert d['numTotalTests']==5 and d['success'] and len(d['testResults'])==5 and list(d['variants'])==['real','unconfigured','fake'],d" \
  && ok "rapport fusionné des trois variantes" || ko "$(cat out.txt | tail -5)"
bash .cuisine/scripts/acceptance.sh --json acceptance-v1 2>/dev/null | python3 -c "import json,sys;d=json.load(sys.stdin);assert d['numTotalTests']==1" && ok "--json seul : JSON fusionné sur stdout, rien d'autre" || ko "stdout pollué"

echo "8. API qui ne démarre pas dans une variante : ses fichiers ne sont pas joués, code 1"
BANC_START_ECHEC=1 run
[ "$(cat rc)" = 1 ] && [ "$(grep -c '^jest' journal)" = 2 ] && grep -q "ne démarre pas dans la variante « real »" out.txt && grep -q "le serveur s'arrête" out.txt && ok "code 1, cause affichée, autres variantes jouées" || ko "$(cat rc) $(J)"

echo "9. variante bloquée (CUISINE_TEST_TIMEOUT) : 124 « BLOQUÉ », processus arrêtés"
echo "BLOQUE" >> acceptance/acceptance-v2-google.test.ts; t0=$(date +%s); CUISINE_TEST_TIMEOUT=2 run; dt=$(( $(date +%s) - t0 ))
[ "$(cat rc)" = 124 ] && grep -q "BLOQUÉ : recette de la variante « real »" out.txt && [ $dt -lt 30 ] && ! pgrep -f "^python3 .*fake-jest[.]py" >/dev/null && ok "124 en ${dt} s, aucun Jest restant" || ko "$(cat rc) en ${dt} s ; $(grep BLOQU out.txt) ; $(pgrep -af "^python3 .*fake-jest[.]py")"
sed -i '/BLOQUE/d' acceptance/acceptance-v2-google.test.ts

echo "10. sans acceptance/variants.yaml : comportement d'origine (une seule API, pas de lanceur)"
rm acceptance/variants.yaml; : > journal; CUISINE_TEST_TIMEOUT=1 bash .cuisine/scripts/acceptance.sh --version > out.txt 2>&1
! grep -q "variantes" out.txt && [ ! -s journal ] && ok "jest appelé directement, aucun démarrage" || ko "$(tail -3 out.txt)"

rm -rf "$T"
echo "banc des variantes : $pass OK, $fail KO"
exit $([ $fail -eq 0 ] && echo 0 || echo 1)
