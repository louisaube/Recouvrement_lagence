#!/usr/bin/env python3
"""Recette simulée du banc : lit les tests (it/test), garde ceux que -t désigne, et juge chaque attendu de statut
(toBe, toBeGreaterThanOrEqual, toBeLessThan) contre la réponse de la route citée.
Réponse : avec API_URL (mandataire du contre-exemple), une vraie requête HTTP ; sinon l'application simulée, dont le
code de chaque route est écrit par l'agent simulé dans api/src/<route>.status (absent : 404).
Écrit un rapport au format JSON de Jest si --outputFile est donné. Code 0 si tous les tests joués passent."""
import json, os, re, sys, urllib.request

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
args = sys.argv[1:]
out, pattern, files = None, None, []
i = 0
while i < len(args):
    a = args[i]
    if a.startswith('--outputFile='):
        out = a.split('=', 1)[1]
    elif a == '-t':
        pattern = args[i + 1]; i += 1
    elif a.startswith('-'):
        pass
    else:
        files.append(a)
    i += 1
TEST = re.compile(r'''^\s*(?:it|test)\(\s*(['"`])(.*?)\1''', re.M)


def status_of(route):
    if os.environ.get('API_URL'):
        try:
            with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(os.environ['API_URL'] + route, timeout=10) as r:
                return r.status
        except urllib.error.HTTPError as e:
            return e.code
        except Exception:
            return 0
    p = os.path.join(ROOT, 'api', 'src', route.strip('/').replace('/', '-') + '.status')
    return int(open(p).read().strip()) if os.path.exists(p) else 404


import glob
files = files or sorted(os.path.relpath(f, os.path.join(ROOT, 'acceptance')) for f in glob.glob(os.path.join(ROOT, 'acceptance', '**', '*.test.ts'), recursive=True))
results, failed = [], 0
for f in files:  # blocage : un test choisi marqué bloque-sans-fin arrête tout le lot sans rapport (comme le délai de acceptance.sh)
    text = open(f if os.path.isabs(f) else os.path.join(ROOT, 'acceptance', f), encoding='utf-8').read()
    ms = list(TEST.finditer(text))
    for k, m in enumerate(ms):
        if (not pattern or re.search(pattern, m.group(2))) and 'bloque-sans-fin' in text[m.start(): ms[k + 1].start() if k + 1 < len(ms) else len(text)]:
            print("BLOQUÉ : recette arrêtée après le délai"); sys.exit(124)
for f in files:
    path = f if os.path.isabs(f) else os.path.join(ROOT, 'acceptance', f)
    text = open(path, encoding='utf-8').read()
    ms = list(TEST.finditer(text))
    for k, m in enumerate(ms):
        title = m.group(2)
        if pattern and not re.search(pattern, title):
            continue
        body = text[m.start(): ms[k + 1].start() if k + 1 < len(ms) else len(text)]
        route = (re.findall(r"'(/banc/[a-z0-9/]+)'", body) or ['/banc/ping'])[0]
        st = status_of(route)
        ok = True
        for name, n in re.findall(r'\.(toBe|toBeGreaterThanOrEqual|toBeLessThan)\((\d{3})\)', body):
            n = int(n)
            ok &= {'toBe': st == n, 'toBeGreaterThanOrEqual': st >= n, 'toBeLessThan': st < n}[name]
        if 'mise-en-place-cassee' in body:  # le harnais lève avant tout attendu (comme un déclencheur de base refusant le vidage)
            results.append({'title': title, 'status': 'failed', 'failureDetails': [{}], 'failureMessages': ['error: harnais']}); failed += 1
            continue
        results.append({'title': title, 'status': 'passed' if ok else 'failed',
                        'failureDetails': [] if ok else [{'matcherResult': {'pass': False}}], 'failureMessages': [] if ok else ['expect']})
        failed += not ok
if out:
    json.dump({'testResults': [{'assertionResults': results}]}, open(out, 'w'))
print(f'Tests:       {len(results) - failed} passed, {failed} failed, {len(results)} total')
sys.exit(1 if failed else 0)
