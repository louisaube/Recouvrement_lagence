#!/usr/bin/env bash
# Banc d'essai de la reprise après arbitrage. Une version factice d'une seule route (GET /banc/ping) parcourt
# le vrai graphe de la cuisine (cuisine.loop.yaml, puis cuisine.suite.loop.yaml), avec les vraies commandes
# `cuisine run`, `cuisine arbitre` et le vrai script d'arbitrage ; seuls les agents (fake-claude), le serveur,
# les tests de l'application et les portes lourdes (droits, contrat) sont simulés. Quelques minutes, sans modèle.
# Chaque défaut de reprise corrigé y laisse un cas, qui échoue si la correction est retirée.
# Usage : bash .cuisine/tests/reprise/run.sh [numéro de cas ...]
#         bash .cuisine/tests/reprise/run.sh --retirer N   retire la correction N de la copie et vérifie que son cas échoue
set -uo pipefail
RETIRER=""; [ "${1:-}" = "--retirer" ] && { RETIRER="$2"; shift 2
  case "$RETIRER" in 10b|12a|15|16) set -- 5 ;; *) set -- "${RETIRER%%[a-z]*}" ;; esac; }   # corrections de câblage : vues par une suite complète
SRC="$(cd "$(dirname "$0")/../../.." && pwd)"
HERE="$SRC/.cuisine/tests/reprise"
CASES="${*:-1 2 3 4 5 6 7 8 9 10 11 12 13 14}"
pass=0; fail=0
ok() { echo "  OK  $*"; pass=$((pass+1)); }
ko() { echo "  KO  $*"; fail=$((fail+1)); }

# Dépôt jetable : la cuisine telle qu'elle est, une application factice, des portes lourdes simulées.
fixture() {
  T="$(mktemp -d)"; cd "$T"
  cp -r "$SRC/.cuisine" .
  mkdir -p bin api/src api/scripts/server studio acceptance specifications/banc/implementation-plans/v0-ancien prompts .cuisine-run
  cp "$HERE/fake-claude" bin/claude; chmod +x bin/claude
  printf '#!/bin/sh\nexit 0\n' > bin/psql; chmod +x bin/psql
  printf '#!/bin/sh\nexit 0\n' > api/scripts/server/start.sh
  # recette simulée : juge les attendus de statut contre l'application simulée (api/src/<route>.status) ou contre API_URL
  printf '#!/usr/bin/env bash\nexec python3 "$(dirname "$0")/../tests/reprise/fake-acceptance.py" "$@"\n' > .cuisine/scripts/acceptance.sh
  printf '#!/usr/bin/env python3\nprint("permissions: 1/1 routes conformes, 0 bloquante(s), 0 alerte(s)")\n' > .cuisine/scripts/permissions-check.py
  printf '#!/usr/bin/env bash\necho "contract: OK"\n' > .cuisine/scripts/contract-check.sh
  cat > api/banc-test.sh <<'EOF'
#!/bin/sh
# tests de l'API simulés : rouges tant qu'une contestation est ouverte (BANC_DISPUTE=1) ; sans fin (BANC_HANG=1)
# tant que le développeur n'a pas corrigé l'interblocage (api/src/fixed)
if [ "${BANC_HANG:-}" = 1 ] && [ ! -f src/fixed ]; then sleep 60; fi
if [ "${BANC_DISPUTE:-}" = 1 ] && grep -rqs "^OPEN" ../specifications --include=DISPUTES.md; then echo "Tests: 1 failed"; exit 1; fi
echo "Tests: 1 passed"
EOF
  cat > api/package.json <<'EOF'
{ "name": "api", "private": true, "scripts": { "type:check": "true", "test": "sh banc-test.sh",
  "cuisine:openapi": "node -e \"require('fs').writeFileSync(process.argv[1], '{}')\"" } }
EOF
  echo '{ "name": "studio", "private": true, "scripts": { "type:check": "true", "build": "true" } }' > studio/package.json
  echo '{ "name": "banc", "private": true, "scripts": { "api-client:generate": "true" } }' > package.json
  printf 'allowed: []\n' > specifications/contract-changes.yaml; echo '{}' > specifications/openapi.json
  printf 'roles: [anonymous, user, admin]\noperations: []\n' > specifications/permissions.yaml
  # plan d'une version passée : la règle y figure sans décision, ce qui est de l'histoire (cas 5)
  printf '# Ancien plan\n\n- `rule-banc-ping-reponse` (inferred) : version initiale.\n' > specifications/banc/implementation-plans/v0-ancien/plan.md
  echo "Rendre la route GET /banc/ping, ouverte ou fermée selon le choix du propriétaire." > prompts/v1-banc.md
  echo "# Banc" > CLAUDE.md
  printf '.cuisine-run/\n.yamloop/\nnode_modules/\n' > .gitignore
  [ -n "$RETIRER" ] && retirer "$RETIRER"
  git init -q && git add -A && git -c user.name=t -c user.email=t@t commit -qm banc
  export PATH="$T/bin:$PATH" BANC_JOURNAL="$T/.cuisine-run/journal" CUISINE_PGDATA=
}
# Retrait d'une correction dans la copie (preuve que le cas la détecte).
retirer() {
  python3 - "$1" <<'EOF'
import re, sys
n = sys.argv[1]
def sub(path, old, new):
    s = open(path).read(); assert old in s, (n, path, old[:60]); open(path, 'w').write(s.replace(old, new))
loops = ['.cuisine/cuisine.loop.yaml', '.cuisine/cuisine.suite.loop.yaml']
for L in loops:
    if n == '1':
        sub(L, '{ git ls-files --others --exclude-standard -- acceptance; git diff --name-only --diff-filter=A "$(cat $W/base 2>/dev/null || echo HEAD)" HEAD -- acceptance; }', 'git ls-files --others --exclude-standard -- acceptance')
    if n == '15':
        sub(L, 'new_session_args: ["-p", "{{prompt}}", ', 'new_session_args: ["-p", "{{prompt}}", "--output-format", "json", ')
    if n == '12a':
        sub(L, 'python3 .cuisine/scripts/echantillon_b.py "$(cat $W/base 2>/dev/null || echo HEAD)" >/dev/null 2>&1; ', '')
    if n == '10b':
        sub(L, 'touch "$W/$(cat $W/version 2>/dev/null || echo version).code"; ', '')
    if n == '3c':
        sub(L, 'commit -qm "qa: acceptance suite sealed" || echo "nothing new to seal"; git rev-parse', 'commit -qm "qa: acceptance suite sealed" && git rev-parse')
    if n == '4':
        s = open(L).read(); i = s.index('\n  check-back:'); j = s.index('\n\n', i)
        open(L, 'w').write(s[:i] + s[i:j].replace('exit_non_zero: back-dispute', 'exit_non_zero: fix-back') + s[j:])
if n == '2':
    sub('.cuisine/bin/cuisine', '[ -f ".cuisine-run/$v.base" ] && cp ".cuisine-run/$v.base" .cuisine-run/base', 'true')
if n == '16':
    sub('.cuisine/bin/cuisine', 'local sid="$v-suite-$(date +%H%M%S)"; empreinte "$sid"', 'local sid="$v-suite-$(date +%H%M%S)"')
if n == '3a':
    sub('.cuisine/bin/cuisine', 'local sid="$v-suite-$(date +%H%M%S)"', 'local sid="$v-suite"')
if n == '6':
    for L in loops:
        sub(L, 'timeout -k 10 ${CUISINE_TEST_TIMEOUT:-900} pnpm -s test', 'pnpm -s test')
if n == '7':
    sub('.cuisine/scripts/arbitrage.py', 'retenus = veto + libres[:MAX_GROUPES]', 'retenus = groupes[:MAX_GROUPES]')
if n == '8':
    sub('.cuisine/scripts/cliquet.py', "    return 1 if faults else 0", "    return 0")
if n == '3b':
    sub('.cuisine/scripts/rouge.py', "seen = {(e['fichier'], e['titre']) for e in committed()}", "seen = set()")
if n == '9':
    sub('.cuisine/scripts/rouge.py', "seen = {(e['fichier'], e['titre']) for e in committed()}", "seen = {(e['fichier'], e['titre']) for e in working()}")
if n == '13':
    sub('.cuisine/scripts/rouge.py', "                    st = 'erreur'", "                    pass")
if n == '14':
    sub('.cuisine/scripts/rouge.py', "    if code == 124 and len(ts) == 1:", "    if code == 124:\n        status = {t: 'failed' for t in ts}\n    if False:")
if n == '10':
    sub('.cuisine/scripts/cliquet.py', "    if POST_CODE:\n        return False", "    if False:\n        return False")
if n == '11':
    sub('.cuisine/scripts/cliquet.py', "if admitted and '--sans-contre-exemple' not in sys.argv:", "if False:")
if n == '12b':
    sub('.cuisine/scripts/echantillon_b.py', "if verdict == 'failed':", "if False:")
if n == '7b':
    sub('.cuisine/scripts/arbitrage.py', "for q in qs if q['_sensible'] and q['id'] not in retenus_ids]", "for q in qs if False]")
if n == '5':
    sub('.cuisine/scripts/arbitrage.py', "if '/implementation-plans/' not in f or f'/implementation-plans/{version}/' in f]", "]")
EOF
}
t1() { printf "describe('banc %s', () => {\n  it('[rule-banc-ping-reponse] %s', async () => {\n    const res = await fetch(API_URL + '%s')\n    expect(res.status).toBe(200)\n  })\n})\n" "$1" "$1" "$2"; }
C() { .cuisine/bin/cuisine "$@" > ".cuisine-run/out-$1" 2>&1; }
runs_ok() { grep -oE "run_end\S* \S+ status=\w+" .cuisine-run/v1-banc.log | sed 's/\x1b\[[0-9;]*m//g' | awk '{print $2, $3}'; }
last_status() { runs_ok | tail -1 | sed 's/.*status=//'; }
nodes() { grep -oE "node_end\S* [a-z0-9-]+ exit=[0-9]+" .cuisine-run/v1-banc.log | awk '{print $2"="$3}' | sed 's/exit=//'; }
pause() { C run v1-banc; grep -q "en-attente" .cuisine-run/v1-banc.log; }

# Reproduit l'état d'une suite interrompue après le scellement : décision inscrite, spécification liée, test scellé.
interrupted_suite() {
  python3 .cuisine/scripts/arbitrage.py arbitre v1-banc "$1" >/dev/null
  d=$(grep -m1 "decision:" specifications/banc/arbitrages.yaml | awk '{print $NF}')
  sed -i "s/\`rule-banc-ping-reponse\` (inferred)/\`rule-banc-ping-reponse\` (inferred, decision $d)/" specifications/banc/implementation-plans/v1-banc/*.md
  printf "describe('banc', () => {\n  it('[rule-banc-ping-reponse][%s] GET /banc/ping', async () => { const res = await fetch(API_URL + '/banc/ping'); expect(res.status).toBe(200) })\n})\n" "$d" > acceptance/acceptance-banc.test.ts
  git add -A && git -c user.name=qa -c user.email=qa@local commit -qm "qa: acceptance suite sealed (suite interrompue)"
}

for c in $CASES; do
  fixture
  case $c in
  1) echo "Cas 1 : reprise après arbitrage, le contrôle rouge compte les tests scellés depuis le début de la version"
     pause && ok "pause EN ATTENTE après la spécification" || ko "pas de pause"
     interrupted_suite A
     C arbitre --relance v1-banc
     nodes | grep -q "^red-check=2" && ko "red-check : « aucun test nouveau » alors que le test est scellé depuis la base" || ok "red-check voit le test scellé"
     [ "$(last_status)" = ok ] && ok "suite menée à son terme" || ko "suite : $(last_status)" ;;
  2) echo "Cas 2 : une autre version a tourné entre la pause et l'arbitrage, la base de la version est restaurée"
     pause; interrupted_suite A
     git rev-parse HEAD > .cuisine-run/base   # comme si une autre version avait démarré depuis
     C arbitre --relance v1-banc
     [ "$(cat .cuisine-run/base)" = "$(cat .cuisine-run/v1-banc.base)" ] && ok "base restaurée" || ko "base écrasée"
     [ "$(last_status)" = ok ] && ok "suite menée à son terme" || ko "suite : $(last_status)" ;;
  3) echo "Cas 3 : une suite déjà jouée peut être relancée (nouvel identifiant d'exécution)"
     pause; C arbitre v1-banc "B"
     [ "$(last_status)" = ok ] && ok "première suite terminée" || ko "première suite : $(last_status)"
     grep -q "\[D-0001\]" acceptance/acceptance-banc.test.ts && grep -q "toBe(401)" acceptance/acceptance-banc.test.ts && ok "test [D-0001] écrit pour l'option B" || ko "test de décision absent"
     C arbitre --relance v1-banc
     n=$(grep -oE "run_start\S* \S+ run=v1-banc-suite-[0-9]+" .cuisine-run/v1-banc.log | sort -u | wc -l)
     [ "$n" -ge 2 ] && ok "relance jouée sous un nouvel identifiant ($n suites)" || ko "relance refusée : identifiant d'exécution réutilisé"
     grep -q "RED ALREADY ESTABLISHED" .cuisine-run/v1-banc.log && ! nodes | grep -q "^red-check=3" && ok "rouge déjà constaté, pas de test à affaiblir" || ko "red-check redemande des tests rouges sur du code existant"
     ! nodes | grep -q "^seal-broken=" && ok "scellement sans nouveauté accepté" || ko "sceau périmé : seal-broken en boucle"
     [ "$(last_status)" = ok ] && ok "relance menée à son terme" || ko "relance : $(last_status)" ;;
  4) echo "Cas 4 : tests de l'API rouges avec une contestation ouverte, la QA arbitre avant toute réparation"
     pause; export BANC_DISPUTE=1; C arbitre v1-banc "A"; unset BANC_DISPUTE
     nodes | grep -q "^back-dispute=1" && ok "contestation détectée après l'échec du back" || ko "back-dispute absent"
     grep -q "qa-arbitrate" .cuisine-run/journal && ok "la QA a arbitré" || ko "la QA n'a pas été appelée"
     [ "$(last_status)" = ok ] && ok "suite menée à son terme" || ko "suite : $(last_status)" ;;
  5) echo "Cas 5 : les plans des versions passées ne bloquent pas le contrôle des décisions"
     pause; C arbitre v1-banc "A"
     nodes | grep -q "^arbitrage-check-spec=1" && ko "check-spec bloqué par le plan de v0-ancien" || ok "check-spec passe du premier coup"
     python3 -c "import json,glob,sys; v=[x for p in glob.glob('.yamloop/runs/v1-banc-suite-*/state.json') for n in json.load(open(p))['nodes'].values() for x in n['visits'] if x.get('usage')]; sys.exit(0 if v and all(x['usage'].get('cost_usd') == 0.0123 for x in v) else 1)" \
       && ok "usage et coût des agents capturés par visite" || ko "usage des agents perdu (state.json sans usage)"
     [ -s .cuisine-run/empreintes/v1-banc ] && ls .cuisine-run/empreintes | grep -q "^v1-banc-suite-" && ok "empreinte de configuration écrite pour chaque run" || ko "empreinte de run absente"
     [ -f .cuisine-run/v1-banc.code ] && ok "check-back marque le premier passage de code-back" || ko "marque .code absente"
     grep -q "Échantillon B" specifications/banc/implementation-plans/v1-banc/mesures.md 2>/dev/null && ok "échantillon B inscrit au résumé de version" || ko "échantillon B absent de mesures.md"
     [ "$(last_status)" = ok ] && ok "suite menée à son terme" || ko "suite : $(last_status)" ;;
  6) echo "Cas 6 : tests de l'API sans fin, arrêtés par la limite de durée, statut « bloqué » distinct d'« échoué »"
     pause; export BANC_HANG=1 CUISINE_TEST_TIMEOUT=4; C arbitre v1-banc "A"; unset BANC_HANG CUISINE_TEST_TIMEOUT
     nodes | grep -q "^check-back=124" && ok "check-back arrêté par la limite (code 124)" || ko "pas d'arrêt par la limite de durée"
     grep -q "BLOQUÉ" .cuisine-run/v1-banc.log && ok "le développeur reçoit « BLOQUÉ »" || ko "message BLOQUÉ absent"
     python3 .cuisine/scripts/report.py .cuisine-run/r.json >/dev/null 2>&1
     python3 -c "import json,sys; v=[x for x in json.load(open('.cuisine-run/r.json'))['versions'] if x['nom']=='v1-banc'][0]; sys.exit(0 if v['portes_bloquees'].get('check-back') and 'check-back' not in v['portes_echouees'] else 1)" \
       && ok "rapport : check-back bloqué, pas échoué" || ko "rapport confond bloqué et échoué"
     grep -q "check-back bloqué" .cuisine-run/out-arbitre && ok "compte rendu de la commande : « bloqué »" || ko "compte rendu sans « bloqué »"
     [ "$(last_status)" = ok ] && ok "suite menée à son terme" || ko "suite : $(last_status)" ;;
  7) echo "Cas 7 : veto de la règle B, même résultat dans les deux ordres des questions"
     python3 - <<'EOF'
import yaml
q = lambda i, titre, regles, dflt, att: {'id': f'Q-BANC-{i:02d}', 'titre': titre, 'regles': regles, 'effet_recette': 'oui', 'decideur': 'proprietaire',
    'observable': 'oui', 'situation': 's', 'defaut': 'A', 'options': [
    {'code': 'A', 'libelle': 'a', 'cout': 'leger', 'resultat': 'ra', 'test': {'route': 'GET /x', 'entree': 'e', 'attendu': dflt}},
    {'code': 'B', 'libelle': 'b', 'cout': 'leger', 'resultat': 'rb', 'test': {'route': 'GET /x', 'entree': 'e', 'attendu': att}}]}
qs = [q(i, f'Couleur du bouton {i}', [f'rule-banc-libre-{i}-a', f'rule-banc-libre-{i}-b'], '200', '204') for i in range(1, 7)]
qs.append(q(9, 'Mot de passe de longueur nulle', ['rule-banc-secret'], '201', '400 api.validation.incoming_failed'))
qs.append(q(10, 'Durée du jeton de session', ['rule-banc-jeton'], '200', '401 security.unauthenticated'))
regles = ''.join(f'- `{r}` ({"user" if r == "rule-banc-jeton" else "inferred"}) : règle.\n' for x in qs for r in x['regles'])
import os
os.makedirs('specifications/banc/implementation-plans/ordre-a', exist_ok=True); os.makedirs('specifications/banc/implementation-plans/ordre-b', exist_ok=True)
open('specifications/banc/regles.md', 'w').write('# Règles\n\n' + regles)
yaml.safe_dump(qs, open('specifications/banc/implementation-plans/ordre-a/questions.yaml', 'w'), allow_unicode=True, sort_keys=False)
yaml.safe_dump(list(reversed(qs)), open('specifications/banc/implementation-plans/ordre-b/questions.yaml', 'w'), allow_unicode=True, sort_keys=False)
EOF
     a=$(python3 .cuisine/scripts/arbitrage.py filter ordre-a | grep '^RETENUE' | sort | tr '\n' ';')
     # mêmes identifiants dans les deux versions : chacune part d'un registre vierge (un identifiant n'appartient qu'à une version)
     rm -f specifications/banc/arbitrages.yaml
     b=$(python3 .cuisine/scripts/arbitrage.py filter ordre-b | grep '^RETENUE' | sort | tr '\n' ';')
     echo "$a" | grep -q "Q-BANC-09" && ok "question de sécurité remontée malgré le plafond (ordre A)" || ko "veto ignoré (ordre A) : $a"
     echo "$b" | grep -q "Q-BANC-09" && ok "question de sécurité remontée malgré le plafond (ordre inverse)" || ko "veto ignoré (ordre inverse) : $b"
     [ "$a" = "$b" ] && ok "même sélection dans les deux ordres" || ko "sélection dépendante de l'ordre"
     [ "$(echo "$a" | tr ';' '\n' | grep -c RETENUE)" = 6 ] && ok "cinq questions libres plus la question de sécurité" || ko "plafond mal appliqué"
     python3 .cuisine/scripts/arbitrage.py metrics ordre-b > .cuisine-run/m7.txt 2>&1
     grep -q "non remontées : 1" .cuisine-run/m7.txt && grep -q "Q-BANC-10 .*user" .cuisine-run/m7.txt && ok "résumé : question sécurité non remontée listée avec sa raison" || ko "résumé sans la question sécurité écartée : $(grep -i 'remont' .cuisine-run/m7.txt)" ;;
  8) echo "Cas 8 : cliquet de la recette (changement d'auth.test.ts de 406301c, puis rescellement dans la chaîne)"
     mkdir -p api/src/features/auth/tests; cp "$HERE/fixtures/auth.test.avant.ts" api/src/features/auth/tests/auth.test.ts
     git add -A && git -c user.name=t -c user.email=t@t commit -qm avant
     cp "$HERE/fixtures/auth.test.apres.ts" api/src/features/auth/tests/auth.test.ts
     python3 .cuisine/scripts/cliquet.py HEAD --sans-contre-exemple > .cuisine-run/c1.txt && ko "changement d'auth.test.ts accepté sans référence" || ok "changement d'auth.test.ts bloqué sans référence"
     mkdir -p specifications/socle; printf "ACCEPTED: [Q-PLAT-03] the OpenAPI document is served in test, with both security schemes and no test route : les modules métier ajoutent des routes.\n" > specifications/socle/DISPUTES.md
     python3 .cuisine/scripts/cliquet.py HEAD --sans-contre-exemple > .cuisine-run/c2.txt && ok "accepté avec une contestation ACCEPTED qui le nomme" || ko "refusé malgré la contestation acceptée"
     rm -f specifications/socle/DISPUTES.md; git checkout -q -- api; git clean -fdq api/src/features
     pause; export BANC_DISPUTE=1 BANC_AFFAIBLIR=1; C arbitre v1-banc "A"; unset BANC_DISPUTE BANC_AFFAIBLIR
     grep -q "cliquet-fix" .cuisine-run/journal && ok "rescellement refusé, la QA rétablit le test" || ko "relâchement rescellé sans refus"
     grep -q "toBe(200)" acceptance/acceptance-banc.test.ts && ok "attendu strict rétabli" || ko "attendu relâché conservé"
     [ "$(last_status)" = ok ] && ok "suite menée à son terme" || ko "suite : $(last_status)" ;;
  9) echo "Cas 9 : registre des tests vus rouges ; seul un test absent du registre doit être rouge ; aucune marque manuelle"
     ! grep -qs "red-ok" .cuisine/*.loop.yaml .cuisine/bin/cuisine && ok "aucune marque par version dans la chaîne" || ko "marque red-ok encore lue"
     t1 "T1" /banc/ping > acceptance/acceptance-banc.test.ts
     python3 .cuisine/scripts/rouge.py check acceptance-banc.test.ts > .cuisine-run/r1.txt && grep -q "T1" specifications/recette-rouge.yaml && ok "T1 rouge avant le code, inscrit" || ko "T1 : $(tail -2 .cuisine-run/r1.txt)"
     git add -A && git -c user.name=qa -c user.email=qa@local commit -qm "qa: sceau T1"
     echo 200 > api/src/banc-ping.status   # le code de T1 existe : T1 est vert désormais
     t1 "T2" /banc/pong >> acceptance/acceptance-banc.test.ts
     python3 .cuisine/scripts/rouge.py check acceptance-banc.test.ts > .cuisine-run/r2.txt && grep -q "T2" specifications/recette-rouge.yaml && ok "T2 nouveau et rouge exigé ; T1, déjà vu rouge, non rejoué" || ko "T2 : $(tail -2 .cuisine-run/r2.txt)"
     git add -A && git -c user.name=qa -c user.email=qa@local commit -qm "qa: sceau T2"
     t1 "T3" /banc/ping >> acceptance/acceptance-banc.test.ts
     printf -- "- fichier: acceptance-banc.test.ts\n  titre: '[rule-banc-ping-reponse] T3'\n  vu_rouge: '2026-01-01'\n  sur: manuel\n" >> specifications/recette-rouge.yaml
     python3 .cuisine/scripts/rouge.py check acceptance-banc.test.ts > .cuisine-run/r3.txt; r=$?
     [ $r = 3 ] && grep -q "VACUOUS.*T3" .cuisine-run/r3.txt && ok "T3 vert avant le code refusé, malgré une inscription manuelle non scellée" || ko "T3 accepté (code $r) : $(tail -2 .cuisine-run/r3.txt)" ;;
  10) echo "Cas 10 : après le premier passage de code-back, une contestation ACCEPTED ne suffit plus ; une décision D-xxxx est exigée"
     mkdir -p api/src/features/auth/tests specifications/socle; cp "$HERE/fixtures/auth.test.avant.ts" api/src/features/auth/tests/auth.test.ts
     git add -A && git -c user.name=t -c user.email=t@t commit -qm avant
     cp "$HERE/fixtures/auth.test.apres.ts" api/src/features/auth/tests/auth.test.ts
     printf "ACCEPTED: [Q-PLAT-03] the OpenAPI document is served in test, with both security schemes and no test route : les modules métier ajoutent des routes.\n" > specifications/socle/DISPUTES.md
     echo v1-banc > .cuisine-run/version; touch .cuisine-run/v1-banc.code
     python3 .cuisine/scripts/cliquet.py HEAD --sans-contre-exemple > .cuisine-run/c1.txt && ko "contestation ACCEPTED admise après le code" || { grep -q "décision D-xxxx est exigée" .cuisine-run/c1.txt && ok "contestation ACCEPTED refusée après le code, décision exigée" || ko "refus sans motif : $(tail -2 .cuisine-run/c1.txt)"; }
     python3 - <<'EOF'
p = 'api/src/features/auth/tests/auth.test.ts'; s = open(p).read()
i = s.index('the OpenAPI document is served in test'); j = s.index('\n', i)
open(p, 'w').write(s[:j + 1] + '    // décision D-0007 : les modules métier ajoutent des routes\n' + s[j + 1:])
EOF
     python3 .cuisine/scripts/cliquet.py HEAD --sans-contre-exemple > .cuisine-run/c2.txt && ok "admis avec la décision D-0007" || ko "refusé malgré la décision : $(tail -2 .cuisine-run/c2.txt)" ;;
  11) echo "Cas 11 : contre-exemple obligatoire, le test relâché doit encore refuser un 500"
     t1 "T1" /banc/ping > acceptance/acceptance-banc.test.ts; echo 200 > api/src/banc-ping.status
     git add -A && git -c user.name=qa -c user.email=qa@local commit -qm "qa: sceau"
     sed -i "s#expect(res.status).toBe(200)#// décision D-0001\n    expect(res.status).toBeGreaterThanOrEqual(200)#" acceptance/acceptance-banc.test.ts
     python3 .cuisine/scripts/cliquet.py HEAD > .cuisine-run/c1.txt && ko "relâchement qui accepte un 500 admis" || { grep -q "réponse fausse" .cuisine-run/c1.txt && ok "relâchement qui accepte un 500 refusé par le contre-exemple" || ko "refus sans contre-exemple : $(tail -2 .cuisine-run/c1.txt)"; }
     sed -i "s#toBeGreaterThanOrEqual(200)#toBeLessThan(300)#" acceptance/acceptance-banc.test.ts
     python3 .cuisine/scripts/cliquet.py HEAD > .cuisine-run/c2.txt && grep -q "1/1 test(s) relâché(s) refusent encore" .cuisine-run/c2.txt && ok "relâchement qui refuse encore un 500 admis" || ko "relâchement sain refusé : $(tail -3 .cuisine-run/c2.txt)" ;;
  12) echo "Cas 12 : échantillon B, la version d'origine d'un test relâché est rejouée ; l'écart va au résumé"
     echo v1-banc > .cuisine-run/version
     t1 "T1" /banc/ping > acceptance/acceptance-banc.test.ts; echo 200 > api/src/banc-ping.status
     git add -A && git -c user.name=qa -c user.email=qa@local commit -qm "qa: sceau"
     sed -i "s#expect(res.status).toBe(200)#// décision D-0001\n    expect(res.status).toBeLessThan(300)#" acceptance/acceptance-banc.test.ts
     echo 204 > api/src/banc-ping.status   # l'application livrée répond 204 : le relâchement l'a laissé passer
     python3 .cuisine/scripts/echantillon_b.py HEAD > .cuisine-run/e.txt 2>&1
     grep -q "Écarts : 1" .cuisine-run/v1-banc.echantillon-b.md 2>/dev/null && grep -q "Écart.*T1" .cuisine-run/v1-banc.echantillon-b.md && ok "écart de l'échantillon B constaté" || ko "écart non constaté : $(cat .cuisine-run/e.txt)"
     ! ls acceptance | grep -q echantillon-b && ok "fichier d'origine retiré après rejeu" || ko "fichier d'échantillon laissé dans la recette"
     echo 200 > api/src/banc-ping.status
     python3 .cuisine/scripts/echantillon_b.py HEAD > .cuisine-run/e.txt 2>&1
     grep -q "Écarts : 0" .cuisine-run/v1-banc.echantillon-b.md && ok "sans écart quand l'application répond l'attendu d'origine" || ko "faux écart" ;;
  13) echo "Cas 13 : une erreur de mise en place n'est pas un rouge (défaut constaté sur la preuve du test de concurrence)"
     t1 "T1" /banc/ping | sed "s#const res#// mise-en-place-cassee\\n    const res#" > acceptance/acceptance-banc.test.ts
     python3 .cuisine/scripts/rouge.py check acceptance-banc.test.ts > .cuisine-run/r1.txt; r=$?
     [ $r = 3 ] && grep -q "ERREUR DE MISE EN PLACE" .cuisine-run/r1.txt && ! grep -qs "T1" specifications/recette-rouge.yaml && ok "échec du harnais refusé comme rouge, rien d'inscrit" || ko "échec du harnais compté rouge (code $r)"
     python3 .cuisine/scripts/rouge.py prouver abc1234 acceptance/acceptance-banc.test.ts > .cuisine-run/r2.txt; r=$?
     [ $r = 3 ] && ok "preuve sur un commit antérieur refusée si l'échec vient du harnais" || ko "preuve vide acceptée (code $r)" ;;
  14) echo "Cas 14 : un blocage du lot n'est pas un rouge pour tous ; preuve test par test (défaut constaté sur la preuve)"
     echo 200 > api/src/banc-ping.status
     { t1 "T1" /banc/ping; t1 "T2" /banc/ping | sed "s#const res#// bloque-sans-fin\\n    const res#"; } > acceptance/acceptance-banc.test.ts
     python3 .cuisine/scripts/rouge.py prouver mutant acceptance/acceptance-banc.test.ts > .cuisine-run/r1.txt; r=$?
     [ $r = 3 ] && [ ! -f specifications/recette-rouge.yaml ] && ok "blocage du lot : rien d'inscrit" || ko "blocage du lot attribué à tous (code $r)"
     python3 .cuisine/scripts/rouge.py prouver mutant acceptance/acceptance-banc.test.ts "T2" > .cuisine-run/r2.txt; r2=$?
     python3 .cuisine/scripts/rouge.py prouver mutant acceptance/acceptance-banc.test.ts "T1" > .cuisine-run/r3.txt; r3=$?
     [ $r2 = 0 ] && grep -q "T2" specifications/recette-rouge.yaml && ok "T2 seul : son blocage vaut rouge, inscrit" || ko "T2 non inscrit (code $r2)"
     [ $r3 = 3 ] && ! grep -q "T1" specifications/recette-rouge.yaml && ok "T1 seul : vert, non inscrit" || ko "T1 inscrit (code $r3)" ;;
  esac
  [ "${BANC_KEEP:-}" ] && echo "    (dépôt conservé : $T)" || { cd /; rm -rf "$T"; }
done
if [ -n "$RETIRER" ]; then
  echo "retrait $RETIRER : $fail KO (attendu : au moins 1)"; exit $([ $fail -gt 0 ] && echo 0 || echo 1)
fi
echo "reprise: $pass OK, $fail KO"
exit $([ $fail -eq 0 ] && echo 0 || echo 1)
