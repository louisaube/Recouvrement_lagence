#!/usr/bin/env bash
# Foundation (frozen). API contract check, no LLM. Run from the repository root, API running.
#   1. Snapshot the OpenAPI document generated from the code.
#   2. oasdiff: every breaking change against specifications/openapi.json (contract of record)
#      must be listed in specifications/contract-changes.yaml, otherwise it blocks.
#   2b. Lots : contrat de référence restreint aux chemins fabriqués (.cuisine-run/lot.env).
#   4. Fidélité comportementale (informatif) : données valides refusées ou invalides acceptées.
#   3. Schemathesis against the running API (admin token): server errors and responses that
#      violate the contract block; failures recorded in the foundation baseline are tolerated.
# Usage: contract-check.sh <work_dir>
set -u
WORK=${1:?work dir}; mkdir -p "$WORK"
export NO_PROXY=localhost,127.0.0.1 no_proxy=localhost,127.0.0.1
(cd api && NODE_ENV=test pnpm -s cuisine:openapi "$WORK/openapi.json" >/dev/null) || { echo "contract: snapshot failed (socle tooling contract: pnpm --dir api cuisine:openapi)"; exit 2; }
python3 .cuisine/scripts/accounts.py token admin > "$WORK/admin.tok" || { echo "contract: token failed"; exit 2; }

# Reconstruction par lots : le contrat de référence est restreint aux chemins des lots déjà fabriqués.
REF=specifications/openapi.json
if [ -f .cuisine-run/lot.env ]; then
  . .cuisine-run/lot.env
  python3 - "$WORK/reference.json" "$CONTRACT_PATHS" <<'PY'
import json, sys
doc = json.load(open('specifications/openapi.json')); entries = sys.argv[2].split()
# une entrée est un chemin entier (`/users`) ou une seule opération (`POST:/users`)
whole = {e for e in entries if ':/' not in e}
ops = {}
for e in entries:
    if ':/' in e:
        m, p = e.split(':', 1); ops.setdefault(p, set()).add(m.lower())
paths = {}
for p, item in doc['paths'].items():
    if p in whole:
        paths[p] = item
    elif p in ops:
        paths[p] = {k: v for k, v in item.items() if k not in ('get', 'post', 'put', 'patch', 'delete') or k in ops[p]}
doc['paths'] = paths
json.dump(doc, open(sys.argv[1], 'w'))
PY
  REF="$WORK/reference.json"
fi

oasdiff breaking "$REF" "$WORK/openapi.json" --format json > "$WORK/breaking.json" 2>/dev/null
python3 - "$WORK/breaking.json" > "$WORK/breaking.txt" <<'PY'
import json, sys, yaml
try: changes = json.load(open(sys.argv[1])) or []
except Exception: changes = []
allowed = (yaml.safe_load(open('specifications/contract-changes.yaml')) or {}).get('allowed') or []
ok = {(a['id'], a['path']) for a in allowed}
blocking = [c for c in changes if c.get('level', 3) >= 2 and (c['id'], c.get('path')) not in ok]
for c in blocking: print(f"BREAKING {c['id']} {c.get('operation','')} {c.get('path','')}: {c.get('text','')}")
print(f"breaking: {len(changes)} found, {len(blocking)} not allowed")
PY
cat "$WORK/breaking.txt"
BREAK=$(grep -c '^BREAKING' "$WORK/breaking.txt")

st run "$WORK/openapi.json" --url http://localhost:4000 -H "Authorization: Bearer $(cat "$WORK/admin.tok")" \
  --checks not_a_server_error,response_schema_conformance -n 30 --generation-deterministic --max-time 150 \
  --phases examples,coverage,fuzzing $( [ -f .cuisine/contract/schemathesis-baseline.json ] && echo --baseline .cuisine/contract/schemathesis-baseline.json ) \
  --report json --report-dir "$WORK/st" --warnings off --output-truncate true > "$WORK/schemathesis.txt" 2>&1
ST=$?
python3 - "$WORK" <<'PY'
import json, glob, sys
f = sorted(glob.glob(sys.argv[1] + '/st/*.json'))
if not f: print('schemathesis: no report'); sys.exit()
d = json.load(open(f[-1]))
for fl in d['failures']:
    print(f"SCHEMATHESIS {fl['type']} ({fl['count']}): " + ', '.join(map(str, fl['operations'])))
print(f"schemathesis: {d['test_cases']['generated']} cas générés, {len(d['failures'])} type(s) d'échec hors base de référence du socle")
PY
# Fidélité comportementale (pile indépendante) : une donnée valide selon le contrat refusée, ou une donnée
# invalide acceptée, signale un écart entre le contrat publié et la validation réelle. Informatif.
st run "$WORK/openapi.json" --url http://localhost:4000 -H "Authorization: Bearer $(cat "$WORK/admin.tok")" \
  --checks positive_data_acceptance,negative_data_rejection -n 20 --generation-deterministic --max-time 90 \
  --phases examples,coverage --report json --report-dir "$WORK/fid" --warnings off > "$WORK/fidelity.txt" 2>&1
python3 - "$WORK" <<'PY'
import json, glob, sys
f = sorted(glob.glob(sys.argv[1] + '/fid/*.json'))
d = json.load(open(f[-1])) if f else {'failures': []}
for fl in d['failures']:
    print(f"FIDELITY-WARN {fl['type']} ({fl['count']}): " + ', '.join(map(str, fl['operations'][:8])))
print(f"fidelity: {len(d['failures'])} type(s) d'écart contrat/validation (informatif)")
PY
if [ "$BREAK" -gt 0 ] || [ "$ST" -ne 0 ]; then echo "contract: BLOCKED (details in $WORK/schemathesis.txt)"; exit 1; fi
echo "contract: OK"
