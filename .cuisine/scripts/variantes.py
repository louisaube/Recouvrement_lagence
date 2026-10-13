#!/usr/bin/env python3
"""Variantes de l'API de test, déclarées par la QA dans `acceptance/variants.yaml`.

La recette est une boîte noire : l'API de test est un processus distinct, dont l'environnement est fixé au démarrage.
Quand une version exige plusieurs environnements (pilote factice pour les suites précédentes, doubles de test pour la
nouvelle, configuration absente), la QA déclare des variantes ; la cuisine démarre l'API dans chacune et y joue les
fichiers de recette qui lui reviennent.

Règles :
  - `api/.env.test` = variables actives de `api/.env.template` (valeurs locales conservées : base, secrets)
    + l'environnement de la variante par défaut, dans un bloc géré. `start.sh` seul donne donc la variante par défaut.
  - Une autre variante est démarrée avec ses variables en plus, qui priment ; une valeur vide retire la variable
    (l'API traite une variable vide comme absente).
  - Un fichier de recette tourne contre la variante dont un motif `files` le désigne, sinon contre la variante par défaut.
  - Les tests lisent l'environnement de l'API sous test dans le fichier désigné par ACCEPTANCE_ENV_FILE.
  - `generate` crée sur la machine des valeurs de test qui ne doivent pas être versionnées (clé RSA de test).

  variantes.py env                  réécrit api/.env.test (gabarit + variante par défaut)
  variantes.py run [options jest]   joue la recette variante par variante (appelé par acceptance.sh)
  variantes.py start <variante>     démarre l'API de test dans une variante ; affiche ACCEPTANCE_ENV_FILE
  variantes.py list [options jest]  répartition des fichiers de recette entre variantes

Codes de sortie de `run` : 0 vert, 1 échec, 124 bloqué (durée CUISINE_TEST_TIMEOUT dépassée par une variante),
2 déclaration invalide. Banc : .cuisine/tests/variantes/run.sh (CUISINE_JEST remplace `npx jest`)."""
import fnmatch, json, os, re, shlex, signal, subprocess, sys, tempfile, time, urllib.request
from collections import OrderedDict

import yaml

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
ACC = os.path.join(ROOT, 'acceptance')
DECL = os.path.join(ACC, 'variants.yaml')
API = os.path.join(ROOT, 'api')
ENV_TEST = os.path.join(API, '.env.test')
TEMPLATE = os.path.join(API, '.env.template')
WORK = os.path.join(ROOT, '.cuisine-run', 'variantes')
JEST = shlex.split(os.environ.get('CUISINE_JEST', 'npx jest'))
PORT = int(os.environ.get('CUISINE_VARIANTES_PORT', '4000'))  # banc : un port libre, aucune API à réutiliser
BEGIN = '# >>> variante par défaut de la recette (acceptance/variants.yaml), écrite par la cuisine : ne pas modifier'
END = '# <<< fin de la variante par défaut'
RESERVED = {'DATABASE_URL', 'JWT_SECRET', 'COOKIE_SECRET', 'PORT', 'NODE_ENV'}
NAME = re.compile(r'^[a-z][a-z0-9-]{0,30}$')
VAR = re.compile(r'^[A-Z][A-Z0-9_]*$')
LINE = re.compile(r'^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$')


class Invalid(Exception):
    pass


# ───────────────────────────── déclaration ─────────────────────────────

def scalar(v):
    if v is None:
        return ''
    if isinstance(v, bool):
        return 'true' if v else 'false'
    if isinstance(v, (int, float, str)):
        return str(v)
    raise Invalid(f'valeur non scalaire : {v!r}')


def load():
    """Lit et valide la déclaration ; renvoie (défaut, OrderedDict nom -> variante)."""
    try:
        d = yaml.safe_load(open(DECL, encoding='utf-8'))
    except yaml.YAMLError as e:
        raise Invalid(f'YAML illisible : {e}')
    if not isinstance(d, dict) or not isinstance(d.get('variants'), dict) or not d['variants']:
        raise Invalid('attendu : `default: <nom>` et `variants: {<nom>: {...}}`')
    default = d.get('default')
    if default not in d['variants']:
        raise Invalid(f'variante par défaut « {default} » non déclarée')
    out = OrderedDict()
    for name, v in d['variants'].items():
        v = v or {}
        if not isinstance(name, str) or not NAME.match(name):
            raise Invalid(f'nom de variante invalide : {name!r} (minuscules, chiffres, tirets)')
        unknown = set(v) - {'description', 'files', 'env', 'generate', 'jest_env'}
        if unknown:
            raise Invalid(f'{name} : clés inconnues {sorted(unknown)}')
        files = v.get('files') or []
        if name == default and files:
            raise Invalid(f'{name} : la variante par défaut reçoit les fichiers non désignés, elle ne déclare pas `files`')
        if name != default and not files:
            raise Invalid(f'{name} : `files` (motifs des fichiers de recette de cette variante) est obligatoire')
        if not isinstance(files, list) or not all(isinstance(f, str) and f.strip() for f in files):
            raise Invalid(f'{name} : `files` est une liste de motifs')
        env = OrderedDict()
        for k, val in (v.get('env') or {}).items():
            if not VAR.match(str(k)) or k in RESERVED:
                raise Invalid(f'{name} : variable interdite ou mal nommée : {k}')
            env[k] = scalar(val)
        generate = OrderedDict()
        for k, kind in (v.get('generate') or {}).items():
            if not VAR.match(str(k)) or k in RESERVED or k in env:
                raise Invalid(f'{name} : variable générée interdite, mal nommée ou déjà dans `env` : {k}')
            if kind not in GENERATORS:
                raise Invalid(f'{name} : générateur inconnu « {kind} » pour {k} (connus : {", ".join(GENERATORS)})')
            generate[k] = kind
        jest_env = OrderedDict((str(k), scalar(val)) for k, val in (v.get('jest_env') or {}).items())
        for k in jest_env:
            if not VAR.match(k) or k in RESERVED:
                raise Invalid(f'{name} : variable de Jest interdite ou mal nommée : {k}')
        out[name] = {'name': name, 'description': str(v.get('description') or '').strip(), 'files': files,
                     'env': env, 'generate': generate, 'jest_env': jest_env}
    return default, out


def rsa_private_key_pem(path):
    if not os.path.exists(path):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        js = ("const {generateKeyPairSync}=require('crypto');const {privateKey}=generateKeyPairSync('rsa',"
              "{modulusLength:2048,privateKeyEncoding:{type:'pkcs8',format:'pem'},publicKeyEncoding:{type:'spki',format:'pem'}});"
              "process.stdout.write(privateKey)")
        pem = subprocess.run(['node', '-e', js], capture_output=True, text=True, check=True).stdout
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, 'w') as fh:
            fh.write(pem)
    return open(path).read().strip().replace('\n', '\\n')  # retours à la ligne écrits \n


GENERATORS = {'rsa-private-key-pem': rsa_private_key_pem}


def resolved(v):
    """Variables de la variante, valeurs générées comprises (une valeur vide retire la variable)."""
    env = OrderedDict(v['env'])
    for k, kind in v['generate'].items():
        env[k] = GENERATORS[kind](os.path.join(WORK, 'cles', f'{v["name"]}-{k}.pem'))
    return env


def all_keys(variants, field):
    keys = set()
    for v in variants.values():
        keys |= set(v[field]) | (set(v['generate']) if field == 'env' else set())
    return keys


def assign(default, variants, files):
    """Variante de chaque fichier (chemin relatif à acceptance/) ; un fichier désigné par deux variantes est une erreur."""
    out = OrderedDict((n, []) for n in variants)
    for f in files:
        hits = [n for n, v in variants.items() if any(fnmatch.fnmatch(f, p) or fnmatch.fnmatch(os.path.basename(f), p) for p in v['files'])]
        if len(hits) > 1:
            raise Invalid(f'{f} est désigné par plusieurs variantes : {", ".join(hits)}')
        out[hits[0] if hits else default].append(f)
    return out


# ───────────────────────────── api/.env.test ─────────────────────────────

def parse_lines(text):
    return [(m.group(1) if (m := LINE.match(l)) and not l.lstrip().startswith('#') else None, l) for l in text.splitlines()]


def write_env_test(default, variants):
    """Réécrit api/.env.test : variables actives du gabarit (valeur locale conservée), puis la variante par défaut.
    Renvoie True si le fichier a changé."""
    if not os.path.exists(ENV_TEST):
        raise Invalid('api/.env.test absent : lancer `cuisine envs`')
    old = open(ENV_TEST, encoding='utf-8').read()
    template = [(k, l) for k, l in parse_lines(open(TEMPLATE, encoding='utf-8').read()) if k] if os.path.exists(TEMPLATE) else []
    current, inside = OrderedDict(), False
    for k, l in parse_lines(old):
        if l.startswith(BEGIN):
            inside = True
        elif l.startswith(END):
            inside = False
        elif k and not inside:
            current[k] = l
    managed = all_keys(variants, 'env')
    if template:  # base = variables actives du gabarit, valeur locale conservée (base de test, secrets)
        tkeys = {k for k, _ in template}
        base = [current.get(k, l) for k, l in template if k not in managed]
        dropped = [k for k in current if k not in tkeys]
    else:
        base = [l for k, l in current.items() if k not in managed]
        dropped = []
    v = variants[default]
    block = [BEGIN, f'# variante « {default} »' + (f' : {v["description"]}' if v['description'] else '')]
    block += [f'{k}={val}' for k, val in resolved(v).items() if val != '']
    block.append(END)
    new = '\n'.join(base + [''] + block) + '\n'
    if new == old:
        return False
    with open(ENV_TEST, 'w', encoding='utf-8') as fh:
        fh.write(new)
    gone = [k for k in dropped if k not in managed]
    print(f'api/.env.test réécrit (gabarit + variante par défaut « {default} »)'
          + (f' ; variables retirées, absentes du gabarit et des variantes : {", ".join(gone)}' if gone else ''), file=sys.stderr, flush=True)
    return True


def env_file_for(variant, overlay):
    """Fichier d'environnement de l'API sous test, pour les tests (ACCEPTANCE_ENV_FILE)."""
    os.makedirs(WORK, exist_ok=True)
    lines = [l for k, l in parse_lines(open(ENV_TEST, encoding='utf-8').read()) if k not in overlay]
    lines += [f'{k}={v}' for k, v in overlay.items() if v != '']
    path = os.path.join(WORK, f'{variant}.env')
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'w', encoding='utf-8') as fh:
        fh.write('\n'.join(lines) + '\n')
    return path


# ───────────────────────────── API de test ─────────────────────────────

def listening_pid():
    """Processus à l'écoute du port de l'API : lsof, fuser ou ss comme start.sh, sinon lecture directe de /proc."""
    for cmd, rx in ((['lsof', '-t', f'-iTCP:{PORT}', '-sTCP:LISTEN'], r'^(\d+)'), (['fuser', f'{PORT}/tcp'], r'(\d+)'),
                    (['ss', '-ltnpH', f'sport = :{PORT}'], r'pid=(\d+)')):
        try:
            r = subprocess.run(cmd, capture_output=True, text=True)
        except OSError:
            continue
        m = re.search(rx, r.stdout, re.M)
        if m:
            return int(m.group(1))
    inodes = set()
    for table in ('/proc/net/tcp', '/proc/net/tcp6'):
        try:
            for line in open(table).read().splitlines()[1:]:
                f = line.split()
                if f[1].rsplit(':', 1)[1] == f'{PORT:04X}' and f[3] == '0A':  # 0A : LISTEN
                    inodes.add(f[9])
        except (OSError, IndexError):
            continue
    for pid in filter(str.isdigit, os.listdir('/proc') if inodes else []):
        try:
            for fd in os.listdir(f'/proc/{pid}/fd'):
                if os.readlink(f'/proc/{pid}/fd/{fd}') in {f'socket:[{i}]' for i in inodes}:
                    return int(pid)
        except OSError:
            continue
    return None


def healthy():
    try:
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with opener.open(f'http://localhost:{PORT}/server/health-check', timeout=3) as r:
            return r.status == 200
    except Exception:
        return False


def running_matches(overlay, managed):
    """L'API qui tourne a-t-elle été démarrée avec exactement ces variables (lecture de /proc, Linux) ?"""
    pid = listening_pid()
    if not pid or not healthy():
        return False
    try:
        raw = open(f'/proc/{pid}/environ', 'rb').read().split(b'\0')
    except OSError:
        return False
    env = dict(e.decode('utf-8', 'replace').split('=', 1) for e in raw if b'=' in e)
    if env.get('NODE_ENV') != 'test':
        return False
    return all(env.get(k) == overlay.get(k) for k in managed | set(overlay))


def start_api(name, overlay, managed):
    """Démarre l'API de test (start.sh) avec les variables de la variante ; renvoie (ok, message)."""
    env = {k: v for k, v in os.environ.items() if k not in managed}
    env.update(overlay)
    env['NODE_ENV'] = 'test'
    t = time.time()
    r = subprocess.run(['bash', os.path.join('scripts', 'server', 'start.sh')], cwd=API, env=env, capture_output=True, text=True)
    if r.returncode == 0:
        print(f'[variantes] API de test démarrée dans la variante « {name} » ({time.time() - t:.0f} s)', file=sys.stderr, flush=True)
        return True, ''
    log = os.path.join(API, '.server-test.log')
    tail = open(log, encoding='utf-8', errors='replace').read().splitlines()[-25:] if os.path.exists(log) else []
    return False, '\n'.join([(r.stderr or r.stdout).strip(), *tail])


# ───────────────────────────── Jest ─────────────────────────────

def split_json_args(args):
    """Retire --json et --outputFile des options : le lanceur écrit lui-même un rapport par variante."""
    rest, want_json, out, i = [], False, None, 0
    while i < len(args):
        a = args[i]
        if a == '--json':
            want_json = True
        elif a.startswith('--outputFile='):
            out = a.split('=', 1)[1]
        elif a == '--outputFile' and i + 1 < len(args):
            out = args[i + 1]
            i += 1
        else:
            rest.append(a)
        i += 1
    return rest, want_json, out


def config_ignores():
    js = "process.stdout.write(JSON.stringify(require(require('path').resolve(process.argv[1])).testPathIgnorePatterns||['/node_modules/']))"
    try:
        return json.loads(subprocess.run(['node', '-e', js, 'jest.config.js'], cwd=ACC, capture_output=True, text=True, check=True).stdout)
    except (OSError, ValueError, subprocess.CalledProcessError):
        return ['/node_modules/']


def selected_files(args):
    r = subprocess.run(JEST + ['-c', 'jest.config.js', '--listTests', *args], cwd=ACC, capture_output=True, text=True)
    if r.returncode != 0:
        sys.stdout.write(r.stdout + r.stderr)
        raise SystemExit(r.returncode or 1)
    files = []
    for line in r.stdout.splitlines():
        p = line.strip()
        if p.endswith('.ts') and os.path.isabs(p) and os.path.exists(p):
            files.append(os.path.relpath(p, ACC))
    return sorted(set(files))


def run_jest(name, files, excluded, args, env_file, jest_env, jest_keys, budget):
    """Joue `files` (et eux seuls) ; renvoie (code, rapport JSON ou None)."""
    os.makedirs(WORK, exist_ok=True)
    out = os.path.join(WORK, f'{name}.json')
    if os.path.exists(out):
        os.remove(out)
    ignores = config_ignores() + ['/' + re.escape(f) + '$' for f in excluded]
    cmd = JEST + ['--runInBand', '-c', 'jest.config.js', *args, *[f'--testPathIgnorePatterns={p}' for p in ignores],
                  '--json', f'--outputFile={out}']
    env = {k: v for k, v in os.environ.items() if k not in jest_keys}
    env.update(jest_env)
    env['ACCEPTANCE_ENV_FILE'] = env_file
    print(f'\n[variantes] variante « {name} » : {len(files)} fichier(s) : {" ".join(files)}', file=sys.stderr, flush=True)
    p = subprocess.Popen(cmd, cwd=ACC, env=env, start_new_session=True)
    try:
        code = p.wait(timeout=budget)
    except subprocess.TimeoutExpired:
        for sig, wait in ((signal.SIGTERM, 10), (signal.SIGKILL, 5)):
            try:
                os.killpg(p.pid, sig)
            except ProcessLookupError:
                break
            try:
                p.wait(timeout=wait)
                break
            except subprocess.TimeoutExpired:
                continue
        print(f'BLOQUÉ : recette de la variante « {name} » arrêtée après {budget} s sans réponse ; ce n\'est pas un échec d\'assertion', file=sys.stderr, flush=True)
        code = 124
    try:
        report = json.load(open(out))
    except (OSError, ValueError):
        report = None
    return code, report


COUNTS = ('numFailedTestSuites', 'numPassedTestSuites', 'numPendingTestSuites', 'numRuntimeErrorTestSuites', 'numTotalTestSuites',
          'numFailedTests', 'numPassedTests', 'numPendingTests', 'numTodoTests', 'numTotalTests')


def merge(reports):
    merged = {k: 0 for k in COUNTS}
    merged.update({'success': True, 'testResults': [], 'startTime': None, 'variants': {}})
    for name, (code, r) in reports.items():
        merged['variants'][name] = {'exitCode': code, **({k: r.get(k, 0) for k in COUNTS} if r else {})}
        merged['success'] = merged['success'] and code == 0 and bool(r) and r.get('success', False)
        if not r:
            continue
        for k in COUNTS:
            merged[k] += r.get(k, 0) or 0
        merged['testResults'] += r.get('testResults', [])
        if r.get('startTime') and (merged['startTime'] is None or r['startTime'] < merged['startTime']):
            merged['startTime'] = r['startTime']
    return merged


def summary_line(r):
    parts = [f'{r[k]} {w}' for k, w in (('numFailedTests', 'failed'), ('numPendingTests', 'skipped'), ('numTodoTests', 'todo'),
                                         ('numPassedTests', 'passed')) if r.get(k)]
    return ', '.join(parts + [f'{r.get("numTotalTests", 0)} total'])


def suites_line(r):
    parts = [f'{r[k]} {w}' for k, w in (('numFailedTestSuites', 'failed'), ('numPendingTestSuites', 'skipped'),
                                         ('numPassedTestSuites', 'passed')) if r.get(k)]
    return ', '.join(parts + [f'{r.get("numTotalTestSuites", 0)} total'])


# ───────────────────────────── commandes ─────────────────────────────

def cmd_run(args):
    default, variants = load()
    rest, want_json, user_out = split_json_args(args)
    env_changed = write_env_test(default, variants)
    files = selected_files(rest)
    if not files:
        print('Aucun fichier de recette ne correspond aux options données.', file=sys.stderr)
        return 1
    plan = assign(default, variants, files)
    order = [n for n in variants if n != default and plan[n]] + ([default] if plan[default] else [])
    managed, jest_keys = all_keys(variants, 'env'), all_keys(variants, 'jest_env')
    budget = int(os.environ.get('CUISINE_TEST_TIMEOUT', '900'))
    print('[variantes] ' + ' ; '.join(f'{n} : {len(plan[n])} fichier(s)' for n in order), file=sys.stderr, flush=True)
    reports, current = OrderedDict(), None
    for name in order:
        v = variants[name]
        overlay = {} if name == default else resolved(v)
        if env_changed or not running_matches(overlay, managed):
            ok, msg = start_api(name, overlay, managed)
            env_changed = False
            if not ok:
                print(f'[variantes] ÉCHEC : l\'API de test ne démarre pas dans la variante « {name} » ; ses fichiers ne sont pas joués.\n{msg}', file=sys.stderr, flush=True)
                reports[name] = (1, None)
                current = None
                continue
        else:
            print(f'[variantes] API de test déjà dans la variante « {name} »', file=sys.stderr, flush=True)
        current = name
        env_file = ENV_TEST if name == default else env_file_for(name, overlay)
        excluded = [f for f in files if f not in plan[name]]
        reports[name] = run_jest(name, plan[name], excluded, rest, env_file, v['jest_env'], jest_keys, budget)
    if current != default:
        ok, msg = start_api(default, {}, managed)
        if not ok:
            print(f'[variantes] ATTENTION : l\'API de test ne redémarre pas dans la variante par défaut.\n{msg}', file=sys.stderr, flush=True)
    merged = merge(reports)
    lines = ['', 'Recette par variante de l\'API de test (acceptance/variants.yaml) :']
    for name, (code, r) in reports.items():
        state = 'BLOQUÉE' if code == 124 else ('API non démarrée' if r is None and code else '')
        lines.append(f'  {name} ({len(plan[name])} fichier(s)) : ' + (state or summary_line(r)))
    lines += [f'Test Suites: {suites_line(merged)}', f'Tests:       {summary_line(merged)}']
    print('\n'.join(lines), file=sys.stderr, flush=True)
    if user_out:
        with open(user_out if os.path.isabs(user_out) else os.path.join(ACC, user_out), 'w') as fh:  # comme Jest, lancé depuis acceptance/
            json.dump(merged, fh)
    elif want_json:
        sys.stdout.write(json.dumps(merged) + '\n')
    codes = [c for c, _ in reports.values()]
    return 124 if 124 in codes else (0 if all(c == 0 for c in codes) else 1)


def cmd_start(args):
    default, variants = load()
    if not args or args[0] not in variants:
        print(f'Usage : variantes.py start <variante>   (déclarées : {", ".join(variants)} ; par défaut : {default})')
        return 2
    name = args[0]
    write_env_test(default, variants)
    overlay = {} if name == default else resolved(variants[name])
    ok, msg = start_api(name, overlay, all_keys(variants, 'env'))
    if not ok:
        print(msg)
        return 1
    env_file = ENV_TEST if name == default else env_file_for(name, overlay)
    jest_env = ' '.join(f'{k}={shlex.quote(v)}' for k, v in variants[name]['jest_env'].items())
    print(f'Pour jouer un fichier contre cette API : cd acceptance && ACCEPTANCE_ENV_FILE={env_file} {jest_env + " " if jest_env else ""}npx jest --runInBand <fichier>')
    print('Plus simple : bash .cuisine/scripts/acceptance.sh <fichier> démarre lui-même la bonne variante.')
    return 0


def cmd_list(args):
    default, variants = load()
    rest, _, _ = split_json_args(args)
    plan = assign(default, variants, selected_files(rest))
    for name, v in variants.items():
        print(f'{name}{" (défaut)" if name == default else ""} : {v["description"]}')
        for f in plan[name]:
            print(f'    {f}')
    return 0


def cmd_env(_args):
    default, variants = load()
    if not write_env_test(default, variants):
        print(f'api/.env.test à jour (variante par défaut « {default} »)')
    return 0


def main():
    if len(sys.argv) < 2 or sys.argv[1] not in ('run', 'start', 'list', 'env'):
        print(__doc__)
        return 2
    if not os.path.exists(DECL):
        print('acceptance/variants.yaml absent : une seule API de test, celle de start.sh')
        return 0 if sys.argv[1] in ('env', 'list') else 2
    try:
        return {'run': cmd_run, 'start': cmd_start, 'list': cmd_list, 'env': cmd_env}[sys.argv[1]](sys.argv[2:])
    except Invalid as e:
        print(f'acceptance/variants.yaml : {e}', file=sys.stderr)
        return 2
    except (OSError, subprocess.CalledProcessError) as e:
        print(f'[variantes] erreur : {e}', file=sys.stderr)
        return 2


if __name__ == '__main__':
    sys.exit(main())
