#!/usr/bin/env python3
"""Rapport de la cuisine (données du tableau de bord) : versions, parcours, réparations, contestations,
règles à valider, portes, alertes. Lecture seule, sans LLM. Usage : report.py [sortie.json]"""
import glob, json, os, re, subprocess, sys
from collections import Counter

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
os.chdir(ROOT)
ANSI = re.compile(r'\x1b\[[0-9;]*m')


def sh(cmd):
    return subprocess.run(cmd, shell=True, capture_output=True, text=True).stdout.strip()


def read(p):
    try:
        return ANSI.sub('', open(p, encoding='utf-8', errors='replace').read())
    except OSError:
        return ''


def version(name):
    log, out = read(f'.cuisine-run/{name}.log'), read(f'.cuisine-run/{name}.out')
    steps = re.findall(r'node_end\S* ([a-z-]+) exit=(\d+)', log)
    ends = list(re.finditer(r'run_end\S* \S+ status=(\w+) steps=(\d+)', log))
    end = ends[-1] if ends else None  # une fabrication reprise a plusieurs fins : la dernière fait foi
    times = re.findall(r'(?:début|fin) (\d\d:\d\d)', out)
    visits = Counter(n for n, _ in steps)
    keys = {name, re.sub(r'-\d+-', '-', name), re.sub(r'^v\d+-', '', name), re.sub(r'^socle-\d+-', '', name)}
    folders = [d for d in glob.glob('specifications/*/implementation-plans/*') if os.path.basename(d) in keys]
    disputes = []
    for d in glob.glob('specifications/**/DISPUTES.md', recursive=True):
        if any(d.startswith(f) for f in folders):
            disputes += [l.strip() for l in read(d).splitlines() if re.match(r'^(OPEN|ACCEPTED|REJECTED)', l)]
    inferred = sorted({m for f in folders for p in glob.glob(f + '/*.md') for m in re.findall(r'(rule-[a-z0-9-]+)[^\n]*\(inferred\)', read(p))})
    return {
        'nom': name,
        'demande': (read(f'prompts/{name}.md') or read(f".cuisine-run/lot-{name.removeprefix('rebuild-')}.md")).strip(),
        'statut': end.group(1) if end else ('en cours' if steps else 'non lancée'),
        'etapes': int(end.group(2)) if end else len(steps),
        'debut': times[0] if times else None, 'fin': times[1] if len(times) > 1 else None,
        'reparations': {n: c for n, c in visits.items() if n.startswith('fix-') or n in ('acceptance-fix', 'matrix-fix', 'qa-arbitrate')},
        # « bloqué » (code 124 : tests arrêtés par la limite de durée) n'est pas un échec d'assertion
        'portes_echouees': Counter(n for n, e in steps if e not in ('0', '124') and n not in ('dispute-check', 'dispute-gate', 'gate-dispute', 'back-dispute')),
        'portes_bloquees': Counter(n for n, e in steps if e == '124'),
        'contestations': disputes,
        'regles_inferees': inferred,
        'derniere_etape': steps[-1][0] if steps else None,
    }


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else '.cuisine-run/report.json'
    names = sorted(os.path.splitext(os.path.basename(p))[0] for p in glob.glob('prompts/*.md') if not p.endswith('README.md'))
    # lots de la reconstruction en salle blanche : journal rebuild-<lot>.log, fiche .cuisine-run/lot-<lot>.md
    names = sorted(os.path.splitext(os.path.basename(p))[0] for p in glob.glob('.cuisine-run/rebuild-*.log')) + names
    manual = '.cuisine-run/manual'
    portes = {}
    for k, f, rx in (('tests unitaires', 'unit.log', r'^Tests:.*'), ('recette', 'acc.log', r'^Tests:.*'), ('complétude', 'matrix.log', r'^matrix:.*'),
                     ('droits', 'perm.log', r'^permissions:.*'), ('contrat', 'contract.log', r'^(?:contract|schemathesis|fidelity):.*'),
                     ('navigateur', 'e2e.log', r'^[ \t]*\d+ passed.*')):
        m = re.findall(rx, read(os.path.join(manual, f)), re.M)
        if m:
            portes[k] = ' ; '.join(m[-2:]) if k == 'contrat' else m[-1]
    alerts = [re.sub(r'\s*\|\s*', ' | ', l).strip(' |') for l in read(os.path.join(manual, 'permissions.md')).splitlines() if 'ALERTE' in l or 'BLOQUANT' in l]
    # instrumentation (couts.py) : coût, itérations avant vert, signaux des portes, propositions ; lecture seule
    subprocess.run([sys.executable, '.cuisine/scripts/couts.py'], capture_output=True, text=True)
    try:
        c = json.load(open('.cuisine-run/couts.json'))
        couts = {'runs': c['runs'], 'par_agent': c['par_agent'], 'estimation': c['estimation'], 'seuils': c['seuils_provisoires'],
                 'portes': {k: p for k, p in c['portes'].items() if p['signaux']},
                 'propositions': [l for l in read('.cuisine-run/couts-propositions.md').splitlines() if re.match(r'^\d+\. ', l)]}
    except (OSError, ValueError, KeyError):
        couts = None
    report = {
        'couts': couts,
        'application': json.load(open('package.json')).get('name'),
        'genere': sh("date '+%Y-%m-%d %H:%M'"),
        'commit': sh('git log -1 --format="%h %s"'),
        'versions': [version(n) for n in names],
        'portes': portes, 'alertes_droits': alerts,
        'captures': sorted(glob.glob('.cuisine-run/shots/*.png')),
        'commits': sh('git log -12 --format="%h|%an|%ad|%s" --date=format:"%d/%m %H:%M"').splitlines(),
    }
    os.makedirs(os.path.dirname(out), exist_ok=True)
    json.dump(report, open(out, 'w'), ensure_ascii=False, indent=1)
    print(out)


main()
