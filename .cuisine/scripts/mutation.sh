#!/usr/bin/env bash
# Test de mutation (StrykerJS) : la recette boîte noire tue-t-elle les mutants du code de l'API ?
# Usage : mutation.sh [--seuil N] [<motif de fichiers à muter> ...]   (depuis la racine du dépôt)
#   défaut : le contrôle d'accès et l'authentification (api/src/platform/access, api/src/features/auth)
#   MUTATION_TESTS : fichiers de recette (défaut : session et authentification) ;
#   MUTATION_API_TESTS : motif des tests de l'API (défaut : tous ; none pour la recette seule).
# Stryker instrumente le code une fois (tous les mutants compilés ensemble, activés par variable
# d'environnement) ; pour chaque mutant, le serveur de test redémarre sur le code instrumenté et
# la recette du périmètre s'exécute (arrêt au premier échec). Rapport : .cuisine-run/mutation/.
# Ne pas lancer pendant une fabrication : le port 4000 et la base de recette sont partagés.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SEUIL=0; [ "${1:-}" = "--seuil" ] && { SEUIL="$2"; shift 2; }
MUTATE=("$@"); [ ${#MUTATE[@]} -gt 0 ] || MUTATE=("src/platform/access/**/*.ts" "src/features/auth/**/*.ts")
# recette du périmètre : fichiers de recette des lots qui citent ces dossiers, à défaut toute la recette
TESTS="${MUTATION_TESTS:-$(cd "$ROOT/acceptance" && ls acceptance-session.test.ts acceptance-auth.test.ts acceptance-renfort-*.test.ts acceptance-bearer-*.test.ts 2>/dev/null | tr "\n" " ")}"
API_TESTS="${MUTATION_API_TESTS:-}"   # motif Jest des tests de l'API ; vide : tous ; none : aucun
W="$ROOT/.cuisine-run/mutation"; rm -rf "$W"; mkdir -p "$W"
cat > "$W/run-mutant.sh" <<EOF
#!/usr/bin/env bash
# Exécuté par Stryker dans son bac à sable (répertoire api instrumenté), une fois par mutant.
export NO_PROXY=localhost,127.0.0.1 no_proxy=localhost,127.0.0.1
fuser -k 4000/tcp >/dev/null 2>&1; sleep 0.3
cp -n "$ROOT/api/.env.test" .env.test 2>/dev/null
NODE_ENV=test node dist/main.js >> "$ROOT/api/.server-test.log" 2>&1 & pid=\$!
for _ in \$(seq 1 60); do
  kill -0 \$pid 2>/dev/null || exit 1          # le mutant empêche le démarrage : tué
  [ "\$(curl -s -o /dev/null -w '%{http_code}' http://localhost:4000/server/health-check)" = 200 ] && break
  sleep 0.25
done
(cd "$ROOT/acceptance" && npx jest --runInBand --bail -c jest.config.js $TESTS > "$W/last-test.log" 2>&1); r=\$?
# tests propres de l'API, exécutés dans le bac à sable : ils voient le mutant en mémoire comme par HTTP
[ \$r -eq 0 ] && [ "$API_TESTS" != none ] && { NODE_ENV=test npx jest --runInBand --bail $API_TESTS >> "$W/last-test.log" 2>&1; r=\$?; }
kill \$pid 2>/dev/null; wait \$pid 2>/dev/null
exit \$r
EOF
chmod +x "$W/run-mutant.sh"
printf '#!/usr/bin/env bash\n# compile le code instrumenté dans le bac à sable de Stryker\n[ -e node_modules ] || ln -s "%s/api/node_modules" node_modules\nexec pnpm -s build\n' "$ROOT" > "$W/build.sh"
python3 - "$W/stryker.conf.json" "$W" "$SEUIL" "${MUTATE[@]}" <<'EOF'
import json, sys
out, W, seuil, *mutate = sys.argv[1:]
json.dump({
  "$schema": "./node_modules/@stryker-mutator/core/schema/stryker-schema.json",
  "packageManager": "pnpm",
  "testRunner": "command",
  "commandRunner": {"command": f"bash {W}/run-mutant.sh"},
  "buildCommand": f"bash {W}/build.sh",
  "mutate": mutate,
  "disableTypeChecks": "src/**/*.ts",
  "coverageAnalysis": "off",
  "concurrency": 1,
  "timeoutMS": 120000,
  "ignorePatterns": ["dist", ".server-*.log", "coverage"],
  "tempDirName": f"{W}/stryker-tmp",
  "reporters": ["clear-text", "html", "json", "progress"],
  "htmlReporter": {"fileName": f"{W}/rapport.html"},
  "jsonReporter": {"fileName": f"{W}/rapport.json"},
  "thresholds": {"high": 80, "low": 60, "break": int(seuil) or None},
}, open(out, 'w'), indent=1)
EOF
V="${CUISINE_VENDOR:-$HOME/.cuisine-vendor}/stryker"
[ -x "$V/node_modules/.bin/stryker" ] || npm i -s --prefix "$V" @stryker-mutator/core@8.7.1 typescript@5.7.3 >/dev/null 2>&1 || { echo "installation de Stryker impossible"; exit 2; }
cd "$ROOT/api" && "$V/node_modules/.bin/stryker" run "$W/stryker.conf.json" > "$W/stryker.log" 2>&1; r=$?
(cd "$ROOT/api" && NODE_ENV=test bash scripts/server/start.sh >/dev/null 2>&1)   # remet le serveur de test normal
python3 - "$W/rapport.json" <<'EOF'
import json, sys
from collections import Counter
try:
    d = json.load(open(sys.argv[1]))
except OSError:
    print('mutation: rapport absent (voir .cuisine-run/mutation/stryker.log)'); sys.exit(0)
c = Counter(m['status'] for f in d['files'].values() for m in f['mutants'])
killed = c['Killed'] + c['Timeout']; valid = killed + c['Survived'] + c['NoCoverage']
for name, f in d['files'].items():
    for m in f['mutants']:
        if m['status'] in ('Survived', 'NoCoverage'):
            print(f"SURVIVANT {name}:{m['location']['start']['line']} {m['mutatorName']} -> {m.get('replacement', '')[:70]!r}")
print(f"mutation: {killed}/{valid} mutants tués ({100 * killed / valid if valid else 0:.1f} %), {c['CompileError'] + c['RuntimeError']} invalides")
EOF
exit $r
