#!/usr/bin/env python3
"""Registre des tests vus rouges : un test de recette doit avoir échoué une fois avant le code qui le satisfait.

  rouge.py check <fichiers…>                 n'exige le rouge que des tests absents du registre ; les inscrit s'ils échouent
  rouge.py prouver <commit> <fichier> [motif] l'API qui tourne (API_URL) est celle de <commit> (ou d'un mutant nommé) :
                                             chaque test du fichier (dont le titre contient le motif) doit y échouer ;
                                             il est alors inscrit avec la preuve <commit>

Registre : specifications/recette-rouge.yaml (versionné, scellé avec la recette). Il est lu dans le dernier commit,
jamais dans l'arbre de travail : une écriture d'agent avant le scellement n'exempte aucun test. Plus aucune marque
posée à la main. Un rouge ne compte que s'il vient d'un attendu refusé (expect) ou d'un dépassement de délai du test :
une erreur de mise en place (base absente, déclencheur, exception du harnais) n'éprouve rien et n'est pas un rouge.
Codes : 0 rouge constaté (ou déjà acquis), 3 test(s) vert(s), non joué(s) ou en erreur avant le code, 124 bloqué.
"""
import datetime, json, os, re, subprocess, sys, tempfile
import yaml

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
os.chdir(ROOT)
REG = 'specifications/recette-rouge.yaml'
TEST_START = re.compile(r'''^\s*(?:it|test)(?:\.\w+)?\(\s*(['"`])(.*?)\1''', re.M)


def committed():
    r = subprocess.run(['git', 'show', f'HEAD:{REG}'], capture_output=True, text=True)
    return yaml.safe_load(r.stdout) or [] if r.returncode == 0 else []


def working():
    return yaml.safe_load(open(REG)) or [] if os.path.exists(REG) else []


def save(entries):
    with open(REG, 'w', encoding='utf-8') as fh:
        fh.write('# Tests de recette vus rouges avant le code qui les satisfait. Écrit par .cuisine/scripts/rouge.py, jamais à la main.\n')
        yaml.safe_dump(entries, fh, allow_unicode=True, sort_keys=False, width=200)


def titles(path):
    return [m.group(2) for m in TEST_START.finditer(open(os.path.join('acceptance', path), encoding='utf-8', errors='replace').read())]


def run(files, wanted, env=None):
    """Exécute la recette sur `files`, limitée aux titres voulus ; renvoie (code, {titre: statut})."""
    out = tempfile.NamedTemporaryFile(suffix='.json', delete=False).name
    pattern = '|'.join(re.escape(t) for t in wanted)
    r = subprocess.run(['bash', '.cuisine/scripts/acceptance.sh', '--json', f'--outputFile={out}', '-t', pattern, *files],
                       capture_output=True, text=True, env={**os.environ, **(env or {})})
    if r.returncode == 124:
        return 124, {}
    try:
        data = json.load(open(out))
    except (OSError, ValueError):
        print(r.stdout[-2000:], r.stderr[-2000:])
        return r.returncode or 2, {}
    status = {}
    for f in data.get('testResults', []):
        for a in f.get('assertionResults', []):
            st = a.get('status')
            if st == 'failed':
                attendu = any(isinstance(d, dict) and d.get('matcherResult') for d in a.get('failureDetails') or [])
                delai = any('Exceeded timeout' in m for m in a.get('failureMessages') or [])
                if not (attendu or delai):
                    st = 'erreur'  # échec étranger à l'attendu : rien n'est éprouvé
            status[a.get('title')] = st
    return r.returncode, status


def cmd_check(files):
    seen = {(e['fichier'], e['titre']) for e in committed()}
    candidates = [(f, t) for f in files for t in titles(f) if (f, t) not in seen]
    known = sum(1 for f in files for t in titles(f) if (f, t) in seen)
    if not candidates:
        print(f'RED ALREADY ESTABLISHED: {known} test(s) déjà vus rouges, aucun test nouveau à éprouver')
        return 0
    code, status = run(sorted({f for f, _ in candidates}), [t for _, t in candidates])
    if code == 124:
        print('BLOQUÉ : la recette n\'a pas répondu dans le délai')
        return 124
    green = [t for _, t in candidates if status.get(t) == 'passed']
    missing = [t for _, t in candidates if t not in status]
    errors = [t for _, t in candidates if status.get(t) == 'erreur']
    for t in errors:
        print(f'ERREUR DE MISE EN PLACE : « {t[:100]} » échoue hors de tout attendu ; ce n\'est pas un rouge')
    for t in green:
        print(f'VACUOUS: « {t[:100]} » passe avant le code qui doit le satisfaire')
    for t in missing:
        print(f'NON JOUÉ : « {t[:100]} » (titre introuvable dans le rapport de Jest)')
    if green or missing or errors:
        print(f'rouge: {len(candidates) - len(green) - len(missing) - len(errors)}/{len(candidates)} test(s) nouveaux rouges ; {known} déjà acquis')
        return 3
    head = subprocess.run(['git', 'rev-parse', '--short', 'HEAD'], capture_output=True, text=True).stdout.strip()
    entries = working()
    have = {(e['fichier'], e['titre']) for e in entries}
    today = datetime.date.today().isoformat()
    entries += [{'fichier': f, 'titre': t, 'vu_rouge': today, 'sur': head} for f, t in candidates if (f, t) not in have]
    save(entries)
    print(f'RED OK: {len(candidates)} test(s) nouveaux vus rouges et inscrits ; {known} déjà acquis')
    return 0


def cmd_prouver(commit, path, motif=None):
    f = path.removeprefix('acceptance/')
    ts = [t for t in titles(f) if not motif or motif in t]
    if not ts:
        print(f'aucun test de {f} ne contient « {motif} »')
        return 2
    code, status = run([f], ts)
    if code == 124 and len(ts) == 1:
        print(f'BLOQUÉ sur {commit} : « {ts[0][:100]} » sans réponse dans le délai ; un blocage vaut échec pour ce test')
        status = {ts[0]: 'failed'}
    elif code == 124:
        # un blocage du lot n'est attribuable à aucun test, et il laisse l'API dans un état qui fausse tout rejeu
        print(f'BLOQUÉ sur {commit} : blocage du lot, non attribuable ; rien n\'est inscrit. Redémarrer l\'API '
              f'avant chaque preuve, un test à la fois : rouge.py prouver {commit} {path} <motif du titre>')
        return 3
    red = [t for t in ts if status.get(t) == 'failed']
    green = [t for t in ts if t not in red]
    for t in green:
        print(f'NON ROUGE sur {commit} : « {t[:100]} » ({status.get(t, "non jugé")})')
    entries = working()
    have = {(e['fichier'], e['titre']) for e in entries}
    today = datetime.date.today().isoformat()
    entries += [{'fichier': f, 'titre': t, 'vu_rouge': today, 'sur': commit, 'preuve': 'rejoué sur l\'état d\'avant la correction'}
                for t in red if (f, t) not in have]
    if red:
        save(entries)
    print(f'PREUVE: {len(red)}/{len(ts)} test(s) de {f} rouges sur {commit}, inscrits au registre')
    return 3 if green else 0

if __name__ == '__main__':
    a = sys.argv[1:]
    if a[:1] == ['check'] and len(a) > 1:
        sys.exit(cmd_check(a[1:]))
    if a[:1] == ['prouver'] and len(a) in (3, 4):
        sys.exit(cmd_prouver(*a[1:]))
    print(__doc__)
    sys.exit(2)
