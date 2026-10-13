#!/usr/bin/env bash
# Banc de couts.py : critères d'acceptation A1 à A9 de la spécification « instrumentation de la cuisine », sur un jeu de
# runs fabriqué (fabrique.py). Sans modèle, quelques secondes.
# Usage : bash .cuisine/tests/couts/run.sh            ou   --retirer N   (retire le mécanisme du critère N ; il doit échouer)
set -uo pipefail
RETIRER=""; [ "${1:-}" = "--retirer" ] && RETIRER="$2"
SRC="$(cd "$(dirname "$0")/../../.." && pwd)"
pass=0; fail=0
ok() { echo "  OK  $*"; pass=$((pass+1)); }
ko() { echo "  KO  $*"; fail=$((fail+1)); }
T="$(mktemp -d)"; cd "$T"
mkdir -p .cuisine/scripts; cp "$SRC/.cuisine/scripts/couts.py" .cuisine/scripts/; cp "$SRC/.cuisine/tarifs.yaml" .cuisine/
python3 "$SRC/.cuisine/tests/couts/fabrique.py" "$T" "$T/journaux"
printf '.cuisine-run/\n' > .gitignore
if [ -n "$RETIRER" ]; then python3 - "$RETIRER" <<'PY'
import sys
n = sys.argv[1]; p = '.cuisine/scripts/couts.py'; s = open(p).read()
R = {'1': ("            if split and sum(split) != tok['ecriture_cache']:", "            split = None\n            if split and sum(split) != tok['ecriture_cache']:"),
     '2': ("        return 'porte-rouge'", "        return 'fin-normale'"),
     '3': ("    agregat = {'seuils_provisoires'", "    agregat = {'genere': __import__('time').time(), 'seuils_provisoires'"),
     '4': ("                tok, source = None, 'données absentes'", "                tok, source = {'entree': 0, 'ecriture_cache': 0, 'lecture_cache': 0, 'sortie': 0}, 'journal'"),
     '5': ("        return None, None\n    w5, w1", "        return 0.0, None\n    w5, w1"),
     '6': ("SORTIE = opt('--sortie', os.path.join(ROOT, '.cuisine-run'))", "SORTIE = opt('--sortie', os.path.join(ROOT, 'mesures'))"),
     '7': ("                s['instabilites'] += 1", "                pass"),
     '8': ("    with open(os.path.join(SORTIE, 'couts-propositions.md'), 'w', encoding='utf-8') as fh:", "    with open(os.path.join(ROOT, '.cuisine', 'propositions.md'), 'w', encoding='utf-8') as fh:"),
     'p': ("    runs += runs_archives({r['meta']['run'] for r in runs})", "    pass"),
     '11': ("    if res[0][0] != res[1][0]:", "    if False:"),
     '9': ("+ hashlib.sha256(open(f, 'rb').read()).digest())", ")")}
a, b = R[n]; assert a in s, n; open(p, 'w').write(s.replace(a, b))
PY
fi
git init -q && git add -A && git -c user.name=t -c user.email=t@t commit -qm banc
C() { python3 .cuisine/scripts/couts.py "$@" --journaux "$T/journaux"; }
avant="$(git status --porcelain; find .cuisine -type f | sort | xargs sha256sum)"
mkdir -p .cuisine-run; C > .cuisine-run/sortie.txt 2>&1 || { cat .cuisine-run/sortie.txt; ko "calcul en échec"; }
J() { python3 -c "import json,sys; d=json.load(open('.cuisine-run/couts/$1.json')); print(eval(sys.argv[1]))" "$2"; }
echo "A1 : somme des coûts par nœud égale au coût rapporté par l'agent, à 1 % près"
python3 - <<'PY' && ok "estimé et rapporté concordent (v1..v4)" || ko "écart de plus de 1 % entre estimé et rapporté"
import json, sys
for v in ['v1', 'v2', 'v3', 'v4']:
    r = json.load(open(f'.cuisine-run/couts/{v}.json'))
    e, a = r['total']['cout_estime_usd'], r['total']['cout_agent_usd']
    if e is None or a is None or abs(e - a) > 0.01 * a: sys.exit(1)
PY
echo "A2 : chaque visite porte exactement une cause d'arrêt"
python3 - <<'PY' && ok "une cause par visite, porte rouge et boucle de réparation reconnues" || ko "cause manquante ou erronée"
import json, glob, sys
C = {'limite-abonnement', 'erreur-api', 'limite-tours', 'limite-tokens', 'outil-refusé', 'boucle-réparation', 'porte-rouge', 'fin-normale'}
vs = [v for f in glob.glob('.cuisine-run/couts/*.json') for v in json.load(open(f))['visites']]
ok = all(isinstance(v['cause'], str) and v['cause'] in C for v in vs)
ok &= all(v['cause'] == 'porte-rouge' for v in vs if v['role'] == 'porte' and v['code_sortie'] != 0)
ok &= any(v['cause'] == 'boucle-réparation' and v['noeud'] == 'fix' and v['run'] == 'v1' for v in vs)
sys.exit(0 if ok else 1)
PY
echo "A3 : deux calculs sur les mêmes journaux donnent un couts.json identique octet pour octet"
cp .cuisine-run/couts.json "$T.c1"; sleep 1; C > /dev/null 2>&1
cmp -s "$T.c1" .cuisine-run/couts.json && ok "couts.json identique" || ko "couts.json diffère d'un calcul à l'autre"
echo "A4 : rejeu, coût et itérations si les journaux existent, « données absentes » sinon"
[ "$(J r-ancien "d['donnees']")" = absentes ] && ok "run sans journal : données absentes" || ko "run sans journal : $(J r-ancien "d['donnees']")"
[ "$(J v3 "d['iterations_avant_vert']")" = 1 ] && [ "$(J v3 "d['donnees']")" = présentes ] && ok "run avec journal : coût et itérations (v3 : 1)" || ko "itérations de v3 : $(J v3 "d['iterations_avant_vert']")"
echo "A5 : modèle absent de la grille, « coût inconnu », exclu du total avec mention"
[ "$(J r-inconnu "[v['cout_statut'] for v in d['visites'] if v['type'] == 'prompt'][0]")" = "coût inconnu" ] && [ "$(J r-inconnu "d['total']['visites_sans_cout']")" = 1 ] && [ "$(J r-inconnu "d['total']['cout_usd']")" = None ] \
  && ok "coût inconnu, exclu, compté à part" || ko "modèle hors grille mal traité : $(J r-inconnu "d['total']")"
echo "A6 : aucun fichier du dépôt modifié par le calcul ; A8 : propositions en texte seul, .cuisine intact"
apres="$(git status --porcelain; find .cuisine -type f | sort | xargs sha256sum)"
[ -z "$(git status --porcelain)" ] && ok "dépôt inchangé" || ko "dépôt modifié : $(git status --porcelain | head -3)"
[ "$avant" = "$apres" ] && [ -s .cuisine-run/couts-propositions.md ] && ok "propositions écrites hors de .cuisine, .cuisine intact" || ko ".cuisine modifié ou propositions absentes"
echo "A7 : porte jamais rouge, instable et tardive signalées ; porte saine non signalée"
python3 - <<'PY' && ok "porte-j jamais rouge, porte-i instable, porte-b tardive, porte-s sans signal" || ko "signaux : $(python3 -c "import json; print({k: p['signaux'] for k, p in json.load(open('.cuisine-run/couts.json'))['portes'].items()})")"
import json, sys
p = json.load(open('.cuisine-run/couts.json'))['portes']
sys.exit(0 if 'jamais-rouge' in p['porte-j']['signaux'] and 'instable' in p['porte-i']['signaux'] and 'tardive' in p['porte-b']['signaux'] and p['porte-s']['signaux'] == [] else 1)
PY
echo "A9 : empreintes différentes pour deux configurations, identiques pour la même"
e1=$(C empreinte); sed -i 's/porte-j: {type: command, cmd: "true"/porte-j: {type: command, cmd: "true;true"/' .cuisine/banc.loop.yaml
e2=$(C empreinte); git checkout -q -- .cuisine/banc.loop.yaml; e3=$(C empreinte)
[ "$e1" != "$e2" ] && [ "$e1" = "$e3" ] && ok "empreinte sensible au contenu, stable à configuration égale" || ko "empreintes : $e1 $e2 $e3"
echo "F11 : rejeu d'une porte sur un arbre inchangé"
C determinisme porte-s -c .cuisine/banc.loop.yaml > .cuisine-run/d1.txt; r1=$?
C determinisme porte-alterne -c .cuisine/banc.loop.yaml > .cuisine-run/d2.txt; r2=$?
[ $r1 = 0 ] && [ $r2 = 1 ] && grep -q "ANOMALIE DE PROCESS porte-alterne" .cuisine-run/d2.txt && ok "porte stable reconnue, porte alternante signalée" || ko "déterminisme : $r1 $r2 $(cat .cuisine-run/d2.txt)"
echo "Persistance : archive sur une branche dédiée, relue par une machine neuve"
C > /dev/null 2>&1; C archiver > .cuisine-run/a.txt 2>&1
git rev-parse -q --verify refs/heads/cuisine/couts >/dev/null && [ -z "$(git status --porcelain)" ] && [ "$(git branch --show-current)" != cuisine/couts ] && ok "branche cuisine/couts écrite sans toucher l'arbre" || ko "archive : $(cat .cuisine-run/a.txt)"
rm -rf .yamloop .cuisine-run/couts; C > /dev/null 2>&1
python3 -c "import json,sys; c=json.load(open('.cuisine-run/couts.json')); sys.exit(0 if len(c['runs']) == 6 and c['estimation']['banc']['statut'] == 'estimé' else 1)" \
  && ok "machine neuve : les six runs archivés calibrent l'estimation" || ko "historique perdu sans les runs locaux"
echo "F9 : hygiène, ni texte de sortie ni de prompt dans les résultats"
! grep -rqs "sortie 1\|sortie 0" .cuisine-run/couts .cuisine-run/couts.json && ok "aucun extrait de sortie" || ko "extrait de sortie dans les résultats"
cd /; rm -rf "$T" "$T.c1" "$T-etat"
if [ -n "$RETIRER" ]; then echo "retrait $RETIRER : $fail KO (attendu : au moins 1)"; exit $([ $fail -gt 0 ] && echo 0 || echo 1); fi
echo "couts: $pass OK, $fail KO"; exit $([ $fail -eq 0 ] && echo 0 || echo 1)
