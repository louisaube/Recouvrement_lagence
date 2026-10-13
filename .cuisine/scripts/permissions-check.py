#!/usr/bin/env python3
"""Foundation (frozen). Three-source permission check, no LLM.

expected  = specifications/permissions.yaml (+ .cuisine/permissions-foundation.yaml)
declared  = what the code declares, from the socle's tooling contract: `pnpm --dir api cuisine:routes <out.json>`
observed  = HTTP probe of the running API per role, done here, independently of the socle

Blocking: any divergence between the three sources, an undecorated route, a route with both
@PublicApi and @Auth, a 5xx during the probe, an 'own' operation without passing cross-owner tests.
Warning: operations marked status: to-arbitrate.
Usage: permissions-check.py <work_dir> [--report path]   (run from the repository root, API running)
"""
import json, os, re, subprocess, sys, yaml

ROOT = os.getcwd()
WORK = sys.argv[1]
REPORT = sys.argv[sys.argv.index('--report') + 1] if '--report' in sys.argv else None
os.makedirs(WORK, exist_ok=True)

def run(cmd, cwd):
    r = subprocess.run(cmd, shell=True, cwd=cwd, capture_output=True, text=True)
    if r.returncode != 0:
        print(r.stdout[-2000:], r.stderr[-2000:]); sys.exit(2)

spec = yaml.safe_load(open('specifications/permissions.yaml'))
found = yaml.safe_load(open('.cuisine/permissions-foundation.yaml'))
test_only = tuple(found.get('test_only_prefixes', []))
expected = {}
for src, doc in (('foundation', found), ('spec', spec)):
    for op in doc['operations']:
        expected[(op['method'].upper(), op['path'])] = dict(op, source=src)

# Reconstruction par lots : seules les opérations des lots déjà fabriqués sont attendues.
lot_env = os.path.join(ROOT, '.cuisine-run', 'lot.env')
if os.path.exists(lot_env):
    m = re.search(r'CONTRACT_PATHS="([^"]*)"', open(lot_env).read())
    lot_paths = set(m.group(1).split()) if m else set()
    to_oas = lambda p: re.sub(r':([A-Za-z_]+)', r'{\1}', p)
    # une entrée est un chemin entier (`/users`) ou une seule opération (`POST:/users`)
    expected = {k: v for k, v in expected.items() if to_oas(k[1]) in lot_paths or f'{k[0]}:{to_oas(k[1])}' in lot_paths}

api = os.path.join(ROOT, 'api')
declared_path = os.path.join(WORK, 'declared.json')
run(f'NODE_ENV=test pnpm -s cuisine:routes {declared_path}', api)
declared = {(r['method'], r['path']): r for r in json.load(open(declared_path))}
routes = sorted(set(declared) | set(expected), key=lambda k: (k[1], k[0]))
routes = [k for k in routes if not k[1].startswith(test_only)]
routes_path = os.path.join(WORK, 'routes.json')
json.dump([{'method': m, 'path': p} for m, p in routes], open(routes_path, 'w'))
observed_path = os.path.join(WORK, 'observed.json')

def probe(routes):
    # Guards run before validation: an empty body or an unknown id answers 400/404 once
    # authorization is passed, and 401/403 when it is not.
    import urllib.request, urllib.error
    # A redirect is an observed status (3xx is neither a denial nor an error): never follow it, the target may
    # be the studio or an identity provider that is not running during the gate.
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            return None
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    acc = os.path.join(ROOT, '.cuisine', 'scripts', 'accounts.py')
    tokens = {'anonymous': None}
    for role in ('user', 'admin'):
        tokens[role] = subprocess.run([sys.executable, acc, 'token', role], capture_output=True, text=True, check=True).stdout.strip()
    api_url = os.environ.get('API_URL', 'http://localhost:4000')
    out = []
    for method, path in routes:
        url = api_url + re.sub(r':[A-Za-z_]+', '00000000-0000-4000-8000-000000000000', path)
        statuses = {}
        for role, tok in tokens.items():
            body = b'{}' if method in ('POST', 'PUT', 'PATCH') else None
            headers = {'content-type': 'application/json'} if body else {}
            if tok: headers['authorization'] = f'Bearer {tok}'
            try:
                with opener.open(urllib.request.Request(url, data=body, method=method, headers=headers), timeout=30) as r:
                    statuses[role] = r.status
            except urllib.error.HTTPError as e:
                statuses[role] = e.code
        allow = sorted(k for k, v in statuses.items() if v not in (401, 403) and v < 500)
        errors = [k for k, v in statuses.items() if v >= 500]
        out.append({'method': method, 'path': path, 'statuses': statuses, 'allow': allow, 'errors': errors})
    return out

json.dump(probe(routes), open(observed_path, 'w'), indent=1)
observed = {(r['method'], r['path']): r for r in json.load(open(observed_path))}

def fmt(a):
    return '-' if a is None else ','.join(sorted(a)) if a else 'personne'

# Cross-owner tests: titles must exist and pass.
titles = sorted({t for op in expected.values() for t in (op.get('cross_owner_tests') or [])})
passed = set()
if titles:
    pattern = '|'.join(re.escape(t) for t in titles)
    out = os.path.join(WORK, 'cross-owner.json')
    subprocess.run(f"npx jest --runInBand -c jest.config.js --json --outputFile={out} -t '{pattern}'",
                   shell=True, cwd=os.path.join(ROOT, 'acceptance'), capture_output=True, text=True)
    try:
        res = json.load(open(out))
        for f in res['testResults']:
            for a in f['assertionResults']:
                if a['status'] == 'passed':
                    for t in titles:
                        if t in a['fullName']:
                            passed.add(t)
    except Exception as e:
        print('cross-owner run unreadable:', e)

rows, blocking, warnings, ok = [], 0, 0, 0
for key in routes:
    e, d, o = expected.get(key), declared.get(key), observed.get(key)
    E = e['allow'] if e else None
    D = d['allow'] if d else None
    O = o['allow'] if o else None
    issues, warn = [], []
    if e is None: issues.append('route non spécifiée')
    if d is None: issues.append('route attendue absente du code')
    if d and d['regime'] == 'undecorated': issues.append('aucun décorateur : ouverte en production')
    if d and d['regime'] == 'conflict': issues.append('@PublicApi et @Auth à la fois')
    custom = bool(d and d['regime'] == 'auth+custom')
    if custom: warn.append('garde métier (' + ','.join(d.get('customGuards', [])) + ') : la matrice observée fait foi')
    if e and d and not custom and sorted(E or []) != sorted(D or []): issues.append('déclarée différente de l\'attendue')
    # With a business guard the declaration is an upper bound: the observed set may be narrower, never wider.
    if d and o and D is not None and (not set(O) <= set(D) if custom else sorted(D) != sorted(O)): issues.append('observée différente de la déclarée')
    if e and o and sorted(E) != sorted(O): issues.append('observée différente de l\'attendue')
    if o and o['errors']: issues.append('erreur 5xx pour ' + ','.join(o['errors']))
    if e and d and e.get('action') and e['action'] != d.get('action'): issues.append(f"action {d.get('action')} au lieu de {e['action']}")
    if e and e.get('ownership') == 'own':
        tests = e.get('cross_owner_tests') or []
        missing = [t for t in tests if t not in passed]
        if not tests: issues.append('propriété : aucun test « ressource d\'autrui »')
        elif missing: issues.append(f'propriété : {len(missing)} test(s) « ressource d\'autrui » absents ou rouges')
    if e and e.get('status') == 'to-arbitrate': warn.append('à arbitrer : ' + e.get('note', ''))
    status = 'BLOQUANT' if issues else ('ALERTE' if warn else 'conforme')
    blocking += bool(issues); warnings += bool(warn and not issues); ok += not issues
    statuses = ' '.join(f"{ {'anonymous':'anon','user':'user','admin':'admin'}[k]}={v}" for k, v in (o['statuses'].items() if o else []))
    rows.append(f"| {key[0]} {key[1]} | {fmt(E)} | {fmt(D)} | {fmt(O)} | {statuses} | {status} | {'; '.join(issues + warn)} |")

report = ['| Route | Attendue | Déclarée | Observée | Statuts HTTP | Verdict | Détail |', '|---|---|---|---|---|---|---|'] + rows
summary = f'permissions: {ok}/{len(routes)} routes conformes, {blocking} bloquante(s), {warnings} alerte(s)'
text = '\n'.join(report + ['', summary])
if REPORT:
    open(REPORT, 'w').write(text + '\n')
print(text)
sys.exit(1 if blocking else 0)
