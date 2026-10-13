#!/usr/bin/env python3
"""Jeu de runs fabriqué pour le banc de couts.py : fabrique.py <racine> <dossier de journaux>.
Graphe `banc` : code (agent), porte-s (saine : rouge parfois, juste après l'agent), porte-j (jamais rouge), porte-a
(bon marché, jamais rouge), porte-b (chère, rouge juste après un vert de porte-a : tardive), porte-i (instable : deux
résultats différents sans agent entre deux), fix (réparation), check-final.
Quatre versions v1..v4 avec usage de l'agent et journal ; un run ancien « r-ancien » sans usage ni journal (A4) ;
un run « r-inconnu » d'un modèle absent de la grille (A5) ; v1 fait boucler fix (A2, boucle-réparation)."""
import datetime as dt, json, os, sys

root, journaux = sys.argv[1], sys.argv[2]
PRIX = {'entree': 2, 'w5': 2.5, 'w1': 4, 'lecture': 0.1, 'sortie': 10}  # claude-sonnet-5-5, grille relevée
os.makedirs(os.path.join(root, '.cuisine'), exist_ok=True)
ETAT = root.rstrip('/') + '-etat'  # hors du dépôt : la porte alternante ne touche pas l'arbre
open(os.path.join(root, '.cuisine', 'banc.loop.yaml'), 'w').write('''name: banc
entry: code
defaults: {agent: claude}
nodes:
  code: {type: prompt, session: s, prompt: x, next: porte-s}
  porte-s: {type: command, cmd: "true", on: {exit_0: porte-j, exit_non_zero: fix}}
  porte-j: {type: command, cmd: "true", on: {exit_0: porte-a, exit_non_zero: fix}}
  porte-a: {type: command, cmd: "true", on: {exit_0: porte-b, exit_non_zero: fix}}
  porte-b: {type: command, cmd: "true", on: {exit_0: porte-i, exit_non_zero: fix}}
  porte-i: {type: command, cmd: "true", on: {exit_0: check-final, exit_non_zero: porte-i}}
  fix: {type: prompt, session: s, prompt: x, next: porte-s}
  check-final: {type: command, cmd: "true", on: {exit_0: fin, exit_non_zero: fix}}
  fin: {type: command, cmd: "true"}
  porte-alterne: {type: command, cmd: "if [ -f %s/.alt ]; then rm %s/.alt; else touch %s/.alt; exit 1; fi", on: {exit_0: fin, exit_non_zero: fix}}
''' % ((ETAT,) * 3))
os.makedirs(ETAT, exist_ok=True)
os.makedirs(journaux, exist_ok=True)
J = open(os.path.join(journaux, 'session.jsonl'), 'w')
DUREE = {'porte-s': 5000, 'porte-j': 500, 'porte-a': 1000, 'porte-b': 60000, 'porte-i': 2000, 'check-final': 30000, 'fin': 10}


def run(rid, steps, start, modele='claude-sonnet-5-5', usage=True, journal=True):
    t = start
    nodes, path = {}, []
    for k, (node, code) in enumerate(steps):
        prompt = node in ('code', 'fix')
        d = 120000 if prompt else DUREE[node]
        a, b = t, t + dt.timedelta(milliseconds=d)
        v = {'index': len(nodes.get(node, [])), 'started_at': a.isoformat(timespec='milliseconds').replace('+00:00', 'Z'),
             'ended_at': b.isoformat(timespec='milliseconds').replace('+00:00', 'Z'), 'duration_ms': d, 'exit_code': code,
             'stdout': '' if prompt else f'{node} sortie {code}', 'stderr': ''}
        if prompt:
            turns = [(10, 3000, 1000, 0, 200), (5, 500, 0, 4000, 300), (5, 0, 0, 4500, 400)]  # entrée, w1, w5, lecture, sortie
            tok = [sum(x[i] for x in turns) for i in range(5)]
            cost = (tok[0] * PRIX['entree'] + tok[1] * PRIX['w1'] + tok[2] * PRIX['w5'] + tok[3] * PRIX['lecture'] + tok[4] * PRIX['sortie']) / 1e6
            if usage:
                v['usage'] = {'input_tokens': tok[0], 'output_tokens': tok[4], 'cache_creation_tokens': tok[1] + tok[2],
                              'cache_read_tokens': tok[3], 'total_tokens': sum(tok), 'cost_usd': cost}
            if journal:
                for i, (e, w1, w5, r, o) in enumerate(turns):
                    ts = (a + dt.timedelta(seconds=10 * (i + 1))).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
                    J.write(json.dumps({'type': 'assistant', 'timestamp': ts, 'cwd': root, 'sessionId': 'sess-' + rid, 'requestId': f'{rid}-{k}-{i}',
                                        'message': {'model': modele, 'stop_reason': 'end_turn', 'content': [{'type': 'tool_use', 'name': 'Read', 'input': {'f': 'a'}}],
                                                    'usage': {'input_tokens': e, 'cache_creation_input_tokens': w1 + w5, 'cache_read_input_tokens': r, 'output_tokens': o,
                                                              'cache_creation': {'ephemeral_1h_input_tokens': w1, 'ephemeral_5m_input_tokens': w5}}}}) + '\n')
        nodes.setdefault(node, []).append(v)
        path.append({'node': node, 'exit_code': code})
        t = b + dt.timedelta(seconds=1)
    d = os.path.join(root, '.yamloop', 'runs', rid)
    os.makedirs(d, exist_ok=True)
    json.dump({'schema_version': 3, 'run_id': rid, 'loop_name': 'banc', 'started_at': start.isoformat().replace('+00:00', 'Z'), 'sessions': {},
               'nodes': {n: {'visit_counter': len(vs), 'visits': vs} for n, vs in nodes.items()}}, open(os.path.join(d, 'state.json'), 'w'))
    json.dump({'run_id': rid, 'name': 'banc', 'started_at': start.isoformat(), 'ended_at': t.isoformat(), 'path': path, 'exit_status': 'ok'},
              open(os.path.join(d, 'summary.json'), 'w'))


base = dt.datetime(2026, 10, 1, 8, 0, tzinfo=dt.timezone.utc)
for i, v in enumerate(['v1', 'v2', 'v3', 'v4']):
    s_rouge = v in ('v1', 'v2')
    steps = [('code', 0), ('porte-s', 1 if s_rouge else 0)]
    if s_rouge:
        steps += [('fix', 0), ('porte-s', 0)]
    steps += [('porte-j', 0), ('porte-a', 0), ('porte-b', 1), ('fix', 0), ('porte-s', 0), ('porte-j', 0), ('porte-a', 0), ('porte-b', 0),
              ('porte-i', 1), ('porte-i', 0), ('check-final', 0), ('fin', 0)]
    if v == 'v1':  # fix visité au-delà du seuil : boucle-réparation
        steps = steps[:-2] + [('fix', 0), ('check-final', 1), ('fix', 0), ('check-final', 0), ('fin', 0)]
    run(v, steps, base + dt.timedelta(hours=3 * i))
run('r-ancien', [('code', 0), ('porte-s', 0), ('fin', 0)], base + dt.timedelta(days=2), usage=False, journal=False)
run('r-inconnu', [('code', 0), ('porte-s', 0), ('fin', 0)], base + dt.timedelta(days=3), modele='modele-hors-grille', usage=False)
J.close()
