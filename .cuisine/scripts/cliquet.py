#!/usr/bin/env python3
"""Cliquet de la recette : une recette ne recule jamais sans raison écrite. Script sans modèle.

  cliquet.py <git-ref>                              compare les tests à <git-ref> (sceau, base de version) avec l'arbre de travail
  cliquet.py --lister <git-ref>                     liste les reculs refusés, sans contre-exemple (cuisine accorde)
  cliquet.py --accorder <git-ref> <version> <motif> inscrit l'accord du propriétaire pour chacun de ces reculs

Refusé, test par test (titre identique) et règle par règle (identifiants `rule-…` des titres) :
  - la suppression d'un test ;
  - la baisse du nombre de tests ou d'assertions (`expect(`) d'une règle ;
  - le relâchement d'un attendu : égalité stricte remplacée par une inclusion (toEqual, toStrictEqual, toBe vers
    toMatchObject, toContain, arrayContaining, objectContaining, toBeTruthy, toBeDefined, comparaison de statut),
    code d'erreur précis disparu, statut HTTP précis disparu.
Après le premier passage de code-back (marque .cuisine-run/<version>.code), seule une décision D-xxxx justifie un
relâchement ou une suppression ; avant, une contestation ACCEPTED qui nomme le test suffit aussi.
Tout relâchement admis doit encore refuser une réponse fausse (contre_exemple.py) ; sa version d'origine est rejouée
dans les portes finales (echantillon_b.py) et l'écart inscrit au résumé de version.
Admis si le changement est justifié : il introduit la citation d'une décision `D-xxxx` (une décision déjà citée ne
suffit pas), la décision qu'il portait a été révisée, ou une contestation `ACCEPTED` d'un DISPUTES.md cite le titre
du test (au moins ses 40 premiers caractères).
Accord du propriétaire : quand la demande d'une version change elle-même un comportement antérieur, le recul de ses tests
n'a pas de décision D-xxxx à citer. Le propriétaire l'accorde alors test par test (`cuisine accorde`) dans
specifications/accords-cliquet.yaml ; seul compte l'état de ce fichier à son dernier commit « proprietaire » (aucun
agent ne commite sous ce nom), ce qu'un agent y écrirait ensuite reste sans effet. Un relâchement accordé reste soumis
au contre-exemple et à l'échantillon B.
Fichiers : acceptance/**/*.ts et api/src/**/tests/**/*.ts.
"""
import datetime, glob, json, os, re, subprocess, sys
from collections import Counter, defaultdict

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
os.chdir(ROOT)
TEST_START = re.compile(r'''^\s*(?:it|test)(?:\.\w+)?\(\s*(['"`])(.*?)\1''', re.M)
# égalité stricte « pure » : un toEqual(expect.arrayContaining(…)) est une inclusion déguisée
STRICT = re.compile(r'\.(?:toEqual|toStrictEqual|toBe)\((?!\s*expect\.)')
LAX = re.compile(r'\.(?:toMatchObject|toContain|toContainEqual|toBeTruthy|toBeDefined|toBeGreaterThanOrEqual|toBeGreaterThan|toBeLessThan|toBeLessThanOrEqual)\(|'
                 r'expect\.(?:arrayContaining|objectContaining|anything|any)\(|\.not\.toBe\(')
CODE = re.compile(r'''['"`]([a-z]+(?:\.[a-z_]+)+)['"`]''')
STATUS = re.compile(r'''(?:toBe|toEqual|status\)?\s*===?)\(?\s*([1-5]\d\d)\b''')
RULE = re.compile(r'rule-[a-z0-9]+(?:-[a-z0-9]+)+')
ACCORDS = 'specifications/accords-cliquet.yaml'
OWNER_EMAIL = 'proprietaire@local'


def is_test_file(f):
    return f.endswith(('.ts', '.tsx')) and 'node_modules' not in f and (f.startswith('acceptance/') or ('/tests/' in f and f.startswith('api/src/')))


def parse(text):
    starts = list(TEST_START.finditer(text))
    out = {}
    for i, m in enumerate(starts):
        end = starts[i + 1].start() if i + 1 < len(starts) else len(text)
        out[m.group(2)] = text[m.start():end]
    return out


def tests_at(ref):
    files = subprocess.run(['git', 'ls-tree', '-r', '--name-only', ref], capture_output=True, text=True).stdout.split()
    out = {}
    for f in filter(is_test_file, files):
        text = subprocess.run(['git', 'show', f'{ref}:{f}'], capture_output=True, text=True).stdout
        for t, b in parse(text).items():
            out[(f, t)] = b
    return out


def tests_now():
    out = {}
    for f in glob.glob('acceptance/**/*.ts*', recursive=True) + glob.glob('api/src/**/tests/**/*.ts', recursive=True):
        if is_test_file(f):
            for t, b in parse(open(f, encoding='utf-8', errors='replace').read()).items():
                out[(f, t)] = b
    return out


def accepted_lines():
    lines = []
    for f in glob.glob('specifications/**/DISPUTES.md', recursive=True):
        lines += [l for l in open(f, encoding='utf-8', errors='replace') if l.startswith('ACCEPTED')]
    return lines


def revised_decisions():
    import yaml
    out = set()
    for f in glob.glob('specifications/*/arbitrages.yaml'):
        out |= {d['decision'] for d in yaml.safe_load(open(f)) or [] if d.get('statut') == 'revisee'}
    return out


def granted_titles():
    """Titres dont le propriétaire a accordé le recul : le fichier des accords tel que l'a laissé son dernier commit
    « proprietaire » ; une écriture postérieure (arbre de travail, commit d'un agent) n'a aucun effet."""
    import yaml
    sha = subprocess.run(['git', 'log', '-1', f'--author={OWNER_EMAIL}', '--format=%H', '--', ACCORDS],
                         capture_output=True, text=True).stdout.strip()
    if not sha:
        return set()
    text = subprocess.run(['git', 'show', f'{sha}:{ACCORDS}'], capture_output=True, text=True).stdout
    try:
        data = yaml.safe_load(text) or []
    except yaml.YAMLError:
        return set()
    return {e['titre'] for e in data if isinstance(e, dict) and isinstance(e.get('titre'), str)}


def code_started():
    """Vrai dès que code-back a fini un premier passage pour la version en cours (marque posée par check-back)."""
    try:
        v = open('.cuisine-run/version').read().strip()
    except OSError:
        return False
    return os.path.exists(f'.cuisine-run/{v}.code')


def justified(title, old, new, accepted, revised):
    """Le changement cite une raison : un accord du propriétaire sur ce test, une décision qu'il n'invoquait pas
    encore, la révision de la décision qu'il portait, ou une contestation ACCEPTED qui nomme le test. Un titre [D-xxxx]
    déjà présent ne vaut pas blanc-seing."""
    if title in GRANTED:
        return True
    before = set(re.findall(r'\bD-\d{4}\b', title + (old or '')))
    after = set(re.findall(r'\bD-\d{4}\b', title + (new or '')))
    if after - before:
        return True
    if before & revised:
        return True
    if POST_CODE:
        return False  # le code existe : une contestation ACCEPTED ne suffit plus, il faut une décision D-xxxx
    key = title[:40]
    return any(key in l for l in accepted)


POST_CODE = False
GRANTED = set()


def relaxations(old, new):
    out = []
    if len(STRICT.findall(new)) < len(STRICT.findall(old)) and len(LAX.findall(new)) > len(LAX.findall(old)):
        out.append('égalité stricte remplacée par une inclusion ou une comparaison')
    lost_codes = set(CODE.findall(old)) - set(CODE.findall(new))
    lost_codes = {c for c in lost_codes if '.' in c and not c.startswith(('www.', 'example.'))}
    if lost_codes:
        out.append('code(s) d\'erreur précis disparu(s) : ' + ', '.join(sorted(lost_codes)))
    lost_status = set(STATUS.findall(old)) - set(STATUS.findall(new))
    if lost_status:
        out.append('statut(s) HTTP précis disparu(s) : ' + ', '.join(sorted(lost_status)))
    return out


def moved_from(f, title, now):
    """Fichier actuel d'un test (il a pu changer de fichier)."""
    if (f, title) in now:
        return None
    return next((k[0] for k in now if k[1] == title), None)


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    global POST_CODE, GRANTED
    mode = 'gate'
    if sys.argv[1] in ('--lister', '--accorder'):
        mode = sys.argv[1][2:]
        if len(sys.argv) < (3 if mode == 'lister' else 5):
            print(__doc__)
            return 2
        ref = sys.argv[2]
    else:
        ref = sys.argv[1]
    POST_CODE = code_started()
    GRANTED = granted_titles()
    refused = []  # reculs refusés, test par test : ce que le propriétaire peut accorder
    before, now, accepted, revised = tests_at(ref), tests_now(), accepted_lines(), revised_decisions()
    admitted = []  # relâchements justifiés : soumis au contre-exemple, puis à l'échantillon B
    faults = []
    touched_unjustified = defaultdict(list)  # règle -> tests changés sans justification
    for key, old in before.items():
        f, title = key
        new = now.get(key)
        if new is None:
            moved = [k for k in now if k[1] == title]
            if moved:
                new = now[moved[0]]
            elif not justified(title, old, '', accepted, revised):
                faults.append(f'{f} : test supprimé sans décision ni contestation acceptée : « {title[:100]} »')
                refused.append({'fichier': f, 'titre': title, 'recul': 'test supprimé'})
                for r in RULE.findall(title):
                    touched_unjustified[r].append(title)
                continue
            else:
                continue
        if new == old:
            continue
        ok = justified(title, old, new, accepted, revised)
        rel = relaxations(old, new)
        for x in rel:
            if not ok:
                faults.append(f'{f} : « {title[:90]} » : {x}' + (' (le code existe : une décision D-xxxx est exigée)' if POST_CODE else ''))
                refused.append({'fichier': f, 'titre': title, 'recul': x})
        if rel and ok:
            admitted.append({'file': f if not moved_from(f, title, now) else moved_from(f, title, now), 'title': title, 'old': old, 'new': new})
        if not ok:
            for r in RULE.findall(title):
                touched_unjustified[r].append(title)
    # bilan par règle : nombre de tests et d'assertions
    def per_rule(tests):
        n, a = Counter(), Counter()
        for (_, title), body in tests.items():
            for r in set(RULE.findall(title)):
                n[r] += 1
                a[r] += body.count('expect(')
        return n, a
    # un test dont le propriétaire a accordé le retrait ne compte plus dans le bilan de sa règle
    n0, a0 = per_rule({k: b for k, b in before.items() if k[1] not in GRANTED})
    n1, a1 = per_rule(now)
    for r in sorted(set(n0) | set(a0)):
        if not touched_unjustified.get(r):
            continue  # seuls des changements justifiés (ou aucun) touchent cette règle
        if n1[r] < n0[r]:
            faults.append(f'{r} : {n0[r]} test(s) avant, {n1[r]} maintenant')
        if a1[r] < a0[r]:
            faults.append(f'{r} : {a0[r]} assertion(s) avant, {a1[r]} maintenant')
    if mode != 'gate':
        return grant(refused, mode, sys.argv[3:] if mode == 'accorder' else [])
    os.makedirs('.cuisine-run', exist_ok=True)
    json.dump(admitted, open('.cuisine-run/relaches.json', 'w'), ensure_ascii=False, indent=1)
    if admitted and '--sans-contre-exemple' not in sys.argv:
        r = subprocess.run([sys.executable, '.cuisine/scripts/contre_exemple.py', '.cuisine-run/relaches.json'], capture_output=True, text=True)
        print(r.stdout.strip())
        if r.returncode:
            faults += [l.removeprefix('CONTRE-EXEMPLE ') for l in r.stdout.splitlines() if l.startswith('CONTRE-EXEMPLE')] or ['contre-exemple en échec']
    for x in faults:
        print('CLIQUET', x)
    changed = sum(1 for k, b in before.items() if now.get(k) != b)
    print(f'cliquet: {len(before)} test(s) à {ref[:12]}, {changed} modifié(s) ou déplacé(s), {len(faults)} recul(s) non justifié(s)')
    return 1 if faults else 0


def grant(refused, mode, args):
    """--lister : les reculs refusés, un par test ; --accorder : les inscrit comme accordés par le propriétaire."""
    import yaml
    seen, items = set(), []
    for r in refused:
        if (r['fichier'], r['titre']) not in seen:
            seen.add((r['fichier'], r['titre']))
            items.append(r)
    if not items:
        print('Aucun recul refusé : rien à accorder.')
        return 1 if mode == 'accorder' else 0
    for i, r in enumerate(items, 1):
        print(f'{i:>3}. {r["fichier"]} : {r["recul"]}\n     « {r["titre"]} »')
    if mode == 'lister':
        print(f'{len(items)} recul(s) refusé(s). Sur accord du propriétaire : cuisine accorde --enregistrer "motif"')
        return 1
    version, motif = args[0], ' '.join(args[1:]).strip()
    if not motif:
        print('Motif obligatoire : la raison écrite du recul (par exemple la section de la demande qui le rend nécessaire).')
        return 2
    try:
        entries = yaml.safe_load(open(ACCORDS, encoding='utf-8')) or [] if os.path.exists(ACCORDS) else []
    except yaml.YAMLError:
        entries = []
    today = datetime.date.today().isoformat()
    entries += [{'version': version, 'fichier': r['fichier'], 'titre': r['titre'], 'recul': r['recul'], 'motif': motif, 'accorde_le': today}
                for r in items]
    with open(ACCORDS, 'w', encoding='utf-8') as fh:
        fh.write("# Accords du propriétaire sur le cliquet de la recette : reculs (test supprimé, attendu relâché) que la demande\n"
                 "# d'une version rend nécessaires après l'écriture du code. Écrit par `cuisine accorde --enregistrer`, commit\n"
                 "# « proprietaire » ; le cliquet ne lit que l'état de ce fichier à ce commit.\n")
        yaml.safe_dump(entries, fh, allow_unicode=True, sort_keys=False, width=200)
    print(f'{len(items)} recul(s) accordé(s) par le propriétaire pour {version}.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
