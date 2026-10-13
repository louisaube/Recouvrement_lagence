#!/usr/bin/env bash
# Contrôle de contamination de la salle blanche : recherche, par jscpd, des fragments du nouveau code
# identiques ou quasi identiques à une implémentation antérieure (ancien socle, dépôt d'origine).
# Usage : contamination-check.sh <dossier de référence> [<dossier de référence> ...]
#   (les dossiers de référence sont déchiffrés hors du dépôt, le temps du contrôle, puis effacés)
# Bloquant : un fragment commun de 25 lignes ou plus, ou plus de 3 % des lignes nouvelles en commun.
# Les fichiers de configuration courts et les migrations générées sont exclus des deux côtés.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
[ $# -ge 1 ] || { sed -n '2,7p' "$0"; exit 2; }
W="$ROOT/.cuisine-run/contamination"; rm -rf "$W"; mkdir -p "$W/new" "$W/old"
copy() { # copie les sources TypeScript et TSX utiles, sans dépendances ni fichiers générés
  (cd "$1" && find . \( -name node_modules -o -name dist -o -name build -o -name drizzle -o -name migrations -o -name .git -o -name acceptance -o -name .cuisine -o -name .cuisine-run -o -name .stryker-tmp \) -prune -o \
     -type f \( -name '*.ts' -o -name '*.tsx' \) ! -name '*.d.ts' ! -path './packages/api-client/src/schema*' -print) | while read -r f; do
    mkdir -p "$2/$(dirname "$f")"; cp "$1/$f" "$2/$f"; done
}
copy "$ROOT" "$W/new"
i=0; for ref in "$@"; do i=$((i+1)); copy "$ref" "$W/old/ref$i"; done
npx -y jscpd@4.0.5 --silent --min-lines 6 --min-tokens 60 --mode weak --format typescript,tsx \
  --reporters json --output "$W/report" "$W/new" "$W/old" >/dev/null 2>&1
python3 - "$W" <<'EOF'
import json, os, sys
W = sys.argv[1]
rep = json.load(open(os.path.join(W, 'report', 'jscpd-report.json')))
new = os.path.join(W, 'new') + os.sep
cross, lines = [], {}
for d in rep.get('duplicates', []):
    for k in ('firstFile', 'secondFile'): d[k]['name'] = os.path.abspath(d[k]['name'])
    a, b = d['firstFile']['name'], d['secondFile']['name']
    if (a.startswith(new)) == (b.startswith(new)):
        continue  # doublon interne à un même côté : hors sujet
    n, o = (d['firstFile'], d['secondFile']) if a.startswith(new) else (d['secondFile'], d['firstFile'])
    cross.append((d['lines'], n['name'][len(new):], n['start'], o['name'][len(W) + 5:], o['start']))
    for l in range(n['start'], n['end'] + 1):
        lines.setdefault(n['name'], set()).add(l)
total = 0
for root, _, files in os.walk(new):
    for f in files:
        total += sum(1 for _ in open(os.path.join(root, f), errors='replace'))
shared = sum(len(v) for v in lines.values())
pct = 100 * shared / total if total else 0
cross.sort(reverse=True)
for n_lines, nf, ns, of, os_ in cross[:30]:
    print(f'COMMUN {n_lines:4d} lignes  {nf}:{ns}  <->  {of}:{os_}')
big = [c for c in cross if c[0] >= 25]
print(f'contamination: {shared}/{total} lignes nouvelles en commun ({pct:.2f} %), {len(cross)} fragment(s), {len(big)} de 25 lignes ou plus')
sys.exit(1 if big or pct > 3 else 0)
EOF
