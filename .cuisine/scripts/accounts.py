#!/usr/bin/env python3
"""Comptes de la cuisine, indépendants du socle : création par SQL selon le contrat de données
(specifications/data-contract.md) et connexion par l'API.
  accounts.py user  <role> <email> <password> [--env development|test]   crée ou réutilise un compte
  accounts.py token <role> [--env test]                                   crée un compte jetable et imprime son jeton
"""
import json, os, secrets, subprocess, sys, urllib.request

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
API_URL = os.environ.get('API_URL', 'http://localhost:4000')


def database_url(env):
    slug = json.load(open(os.path.join(ROOT, 'package.json')))['name']
    db = slug if env == 'development' else f'{slug}_test'
    return os.environ.get('CUISINE_DATABASE_URL', f'postgres://database:database@localhost:5432/{db}')


def psql(url, query, *params):
    # paramètres passés par variables psql, jamais concaténés
    args = ['psql', url, '-tA', '-v', 'ON_ERROR_STOP=1']
    for i, p in enumerate(params):
        args += ['-v', f'p{i}={p}']
    r = subprocess.run(args, input=query, capture_output=True, text=True)
    if r.returncode:
        raise SystemExit(r.stderr.strip())
    return r.stdout.strip()


def ensure_user(role, email, password, env):
    import bcrypt
    url = database_url(env)
    uid = psql(url, "select id from base.users where email = :'p0';", email)
    if not uid:
        uid = psql(url, "insert into base.users (email, role) values (:'p0', :'p1') returning id;", email, role).splitlines()[0]
        h = bcrypt.hashpw(password.encode(), bcrypt.gensalt(10)).decode()
        psql(url, "insert into base.credentials (user_id, password, type) values (:'p0', :'p1', 'token');", uid, h)
    return uid


def login(email, password):
    req = urllib.request.Request(f'{API_URL}/auth/login', method='POST', headers={'content-type': 'application/json'},
                                 data=json.dumps({'email': email, 'password': password, 'returnToken': True}).encode())
    with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(req, timeout=20) as r:
        return json.load(r)['token']


def main():
    a = sys.argv[1:]
    env = a[a.index('--env') + 1] if '--env' in a else None
    a = [x for i, x in enumerate(a) if x != '--env' and (i == 0 or a[i - 1] != '--env')]
    if a[:1] == ['user']:
        ensure_user(a[1], a[2], a[3], env or 'development'); print(a[2])
    elif a[:1] == ['token']:
        email, pw = f'probe-{a[1]}-{secrets.token_hex(6)}@probe.test', 'Probe-' + secrets.token_hex(8)
        ensure_user(a[1], email, pw, env or 'test'); print(login(email, pw))
    else:
        print(__doc__); sys.exit(2)


main()
