#!/usr/bin/env python3
"""Jest simulé du banc des variantes : --listTests liste les *.test.ts du dossier courant retenus par les motifs ; sinon
« joue » les fichiers retenus (motifs, moins --testPathIgnorePatterns), note dans $BANC_JOURNAL les fichiers et
l'environnement reçus, écrit un rapport au format JSON de Jest (--outputFile). Un fichier contenant ECHEC échoue,
BLOQUE ne répond plus."""
import glob, json, os, re, sys, time

args = sys.argv[1:]
ignores, out, pos, i = [], None, [], 0
while i < len(args):
    a = args[i]
    if a.startswith('--testPathIgnorePatterns='):
        ignores.append(a.split('=', 1)[1])
    elif a.startswith('--outputFile='):
        out = a.split('=', 1)[1]
    elif a in ('-c', '-t'):
        i += 1
    elif not a.startswith('-'):
        pos.append(a)
    i += 1
files = [f for f in sorted(os.path.abspath(p) for p in glob.glob('*.test.ts'))
         if (not pos or any(re.search(p, f) for p in pos)) and not any(re.search(p, f) for p in ignores or ['/node_modules/'])]
if '--listTests' in args:
    print('\n'.join(files))
    sys.exit(0)
with open(os.environ['BANC_JOURNAL'], 'a') as fh:
    fh.write('jest ' + json.dumps({'files': [os.path.basename(f) for f in files], 'env_file': os.environ.get('ACCEPTANCE_ENV_FILE'),
                                   'variant': os.environ.get('ACCEPTANCE_VARIANT')}) + '\n')
failed = 0
for f in files:
    txt = open(f).read()
    if 'BLOQUE' in txt:
        time.sleep(60)
    failed += 'ECHEC' in txt
n = len(files)
report = {'numTotalTests': n, 'numFailedTests': failed, 'numPassedTests': n - failed, 'numPendingTests': 0, 'numTodoTests': 0,
          'numTotalTestSuites': n, 'numFailedTestSuites': failed, 'numPassedTestSuites': n - failed, 'numPendingTestSuites': 0,
          'numRuntimeErrorTestSuites': 0, 'success': failed == 0, 'testResults': [{'name': f} for f in files], 'startTime': 1}
if out:
    json.dump(report, open(out, 'w'))
print(f'Tests:       {failed} failed, {n - failed} passed, {n} total', file=sys.stderr)
sys.exit(1 if failed else 0)
