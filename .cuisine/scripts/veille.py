#!/usr/bin/env python3
"""Veille de la cuisine, sans LLM : état des services et de la dernière fabrication.

Une session cloud peut être recyclée pendant une attente : PostgreSQL ne redémarre pas et la chaîne meurt sans écrire
de fin. La veille le constate d'après l'état de yamloop (.yamloop/runs/<id>/state.json), le journal de la chaîne
(.cuisine-run/<version>.log) et la présence du processus.

  veille.py etat      affiche le constat et écrit le mot d'état dans .cuisine-run/veille/etat ;
                      code 0 rien à faire, 10 fabrication interrompue et reprenable, 20 décision humaine attendue
  veille.py reprise   « <run-id> <graphe> <journal> » de la dernière fabrication, pour cuisine veille --relance
  veille.py compter   inscrit une reprise automatique de la dernière fabrication

États : aucune, en-cours, terminee, interrompue, attente-arbitrage, arretee, reprises-epuisees.
"""
import glob, json, os, re, subprocess, sys, time, urllib.request

ROOT = os.getcwd()
RUN = os.path.join(ROOT, '.cuisine-run')
VEILLE = os.path.join(RUN, 'veille')
MAX_REPRISES = 5  # au-delà, la panne n'est plus un recyclage de machine : décision humaine
ANSI = re.compile(r'\x1b\[[0-9;]*m')
EVENT = re.compile(r'\[hook:(node_start|node_end|run_end)\]\s*(\S+)(.*)')


def derniere_fabrication():
    """Run yamloop le plus récent : identifiant, graphe (fichier .loop.yaml), journal de la cuisine."""
    states = sorted(glob.glob(os.path.join(ROOT, '.yamloop', 'runs', '*', 'state.json')), key=os.path.getmtime)
    if not states:
        return None
    state = json.load(open(states[-1]))
    run_id = state.get('run_id') or os.path.basename(os.path.dirname(states[-1]))
    graphe = None
    for f in sorted(glob.glob(os.path.join(ROOT, '.cuisine', '*.loop.yaml'))):
        m = re.search(r'^name:\s*(\S+)', open(f).read(), re.M)
        if m and m.group(1) == state.get('loop_name'):
            graphe = f
    # une suite après arbitrage (<version>-suite-HHMMSS) écrit dans le journal de sa version
    m = re.match(r'^(.*)-suite-\d{6}$', run_id)
    journal = os.path.join(RUN, (m.group(1) if m else run_id) + '.log')
    return {'id': run_id, 'graphe': graphe, 'journal': journal, 'pause': state.get('paused') and state.get('pause_reason')}


def evenements(journal):
    if not os.path.exists(journal):
        return []
    out = []
    for line in open(journal, errors='replace'):
        m = EVENT.search(ANSI.sub('', line))
        if m:
            out.append((m.group(1), m.group(2), m.group(3).strip()))
    return out


def en_cours(run_id):
    motif = rf'yamloop.*--(run-id|resume) {re.escape(run_id)}( |$)'
    return subprocess.run(['pgrep', '-f', motif], capture_output=True).returncode == 0


def reprises(run_id):
    p = os.path.join(VEILLE, run_id + '.reprises')
    return len(open(p).read().split()) if os.path.exists(p) else 0


def service(nom):
    if nom == 'postgres':
        return subprocess.run(['pg_isready', '-h', 'localhost', '-p', '5432', '-q'], capture_output=True).returncode == 0
    try:
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with opener.open('http://localhost:4000/server/health-check', timeout=3) as r:
            return r.status == 200
    except Exception:
        return False


def etat():
    os.makedirs(VEILLE, exist_ok=True)
    pg, api = service('postgres'), service('api')
    print(f"Services : PostgreSQL {'en marche' if pg else 'ARRÊTÉ'}, API {'en marche' if api else 'arrêtée'}")
    run = derniere_fabrication()
    code, mot = 0, 'aucune'
    if run is None:
        print('Fabrication : aucune')
    else:
        evts = evenements(run['journal'])
        heure = time.strftime('%d/%m %H:%M', time.localtime(os.path.getmtime(run['journal']))) if os.path.exists(run['journal']) else '?'
        dernier = evts[-1] if evts else None
        etape = next((e[1] for e in reversed(evts) if e[0] != 'run_end'), '?')
        if en_cours(run['id']):
            mot = 'en-cours'
            print(f"Fabrication {run['id']} : en cours, étape {etape}" + (f" (en pause : {run['pause']})" if run['pause'] else ''))
        elif dernier and dernier[0] == 'run_end':
            if etape == 'en-attente':
                code, mot = 20, 'attente-arbitrage'
                print(f"Fabrication {run['id']} : en attente d'arbitrage depuis {heure} (cuisine questions, puis cuisine arbitre)")
            elif 'status=ok' in dernier[2]:
                mot = 'terminee'
                print(f"Fabrication {run['id']} : terminée le {heure}")
            else:
                code, mot = 20, 'arretee'
                print(f"Fabrication {run['id']} : arrêtée par la chaîne le {heure}, étape {etape} ({dernier[2]})")
        elif not evts:
            print(f"Fabrication {run['id']} : aucun événement dans {os.path.relpath(run['journal'])}")
        elif reprises(run['id']) >= MAX_REPRISES:
            code, mot = 20, 'reprises-epuisees'
            print(f"Fabrication {run['id']} : interrompue à l'étape {etape} ; {MAX_REPRISES} reprises automatiques déjà faites, décision humaine attendue")
        elif run['graphe'] is None:
            code, mot = 20, 'arretee'
            print(f"Fabrication {run['id']} : interrompue à l'étape {etape}, graphe introuvable pour la reprise")
        else:
            code, mot = 10, 'interrompue'
            print(f"Fabrication {run['id']} : INTERROMPUE à l'étape {etape} (dernière trace {heure}), sans fin écrite : machine recyclée")
    open(os.path.join(VEILLE, 'etat'), 'w').write(mot + '\n')
    return code


def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else 'etat'
    if cmd == 'etat':
        sys.exit(etat())
    run = derniere_fabrication()
    if run is None:
        sys.exit(1)
    if cmd == 'reprise':
        print(run['id'], run['graphe'], run['journal'])
    elif cmd == 'compter':
        os.makedirs(VEILLE, exist_ok=True)
        with open(os.path.join(VEILLE, run['id'] + '.reprises'), 'a') as f:
            f.write(time.strftime('%Y-%m-%dT%H:%M:%S') + '\n')
        print(reprises(run['id']))
    else:
        sys.exit(f'commande inconnue : {cmd}')


if __name__ == '__main__':
    main()
