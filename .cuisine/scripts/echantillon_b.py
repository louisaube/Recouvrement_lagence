#!/usr/bin/env python3
"""Échantillon B : la version d'origine de chaque test relâché (et admis) est rejouée contre l'application livrée.

  echantillon_b.py <git-ref>   rejoue, pour chaque relâchement admis depuis <git-ref>, le fichier de test tel qu'il était
                               à <git-ref>, limité au test concerné ; écrit .cuisine-run/<version>.echantillon-b.md.

Jamais bloquant : un écart (l'original échoue là où la version relâchée passe) mesure ce que le relâchement a laissé
passer ; il est inscrit au résumé de version par le nœud `mesures`.
"""
import json, os, re, subprocess, sys, tempfile

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
os.chdir(ROOT)


def main():
    ref = sys.argv[1] if len(sys.argv) > 1 else 'HEAD'
    subprocess.run([sys.executable, '.cuisine/scripts/cliquet.py', ref, '--sans-contre-exemple'], capture_output=True, text=True)
    items = json.load(open('.cuisine-run/relaches.json')) if os.path.exists('.cuisine-run/relaches.json') else []
    try:
        v = open('.cuisine-run/version').read().strip()
    except OSError:
        v = 'version'
    lines = [f'## Échantillon B : versions d\'origine des tests relâchés ({len(items)})', '']
    ecarts = 0
    for it in items:
        orig_path = None
        for f in [it['file']] + subprocess.run(['git', 'ls-tree', '-r', '--name-only', ref], capture_output=True, text=True).stdout.split():
            text = subprocess.run(['git', 'show', f'{ref}:{f}'], capture_output=True, text=True).stdout
            if it['title'] in text:
                orig_path, orig_text = f, text
                break
        if not orig_path:
            lines.append(f'- « {it["title"][:90]} » : version d\'origine introuvable')
            continue
        d, base = os.path.split(it['file'])
        tmp = os.path.join(d, base.replace('.test.ts', '') + '.echantillon-b.test.ts')
        open(tmp, 'w', encoding='utf-8').write(orig_text)
        out = tempfile.NamedTemporaryFile(suffix='.json', delete=False).name
        try:
            if tmp.startswith('acceptance/'):
                cmd = ['bash', '.cuisine/scripts/acceptance.sh', '--json', f'--outputFile={out}', '-t', re.escape(it['title']), tmp.removeprefix('acceptance/')]
            else:
                cmd = ['bash', '-c', f'cd api && NODE_ENV=test npx jest --runInBand --json --outputFile={out} -t {json.dumps(re.escape(it["title"]))} {tmp.removeprefix("api/")}']
            subprocess.run(cmd, capture_output=True, text=True)
            data = json.load(open(out))
            st = [a['status'] for f in data.get('testResults', []) for a in f.get('assertionResults', []) if a.get('title') == it['title']]
        except (OSError, ValueError):
            st = []
        finally:
            os.remove(tmp)
        verdict = st[0] if st else 'non joué'
        if verdict == 'failed':
            ecarts += 1
            lines.append(f'- **Écart** : « {it["title"][:90]} » ({it["file"]}) : la version d\'origine échoue sur l\'application livrée ; le relâchement a laissé passer cette différence.')
        else:
            lines.append(f'- « {it["title"][:90]} » ({it["file"]}) : version d\'origine {"verte" if verdict == "passed" else verdict}.')
    lines.insert(1, f'Écarts : {ecarts}.')
    os.makedirs('.cuisine-run', exist_ok=True)
    open(f'.cuisine-run/{v}.echantillon-b.md', 'w', encoding='utf-8').write('\n'.join(lines) + '\n')
    print(f'echantillon-b: {len(items)} relâchement(s) rejoué(s) dans leur version d\'origine, {ecarts} écart(s)')
    return 0


if __name__ == '__main__':
    sys.exit(main())
