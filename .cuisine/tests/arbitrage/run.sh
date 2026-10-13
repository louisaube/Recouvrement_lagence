#!/usr/bin/env bash
# Critères d'acceptation de l'étape d'arbitrage (spécification « étape d'arbitrage révisable », section 4),
# rejoués sur une copie jetable du dépôt. Usage : bash .cuisine/tests/arbitrage/run.sh
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
cp -r "$ROOT/specifications" "$ROOT/.cuisine" "$T/"
mkdir -p "$T/acceptance" && cp "$ROOT"/acceptance/*.ts "$T/acceptance/"
rm -f "$T"/specifications/*/arbitrages.yaml; find "$T/specifications" -name questions.yaml -delete   # registre et questions réels hors essai
cd "$T" && git init -q && git add -A && git -c user.name=t -c user.email=t@t commit -qm base
A="python3 .cuisine/scripts/arbitrage.py"; V=essai-arbitrage
D="specifications/socle/implementation-plans/$V"; mkdir -p "$D" .cuisine-run
cp "$ROOT/.cuisine/tests/arbitrage/questions-salle-blanche.yaml" "$D/questions.yaml"
pass=0; fail=0
ok() { echo "  OK  $*"; pass=$((pass+1)); }
ko() { echo "  KO  $*"; fail=$((fail+1)); }

echo "Critère 6 : deux options au même attendu sont rejetées"
$A check $V >/dev/null && ok "les 33 questions sont bien formées" || { $A check $V | tail -5; ko "questions mal formées"; }
python3 - "$D/questions.yaml" <<'EOF'
import sys, yaml
qs = yaml.safe_load(open(sys.argv[1]))
q = next(q for q in qs if q['id'] == 'Q-IMPORT-07'); q['options'][1]['test']['attendu'] = q['options'][0]['test']['attendu']
yaml.safe_dump(qs, open(sys.argv[1] + '.bad', 'w'), allow_unicode=True, sort_keys=False)
EOF
mkdir -p "specifications/socle/implementation-plans/mauvais" && mv "$D/questions.yaml.bad" "specifications/socle/implementation-plans/mauvais/questions.yaml"
$A check mauvais > mauvais.txt; grep -q "même test.attendu" mauvais.txt && ok "attendus identiques rejetés" || ko "attendus identiques acceptés"
rm -rf specifications/socle/implementation-plans/mauvais

echo "Critère 1 (règle B) : AUTH-03 + AUTH-04, COMPTES-01, IMPORT-01, IMPORT-06"
$A filter $V > filtre.txt; cat filtre.txt | sed 's/^/      /'
got="$(grep '^RETENUE' filtre.txt | sed 's/^RETENUE //' | sort | tr '\n' ';')"
want="Q-AUTH-03 + Q-AUTH-04;Q-COMPTES-01;Q-IMPORT-01;Q-IMPORT-06;"   # règle B : COMPTES-01 retenue, son défaut accepte un mot de passe que bcrypt tronque
[ "$got" = "$want" ] && ok "trois groupes attendus" || ko "retenu : $got"

echo "Critère 2 : la chaîne attend, puis reprend après arbitrage"
$A wait $V >/dev/null && ko "wait passe sans réponse" || ok "EN ATTENTE sans réponse"
n=$(grep -c '^RETENUE' filtre.txt); q=$(grep '^RETENUE' filtre.txt | tr '+' '\n' | grep -c 'Q-')
ans="$(python3 -c "print('/'.join(['B']*$q))")"
$A arbitre $V "$ans" >/dev/null && $A wait $V >/dev/null && ok "arbitre \"$ans\" puis wait passe" || ko "wait bloque après arbitrage"
git add -A && git -c user.name=t -c user.email=t@t commit -qm arbitrage

echo "Critère 4 : une règle sans sa décision fait échouer arbitrage-check"
$A check-spec $V >/dev/null && ko "check-spec passe alors qu'aucune règle n'est liée" || ok "règles non liées détectées"
python3 - <<'EOF'
import glob, re, yaml
reg = [d for p in glob.glob('specifications/*/arbitrages.yaml') for d in yaml.safe_load(open(p)) if d['statut'] == 'active']
qs = {q['id']: q for q in yaml.safe_load(open('specifications/socle/implementation-plans/essai-arbitrage/questions.yaml'))}
by_rule = {}
for d in reg:
    for r in qs[d['question']]['regles']:
        by_rule.setdefault(r, []).append(d['decision'])
for f in glob.glob('specifications/socle/*.md'):
    s = open(f).read()
    for r, ds in by_rule.items():
        s = re.sub(rf'(`{r}`) \(([a-z]+)\)', lambda m: f'{m.group(1)} ({m.group(2)}, ' + ', '.join(f'decision {d}' for d in ds) + ')', s)
    open(f, 'w').write(s)
EOF
$A check-spec $V > spec.txt && ok "règles liées : $(tail -1 spec.txt)" || { head -3 spec.txt; ko "check-spec échoue après liaison"; }
f=specifications/socle/20-authentification-session.md
sed -i 's/, decision D-[0-9]*//g' $f
$A check-spec $V >/dev/null && ko "règle déliée non vue" || ok "règle modifiée à la main détectée"
git checkout -q -- $f

echo "Critère 7 : chaque décision observable a son test [D-xxxx]"
$A check-tests $V >/dev/null && ko "check-tests passe sans test" || ok "tests manquants détectés"
python3 - <<'EOF'
import glob, yaml
reg = [d for p in glob.glob('specifications/*/arbitrages.yaml') for d in yaml.safe_load(open(p)) if d['statut'] == 'active']
qs = {q['id']: q for q in yaml.safe_load(open('specifications/socle/implementation-plans/essai-arbitrage/questions.yaml'))}
out = ["describe('arbitrages', () => {"]
for d in reg:
    q = qs[d['question']]
    if q['observable'] != 'oui':
        continue
    t = next(o for o in q['options'] if o['code'] == d['choix'])['test']
    out.append(f"  it('[{q['regles'][0]}][{d['decision']}] {q['id']}', async () => {{ /* {t['route']} -> {t['attendu']} */ }})")
open('acceptance/acceptance-arbitrages.test.ts', 'w').write('\n'.join(out + ['})', '']))
EOF
$A check-tests $V > tests.txt && ok "$(tail -1 tests.txt)" || { head -3 tests.txt; ko "check-tests échoue avec les tests"; }
sed -i '0,/\[D-0/s/\[D-0[0-9]*\]//' acceptance/acceptance-arbitrages.test.ts
$A check-tests $V >/dev/null && ko "test supprimé non vu" || ok "test [D-xxxx] retiré détecté"
git checkout -q -- acceptance 2>/dev/null; git clean -fq acceptance
git add -A && git -c user.name=t -c user.email=t@t commit -qm tests -q

echo "Critère 5 : le registre ne perd jamais une ligne"
$A append-only HEAD >/dev/null && ok "registre intact" || ko "registre signalé à tort"
python3 - <<'EOF'
import yaml
p = 'specifications/socle/arbitrages.yaml'; d = yaml.safe_load(open(p)); d.pop(0)
yaml.safe_dump(d, open(p, 'w'), allow_unicode=True, sort_keys=False)
EOF
$A append-only HEAD >/dev/null && ko "suppression non vue" || ok "suppression détectée"
git checkout -q -- specifications/socle/arbitrages.yaml

echo "Critère 3 : la révision ne touche que le périmètre de sa question"
$A revise Q-IMPORT-01 A "coût de l'envoi d'e-mails jugé disproportionné" > rev.txt && ok "$(head -1 rev.txt)" || ko "révision refusée"
$A append-only HEAD >/dev/null && ok "révision en ajout seul" || ko "révision altère le registre"
python3 - <<'EOF'
import json
r = json.load(open('.cuisine-run/revision.json'))
bad = [t for t in r['tests'] if 'import-users-no-password' not in t and r['decision'] not in t and 'D-' not in t]
print('      tests rouverts :', len(r['tests']))
assert not bad, bad
EOF
[ $? -eq 0 ] && ok "impact limité aux règles de Q-IMPORT-01" || ko "impact déborde"
python3 - <<'PY'
import re
p = 'acceptance/acceptance-session.test.ts'; s = open(p).read()
m = re.search(r"^\s*it\(.*$", s, re.M)
open(p, 'w').write(s[:m.end()] + "\n      expect(1).toBe(1)" + s[m.end():])
PY
$A check-tests $V > scope.txt; grep -q "hors périmètre modifié" scope.txt && ok "test hors périmètre modifié détecté" || ko "test hors périmètre modifié non vu"

echo "Critère 8 : un identifiant de question n'appartient qu'à une version"
W="specifications/socle/implementation-plans/essai-suivante"; mkdir -p "$W"
python3 - "$D/questions.yaml" "$W/questions.yaml" <<'EOF'
import sys, yaml
q = next(q for q in yaml.safe_load(open(sys.argv[1])) if q['id'] == 'Q-IMPORT-01')   # tranchée, puis révisée au critère 3
yaml.safe_dump([q], open(sys.argv[2], 'w'), allow_unicode=True, sort_keys=False)
EOF
printf -- '- règle suspendue à Q-IMPORT-01 (défaut A) ; Q-IMPORT-011 est un autre identifiant\n' > "$W/plan.md"
$A check essai-suivante > c8.txt; grep -q "déjà pris par la version $V" c8.txt && ok "check refuse l'identifiant d'une autre version" || { cat c8.txt; ko "identifiant repris accepté par check"; }
libre="$(grep -o 'renumber essai-suivante Q-IMPORT-01 Q-IMPORT-[0-9]*' c8.txt | awk '{print $NF}')"
[ -n "$libre" ] && ok "identifiant libre proposé : $libre" || ko "aucun identifiant libre proposé"
cp specifications/socle/arbitrages.yaml reg8.yaml
$A filter essai-suivante > f8.txt && ko "filter accepte la collision" || { grep -q '^COLLISION Q-IMPORT-01' f8.txt && cmp -s reg8.yaml specifications/socle/arbitrages.yaml && ok "filter refuse la collision sans rien inscrire" || ko "filter : collision mal refusée"; }
$A check-spec essai-suivante > s8.txt; grep -q "Q-IMPORT-01 : identifiant déjà tranché pour la version $V" s8.txt && ok "check-spec nomme la collision" || { cat s8.txt; ko "check-spec ne nomme pas la collision"; }
$A renumber essai-suivante Q-IMPORT-01 Q-IMPORT-02 >/dev/null 2>&1 && ko "renumérotation vers un identifiant pris acceptée" || ok "renumérotation vers un identifiant pris refusée"
$A renumber essai-suivante Q-IMPORT-01 "$libre" >/dev/null && grep -q "^- id: $libre\$" "$W/questions.yaml" && grep -q "suspendue à $libre (défaut A) ; Q-IMPORT-011 " "$W/plan.md" \
  && grep -q '^- id: Q-IMPORT-01$' "$D/questions.yaml" && ok "renumérotée dans les seuls fichiers de la version" || ko "renumérotation incomplète ou débordante"
$A check essai-suivante >/dev/null && ok "check passe après renumérotation" || ko "check échoue après renumérotation"
$A filter essai-suivante >/dev/null && $A wait essai-suivante > w8.txt; grep -q "EN ATTENTE.*$libre" w8.txt && ok "la question revient au propriétaire au lieu d'hériter d'une décision étrangère" || { cat w8.txt; ko "question renumérotée tenue pour tranchée"; }
$A arbitre essai-suivante A >/dev/null && $A renumber essai-suivante "$libre" Q-IMPORT-90 >/dev/null 2>&1 && ko "renumérotation d'une question déjà tranchée acceptée" || ok "question tranchée pour la version : renumérotation refusée"
rm -rf "$W"

echo "Mesures"
$A metrics $V | sed 's/^/      /'
echo "arbitrage: $pass OK, $fail KO"
exit $([ $fail -eq 0 ] && echo 0 || echo 1)
