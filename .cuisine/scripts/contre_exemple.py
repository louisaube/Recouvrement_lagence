#!/usr/bin/env python3
"""Contre-exemple obligatoire d'un test relâché : même relâché, il doit encore refuser une réponse fausse.

  contre_exemple.py <relaches.json>   pour chaque test relâché et admis, rejoue le test à travers un mandataire qui
                                      transmet tout à l'API de test, sauf la route visée, à laquelle il répond par la
                                      réponse fausse ; le test doit alors échouer. Code 1 si un test l'accepte.

Réponse fausse : annotation dans le corps du test, `// contre-exemple : <MÉTHODE> <chemin> <statut> [<corps JSON>]`,
sinon un 500 `api.unknown_error` sur chaque chemin littéral du test (hors connexion et point de santé).
"""
import http.server, json, os, re, socket, subprocess, sys, tempfile, threading, urllib.request

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
os.chdir(ROOT)
API = os.environ.get('API_URL', 'http://localhost:4000')
DEFAULT_BODY = {'status': 500, 'code': 'api.unknown_error', 'message': 'Unexpected error'}
ANNOT = re.compile(r'//\s*contre-exemple\s*:\s*(GET|POST|PUT|PATCH|DELETE)\s+(\S+)\s+(\d{3})\s*(\{.*\})?', re.I)
PATHS = re.compile(r'''['"`](/[a-z][a-zA-Z0-9/_{}\-]*)''')
SKIP = ('/auth/login', '/server/health-check', '/api-json')


def overrides(body):
    found = [(m.group(1).upper(), m.group(2), int(m.group(3)), json.loads(m.group(4)) if m.group(4) else DEFAULT_BODY)
             for m in ANNOT.finditer(body)]
    if found:
        return found
    return [(None, p, 500, DEFAULT_BODY) for p in sorted(set(PATHS.findall(body))) if not p.startswith(SKIP)]


def matches(rule_path, path):
    rx = '^' + re.sub(r'\\\{[^}]+\\\}|:[A-Za-z_]+', '[^/]+', re.escape(rule_path)) + r'(\?.*)?$'
    return re.match(rx, path) is not None


def proxy(rules):
    class H(http.server.BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def handle_any(self):
            n = int(self.headers.get('content-length') or 0)
            data = self.rfile.read(n) if n else None
            for method, p, status, body in rules:
                if (method is None or method == self.command) and matches(p, self.path):
                    raw = json.dumps(body).encode()
                    self.send_response(status)
                    self.send_header('content-type', 'application/json'); self.send_header('content-length', str(len(raw)))
                    self.end_headers(); self.wfile.write(raw)
                    return
            req = urllib.request.Request(API + self.path, data=data, method=self.command,
                                         headers={k: v for k, v in self.headers.items() if k.lower() not in ('host', 'content-length')})
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
            try:
                with opener.open(req, timeout=30) as r:
                    status, headers, raw = r.status, r.headers.items(), r.read()
            except urllib.error.HTTPError as e:
                status, headers, raw = e.code, e.headers.items(), e.read()
            self.send_response(status)
            for k, v in headers:
                if k.lower() not in ('transfer-encoding', 'connection', 'content-length'):
                    self.send_header(k, v)
            self.send_header('content-length', str(len(raw))); self.end_headers(); self.wfile.write(raw)
        do_GET = do_POST = do_PUT = do_PATCH = do_DELETE = handle_any

    s = socket.socket(); s.bind(('127.0.0.1', 0)); port = s.getsockname()[1]; s.close()
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', port), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, f'http://127.0.0.1:{port}'


def run_one(item):
    rules = overrides(item['new'])
    if not rules:
        return f'{item["title"][:80]} : aucune route visée, contre-exemple impossible'
    srv, url = proxy(rules)
    out = tempfile.NamedTemporaryFile(suffix='.json', delete=False).name
    try:
        if item['file'].startswith('acceptance/'):
            cmd = ['bash', '.cuisine/scripts/acceptance.sh', '--json', f'--outputFile={out}', '-t', re.escape(item['title']), item['file'].removeprefix('acceptance/')]
        else:
            cmd = ['bash', '-c', f'cd api && NODE_ENV=test npx jest --runInBand --json --outputFile={out} -t {json.dumps(re.escape(item["title"]))} {item["file"].removeprefix("api/")}']
        subprocess.run(cmd, capture_output=True, text=True, env={**os.environ, 'API_URL': url, 'CUISINE_API_URL': url})
        data = json.load(open(out))
        st = [a['status'] for f in data.get('testResults', []) for a in f.get('assertionResults', []) if a.get('title') == item['title']]
    except (OSError, ValueError):
        st = []
    finally:
        srv.shutdown()
    if not st:
        return f'{item["title"][:80]} : contre-exemple non joué'
    if 'passed' in st:
        desc = ', '.join(f'{m or "toute méthode"} {p} répond {s}' for m, p, s, _ in rules)
        return f'{item["title"][:80]} : relâché au point d\'accepter une réponse fausse ({desc})'
    return None


def main():
    items = json.load(open(sys.argv[1])) if len(sys.argv) > 1 else []
    faults = [x for x in (run_one(i) for i in items) if x]
    for x in faults:
        print('CONTRE-EXEMPLE', x)
    print(f'contre-exemple: {len(items) - len(faults)}/{len(items)} test(s) relâché(s) refusent encore une réponse fausse')
    return 1 if faults else 0


if __name__ == '__main__':
    sys.exit(main())
