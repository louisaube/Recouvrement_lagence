#!/usr/bin/env python3
"""Instrumentation de la cuisine : coût, efficacité du cache, causes d'arrêt, santé des portes. Lecture seule, sans LLM,
sans réseau, déterministe (spécification « instrumentation de la cuisine », F1 à F14).

  couts.py [options]                 calcule tout ; écrit <sortie>/couts/<run>.json, <sortie>/couts.json et
                                     <sortie>/couts-propositions.md ; imprime un résumé
  couts.py empreinte                 empreinte de la configuration de la chaîne (F14), sur une ligne
  couts.py archiver [--branche B]   range les résultats du dernier calcul dans la branche B (cuisine/couts par défaut)
                                     par un commit fait sans toucher l'arbre ni l'index ; la publication reste à l'opérateur
  couts.py determinisme <nœud> [-c <graphe>]
                                     F11 : rejoue deux fois la commande d'une porte sur l'arbre courant, compare sortie et
                                     code ; anomalie signalée (code 1), jamais corrigée
Options : --racine <dépôt> (défaut : courant), --runs <dossier .yamloop/runs>, --journaux <dossier de journaux de session>,
          --tarifs <grille>, --sortie <dossier> (défaut : <racine>/.cuisine-run), --version <v> (résumé limité),
          --seuil-boucle N (3), --seuil-jamais-rouge N (3), --seuil-tardive N (2), --seuil-regle N (3).

Sources (F1) : l'usage rangé par yamloop dans state.json (sortie de l'agent), sinon le journal de session de l'agent
(~/.claude/projects/<dépôt>/*.jsonl), tours affectés à la visite par leur horodatage. Aucun texte de prompt, de sortie
ou d'environnement n'est écrit (F9) : seulement des métriques et des identifiants.
Seuils de F10 à F13 : provisoires, faute d'historique ; l'outil signale, il ne conclut pas et ne modifie rien.
"""
import glob, hashlib, json, os, re, statistics, subprocess, sys
from collections import Counter, defaultdict

ARGS = sys.argv[1:]


def opt(name, default=None):
    if name in ARGS:
        i = ARGS.index(name)
        return ARGS[i + 1]
    return default


ROOT = os.path.abspath(opt('--racine', os.getcwd()))
RUNS = opt('--runs', os.path.join(ROOT, '.yamloop', 'runs'))
SLUG = re.sub(r'[^A-Za-z0-9]', '-', ROOT)
JOURNAUX = opt('--journaux', os.path.join(os.path.expanduser('~'), '.claude', 'projects', SLUG))
TARIFS = opt('--tarifs', os.path.join(ROOT, '.cuisine', 'tarifs.yaml'))
SORTIE = opt('--sortie', os.path.join(ROOT, '.cuisine-run'))
SEUILS = {'boucle': int(opt('--seuil-boucle', 3)), 'jamais_rouge': int(opt('--seuil-jamais-rouge', 3)),
          'tardive': int(opt('--seuil-tardive', 2)), 'regle': int(opt('--seuil-regle', 3))}
CAUSES = ['limite-abonnement', 'erreur-api', 'limite-tours', 'limite-tokens', 'outil-refusé', 'boucle-réparation',
          'porte-rouge', 'fin-normale']  # ordre de préséance : une visite reçoit le premier code qui s'applique
MOTIFS = [  # appliqués au seul texte des visites d'agent (une porte peut afficher « 429 » dans un test)
    ('limite-abonnement', re.compile(r'usage limit reached|limit will reset|out of extra usage', re.I)),
    ('erreur-api', re.compile(r'API Error|overloaded_error|Internal server error|429 Too Many Requests|ECONNRESET|socket hang up', re.I)),
    ('limite-tours', re.compile(r'max(imum)?[_ ]turns|error_max_turns', re.I)),
    ('limite-tokens', re.compile(r'prompt is too long|context (length|window) exceeded|max_tokens', re.I)),
    ('outil-refusé', re.compile(r'permission(s)? (denied|to use)|not allowed to use|requires approval|was blocked by', re.I)),
]
RULE = re.compile(r'rule-[a-z0-9]+(?:-[a-z0-9]+)+')
CONFIG_GLOBS = ['.cuisine/*.loop.yaml', '.cuisine/scripts/*', '.cuisine/bin/*', '.cuisine/tarifs.yaml']


def r6(x):
    return None if x is None else round(float(x), 6)


# ─── configuration de la chaîne ────────────────────────────────────────────────────────────────────────────────────

def empreinte(root=ROOT):
    """F14 : empreinte des fichiers qui définissent la chaîne (graphes, scripts, commande, grille)."""
    h = hashlib.sha256()
    files = sorted({f for g in CONFIG_GLOBS for f in glob.glob(os.path.join(root, g)) if os.path.isfile(f)})
    for f in files:
        h.update(os.path.relpath(f, root).encode() + b'\0' + hashlib.sha256(open(f, 'rb').read()).digest())
    return h.hexdigest()[:16]


def graphes():
    """nom du graphe -> {nœud: {type, agent, on, next}} ; PyYAML s'il est là, sinon types déduits des visites."""
    out = {}
    try:
        import yaml
    except ImportError:
        return out
    for f in sorted(glob.glob(os.path.join(ROOT, '.cuisine', '*.loop.yaml'))):
        try:
            c = yaml.safe_load(open(f, encoding='utf-8'))
        except Exception:
            continue
        agent = (c.get('defaults') or {}).get('agent')
        nodes = {}
        for k, v in (c.get('nodes') or {}).items():
            on = v.get(True) if True in v else v.get('on')  # YAML 1.1 : la clé `on` devient True
            nodes[k] = {'type': v.get('type'), 'agent': v.get('agent') or (agent if v.get('type') == 'prompt' else None),
                        'on': on or {}, 'next': v.get('next')}
        out[c.get('name')] = nodes
    return out


def role(node, graph):
    """porte, aiguillage, réparation, arbitrage, agent, commande."""
    g = graph.get(node, {})
    if g.get('type') == 'prompt' or (not g and ('fix' in node or node == 'qa-arbitrate')):
        if node == 'qa-arbitrate':
            return 'arbitrage'
        return 'réparation' if ('fix' in node) else 'agent'
    on = g.get('on') or {}
    if node == 'arbitrage-wait' or re.search(r'(^|-)dispute(-|$)', node) and node != 'dispute-check':
        return 'aiguillage'
    if on.get('exit_0') and on.get('exit_non_zero') and on['exit_0'] != on['exit_non_zero']:
        return 'porte'
    return 'commande'


# ─── grille tarifaire (F2) ─────────────────────────────────────────────────────────────────────────────────────────

def tarifs():
    """Liste de lignes {modele, effet, entree, ecriture_cache_5m, ecriture_cache_1h, lecture_cache, sortie, source},
    USD par million de tokens. Format : sous-ensemble de YAML (liste de correspondances plates), lu sans dépendance."""
    rows, cur = [], None
    try:
        lines = open(TARIFS, encoding='utf-8').read().splitlines()
    except OSError:
        return rows
    for line in lines:
        s = line.split('#', 1)[0].rstrip() if not line.lstrip().startswith('source') else line.rstrip()
        if not s.strip():
            continue
        m = re.match(r'^\s*(-\s+)?([a-z_0-9]+):\s*(.*)$', s)
        if not m:
            continue
        if m.group(1):
            cur = {}
            rows.append(cur)
        if cur is None:
            continue
        k, v = m.group(2), m.group(3).strip().strip('"\'')
        try:
            cur[k] = float(v) if k not in ('modele', 'effet', 'source', 'releve') else v
        except ValueError:
            cur[k] = v
    return [r for r in rows if r.get('modele')]


GRILLE = None


def prix(modele, date):
    global GRILLE
    if GRILLE is None:
        GRILLE = tarifs()
    effet = lambda r: str(r.get('effet')) if re.match(r'^\d{4}-\d\d-\d\d$', str(r.get('effet'))) else '0000-00-00'
    cands = [r for r in GRILLE if r['modele'] == modele and effet(r) <= (date or '')[:10]]
    return max(cands, key=effet) if cands else None


def cout_estime(modele, date, tok, split=None):
    """F2 : None si le modèle ou un tarif manque (« coût inconnu », jamais zéro)."""
    p = prix(modele, date) if modele else None
    need = ('entree', 'lecture_cache', 'sortie', 'ecriture_cache_5m', 'ecriture_cache_1h')
    if not p or any(not isinstance(p.get(k), float) for k in need):
        return None, None
    w5, w1 = (split or (tok['ecriture_cache'], 0))
    hyp = None if split else 'répartition des écritures de cache inconnue : tarif 5 min appliqué'
    c = (tok['entree'] * p['entree'] + tok['lecture_cache'] * p['lecture_cache'] + tok['sortie'] * p['sortie']
         + w5 * p['ecriture_cache_5m'] + w1 * p['ecriture_cache_1h']) / 1e6
    return r6(c), hyp


# ─── journaux de session (F1 détail, F3, F4, F6) ───────────────────────────────────────────────────────────────────

def journal_tours():
    """Tours d'agent des journaux de session : un par requête (dernier enregistrement de la requête), triés par date."""
    best = {}
    for f in sorted(glob.glob(os.path.join(JOURNAUX, '*.jsonl'))):
        with open(f, encoding='utf-8', errors='replace') as fh:
            for line in fh:
                if '"assistant"' not in line:
                    continue
                try:
                    e = json.loads(line)
                except ValueError:
                    continue
                if e.get('type') != 'assistant' or not isinstance(e.get('message'), dict):
                    continue
                m = e['message']
                u = m.get('usage') or {}
                key = e.get('requestId') or m.get('id') or e.get('uuid')
                if not key or not e.get('timestamp'):
                    continue
                cc = u.get('cache_creation') or {}
                outils = [(b.get('name'), hashlib.sha256(json.dumps(b.get('input'), sort_keys=True).encode()).hexdigest()[:12])
                          for b in (m.get('content') or []) if isinstance(b, dict) and b.get('type') == 'tool_use']
                t = {'ts': e['timestamp'], 'cwd': e.get('cwd') or '', 'modele': m.get('model'), 'session': e.get('sessionId'),
                     'entree': int(u.get('input_tokens') or 0), 'ecriture_cache': int(u.get('cache_creation_input_tokens') or 0),
                     'lecture_cache': int(u.get('cache_read_input_tokens') or 0), 'sortie': int(u.get('output_tokens') or 0),
                     'w5': int(cc.get('ephemeral_5m_input_tokens') or 0), 'w1': int(cc.get('ephemeral_1h_input_tokens') or 0),
                     'stop': m.get('stop_reason'), 'outils': outils}
                prev = best.get(key)
                if prev is None or (t['sortie'], len(t['outils'])) >= (prev['sortie'], len(prev['outils'])):
                    t['outils'] = sorted(set(t['outils']) | set(prev['outils'] if prev else []))
                    best[key] = t
    return sorted(best.values(), key=lambda t: (t['ts'], t['entree'], t['sortie']))


def tours_de(tours, debut, fin):
    return [t for t in tours if debut <= t['ts'] <= fin and (not t['cwd'] or t['cwd'] == ROOT or t['cwd'].startswith(ROOT + '/'))]


def contexte(tours):
    """F4 : taille du contexte par tour ; pics au-delà de moyenne + 2 écarts-types."""
    tailles = [t['entree'] + t['ecriture_cache'] + t['lecture_cache'] for t in tours]
    if not tailles:
        return None
    moy = statistics.fmean(tailles)
    sd = statistics.pstdev(tailles) if len(tailles) > 1 else 0.0
    pics = [i for i, x in enumerate(tailles) if sd > 0 and x > moy + 2 * sd]
    return {'tours': len(tailles), 'max': max(tailles), 'moyen': r6(moy), 'pics': len(pics), 'tours_pics': pics}


def ecriture_perdue(tours):
    """F3, définition à valider : une écriture de cache est perdue si aucun tour suivant de la même session n'en relit
    au moins le volume cumulé (dernier tour d'une visite : toujours perdue, rien ne le suit)."""
    perdue = 0
    for i, t in enumerate(tours):
        if not t['ecriture_cache']:
            continue
        suivants = [u for u in tours[i + 1:] if u['session'] == t['session']]
        prefixe = t['lecture_cache'] + t['ecriture_cache']
        if not any(u['lecture_cache'] >= prefixe for u in suivants):
            perdue += t['ecriture_cache']
    return perdue


# ─── visites ───────────────────────────────────────────────────────────────────────────────────────────────────────

def version_lot(run_id):
    m = re.match(r'^rebuild-(r\d+.*)$', run_id)
    if m:
        return 'rebuild', m.group(1)
    v = re.sub(r'-suite(-\d+)?$', '', run_id)
    return v, run_id


def sequence(run_dir, state):
    """Visites dans l'ordre du parcours : summary.json (comme yamloop) sinon par date de début."""
    nodes = state.get('nodes') or {}
    flat = [(n, i, v) for n, d in nodes.items() for i, v in enumerate(d.get('visits') or [])]
    try:
        summary = json.load(open(os.path.join(run_dir, 'summary.json')))
        path = summary.get('path') or []
    except (OSError, ValueError):
        summary, path = {}, []
    if path:
        occ, seq = Counter(), []
        for step in path:
            n = step['node']
            k = occ[n]
            occ[n] += 1
            vs = (nodes.get(n) or {}).get('visits') or []
            if k < len(vs):
                seq.append((n, k, vs[k]))
        seen = {(n, k) for n, k, _ in seq}
        seq += sorted([x for x in flat if (x[0], x[1]) not in seen], key=lambda x: x[2].get('started_at') or '')
        return seq, summary
    return sorted(flat, key=lambda x: (x[2].get('started_at') or '', x[0])), summary


def cause(node, k, visit, rl, tours):
    if rl in ('agent', 'réparation', 'arbitrage'):
        texte = (visit.get('stdout') or '') + '\n' + (visit.get('stderr') or '') + '\n' + (visit.get('error_message') or '')
        for code, rx in MOTIFS:
            if rx.search(texte):
                return code
        if tours and tours[-1].get('stop') == 'max_tokens':
            return 'limite-tokens'
        if rl == 'réparation' and k >= SEUILS['boucle']:
            return 'boucle-réparation'
        return 'fin-normale'
    if rl == 'porte' and visit.get('exit_code') not in (0, None):
        return 'porte-rouge'
    return 'fin-normale'


def visites_run(run_dir, graphs, tours_all, fps):
    state = json.load(open(os.path.join(run_dir, 'state.json')))
    run_id = state.get('run_id') or os.path.basename(run_dir)
    graph = graphs.get(state.get('loop_name'), {})
    version, lot = version_lot(run_id)
    seq, summary = sequence(run_dir, state)
    out = []
    for pos, (node, k, v) in enumerate(seq):
        if not v.get('ended_at'):
            continue  # visite en cours : jugée au prochain calcul
        rl = role(node, graph)
        g = graph.get(node, {})
        if not g and v.get('usage') and rl == 'commande':
            rl = 'agent'  # graphe introuvable : une visite qui a un usage est une visite d'agent
        typ = g.get('type') or ('prompt' if rl in ('agent', 'réparation', 'arbitrage') else 'command')
        rec = {'run': run_id, 'version': version, 'lot': lot, 'graphe': state.get('loop_name'), 'position': pos,
               'noeud': node, 'visite': k, 'type': typ, 'role': rl, 'agent': g.get('agent') if typ == 'prompt' else None,
               'debut': v.get('started_at'), 'duree_ms': v.get('duration_ms'), 'code_sortie': v.get('exit_code'),
               'empreinte_sortie': hashlib.sha256((v.get('stdout') or '').encode()).hexdigest()[:12] if typ == 'command' else None}
        tours = tours_de(tours_all, v['started_at'], v['ended_at']) if typ == 'prompt' else []
        u = v.get('usage') or {}
        if typ == 'prompt':
            if u:
                tok = {'entree': int(u.get('input_tokens') or 0), 'ecriture_cache': int(u.get('cache_creation_tokens') or 0),
                       'lecture_cache': int(u.get('cache_read_tokens') or 0), 'sortie': int(u.get('output_tokens') or 0)}
                source = 'sortie-agent'
            elif tours:
                tok = {c: sum(t[c] for t in tours) for c in ('entree', 'ecriture_cache', 'lecture_cache', 'sortie')}
                source = 'journal'
            else:
                tok, source = None, 'données absentes'
            modeles = sorted({t['modele'] for t in tours if t['modele']}) or ([u['model']] if u.get('model') else [])
            modele = modeles[0] if len(modeles) == 1 else (None if not modeles else 'plusieurs')
            # répartition 5 min / 1 h des écritures : du journal, s'il couvre exactement les écritures de la visite
            split = (sum(t['w5'] for t in tours), sum(t['w1'] for t in tours)) if tours and tok else None
            if split and sum(split) != tok['ecriture_cache']:
                split = None
            est, hyp = cout_estime(modele, v['started_at'], tok, split) if tok and modele != 'plusieurs' else (None, None)
            entrees = (tok['entree'] + tok['ecriture_cache'] + tok['lecture_cache']) if tok else 0
            dup = Counter(o for t in tours for o in t['outils'])
            rec.update({
                'modele': modele, 'session': tours[-1]['session'] if tours else (state.get('sessions') or {}).get(g.get('session') or ''),
                'tours': len(tours) if tours else None, 'source': source, 'tokens': tok,
                'cout_agent_usd': r6(u.get('cost_usd')) if u.get('cost_usd') is not None else None,
                'cout_estime_usd': est, 'cout_statut': 'estimé' if est is not None else ('coût inconnu' if tok else 'données absentes'),
                'hypothese': hyp,
                'cache': {'taux_reussite': r6(tok['lecture_cache'] / entrees) if tok and entrees else None,
                          'ecriture_perdue': ecriture_perdue(tours) if tours else None,
                          'definition_ecriture_perdue': 'provisoire, à valider'},
                'contexte': contexte(tours),
                'outils_repetes': {n: c - 1 for (n, _), c in sorted(dup.items()) if c > 1} if dup else {},
            })
        else:
            rec.update({'modele': None, 'session': None, 'tours': None, 'source': 'sans objet', 'tokens': None,
                        'cout_agent_usd': None, 'cout_estime_usd': None, 'cout_statut': 'sans objet', 'hypothese': None,
                        'cache': None, 'contexte': None, 'outils_repetes': {}})
            if rl == 'porte' and v.get('exit_code') not in (0, None):
                rec['regles'] = sorted(set(RULE.findall(v.get('stdout') or '')))
        rec['cause'] = cause(node, k, v, rl, tours)
        out.append(rec)
    meta = {'run': run_id, 'version': version, 'lot': lot, 'graphe': state.get('loop_name'),
            'statut': summary.get('exit_status') or ('en cours' if any(not v.get('ended_at') for _, _, v in seq) else 'inconnu'),
            'debut': state.get('started_at'), 'fin': summary.get('ended_at'),
            'empreinte': fps.get(run_id, 'inconnue')}
    return meta, out


# ─── agrégats (F6, F7, F8) ─────────────────────────────────────────────────────────────────────────────────────────

def cout(v):
    """Coût retenu d'une visite : estimé (grille), sinon celui que rapporte l'agent ; None si aucun."""
    return v['cout_estime_usd'] if v['cout_estime_usd'] is not None else v['cout_agent_usd']


def somme(vs):
    known = [cout(v) for v in vs if cout(v) is not None]
    return {'cout_usd': r6(sum(known)) if known else None, 'visites_sans_cout': sum(1 for v in vs if v['type'] == 'prompt' and cout(v) is None),
            'cout_estime_usd': r6(sum(v['cout_estime_usd'] for v in vs if v['cout_estime_usd'] is not None)) if any(v['cout_estime_usd'] is not None for v in vs) else None,
            'cout_agent_usd': r6(sum(v['cout_agent_usd'] for v in vs if v['cout_agent_usd'] is not None)) if any(v['cout_agent_usd'] is not None for v in vs) else None,
            'duree_ms': sum(v['duree_ms'] or 0 for v in vs), 'visites': len(vs),
            'visites_agent': sum(1 for v in vs if v['type'] == 'prompt'),
            'arbitrages': sum(1 for v in vs if v['role'] == 'arbitrage'),
            'reparations': sum(1 for v in vs if v['role'] == 'réparation')}


def iterations_avant_vert(vs):
    """F7 : visites de réparation et d'arbitrage avant le premier check-final vert ; None si jamais vert."""
    n = 0
    for v in vs:
        if v['noeud'] == 'check-final' and v['code_sortie'] == 0:
            return n
        if v['role'] in ('réparation', 'arbitrage'):
            n += 1
    return None


def gaspillage(vs):
    """F6 : appels d'outil identiques répétés, rebouclages porte rouge, réparation, même porte rouge à l'identique,
    arbitrages en série."""
    outils = sum(sum(v['outils_repetes'].values()) for v in vs)
    reboucle, serie = 0, 0
    for i, v in enumerate(vs):
        if v['role'] == 'porte' and v['code_sortie'] not in (0, None):
            j = i + 1
            while j < len(vs) and vs[j]['type'] == 'command' and vs[j]['role'] != 'porte':
                j += 1
            if j < len(vs) and vs[j]['role'] == 'réparation':
                nxt = next((w for w in vs[j + 1:] if w['noeud'] == v['noeud']), None)
                if nxt and nxt['code_sortie'] == v['code_sortie'] and nxt['empreinte_sortie'] == v['empreinte_sortie']:
                    reboucle += 1
        if v['role'] == 'arbitrage':
            prev = next((w for w in reversed(vs[:i]) if w['role'] in ('arbitrage', 'porte')), None)
            if prev and prev['role'] == 'arbitrage':
                serie += 1
    return {'appels_outil_repetes': outils, 'rebouclages_sans_changement': reboucle, 'arbitrages_en_serie': serie}


def centile(xs, p):
    xs = sorted(xs)
    return xs[max(0, min(len(xs) - 1, -(-p * len(xs) // 100) - 1))]


def estimation(runs):
    """F8 : fourchette par graphe sur les runs terminés comparables ; sous trois, « non estimable »."""
    par = defaultdict(list)
    for r in runs:
        if r['meta']['statut'] in ('ok', 'completed_with_failures') and r['total']['cout_usd'] is not None:
            par[r['meta']['graphe']].append(r)
    out = {}
    for g in sorted({r['meta']['graphe'] for r in runs}):
        rs = par.get(g, [])
        if len(rs) < 3:
            out[g] = {'statut': 'non estimable', 'versions_comparables': len(rs)}
            continue
        cs = [r['total']['cout_usd'] for r in rs]
        ds = [r['total']['duree_ms'] for r in rs]
        out[g] = {'statut': 'estimé', 'versions_comparables': len(rs), 'cout_median_usd': r6(statistics.median(cs)),
                  'cout_p80_usd': r6(centile(cs, 80)), 'duree_mediane_ms': statistics.median(ds), 'duree_p80_ms': centile(ds, 80)}
    return out


# ─── process (F10, F12, F13, F14) ──────────────────────────────────────────────────────────────────────────────────

def sante_portes(runs):
    """F10 : par porte, passages, rouges, coût et durée, réparation suivante ; jamais rouge, instable, tardive."""
    st = defaultdict(lambda: {'passages': 0, 'rouges': 0, 'duree_ms': 0, 'cout_reparation_usd': 0.0, 'versions': set(),
                              'suivants': Counter(), 'instabilites': 0, 'tardives': 0, 'tardive_apres': Counter()})
    durees = defaultdict(list)
    for r in runs:
        for v in r['visites']:
            if v['role'] == 'porte':
                durees[v['noeud']].append(v['duree_ms'] or 0)
    med = {k: statistics.median(x) for k, x in durees.items()}
    for r in runs:
        vs = r['visites']
        for i, v in enumerate(vs):
            if v['role'] != 'porte':
                continue
            s = st[v['noeud']]
            s['passages'] += 1
            s['duree_ms'] += v['duree_ms'] or 0
            s['versions'].add(r['meta']['version'])
            rouge = v['code_sortie'] not in (0, None)
            # instabilité : même porte rejouée sans visite d'agent entre deux, résultat différent
            prev = None
            for w in reversed(vs[:i]):
                if w['type'] == 'prompt':
                    break
                if w['noeud'] == v['noeud']:
                    prev = w
                    break
            if prev is not None and (prev['code_sortie'] == 0) != (v['code_sortie'] == 0):
                s['instabilites'] += 1
            if not rouge:
                continue
            s['rouges'] += 1
            nxt = next((w for w in vs[i + 1:] if w['type'] == 'prompt'), None)
            if nxt:
                s['suivants'][nxt['noeud']] += 1
                s['cout_reparation_usd'] += cout(nxt) or 0.0
            # tardive : depuis la dernière visite d'agent, une porte moins chère a laissé passer
            for w in reversed(vs[:i]):
                if w['type'] == 'prompt':
                    break
                if w['role'] == 'porte' and w['noeud'] != v['noeud'] and w['code_sortie'] == 0 and med.get(w['noeud'], 0) < med.get(v['noeud'], 0):
                    s['tardives'] += 1
                    s['tardive_apres'][w['noeud']] += 1
                    break
    out = {}
    for k in sorted(st):
        s = st[k]
        signaux = []
        if s['rouges'] == 0 and len(s['versions']) >= SEUILS['jamais_rouge']:
            signaux.append('jamais-rouge')
        if s['instabilites']:
            signaux.append('instable')
        if s['tardives'] >= SEUILS['tardive']:
            signaux.append('tardive')
        out[k] = {'passages': s['passages'], 'rouges': s['rouges'], 'taux_rouge': r6(s['rouges'] / s['passages']),
                  'duree_ms': s['duree_ms'], 'duree_mediane_ms': med.get(k), 'cout_reparation_suivante_usd': r6(s['cout_reparation_usd']),
                  'versions': len(s['versions']), 'reparation_suivante': s['suivants'].most_common(1)[0][0] if s['suivants'] else None,
                  'instabilites': s['instabilites'], 'tardives': s['tardives'],
                  'porte_moins_chere_passee': s['tardive_apres'].most_common(1)[0][0] if s['tardive_apres'] else None,
                  'signaux': signaux}
    return out


def points_chauds(runs):
    """F12 : nœuds et transitions classés par coût puis visites ; part du déterministe et des agents ; règles
    revenues en réparation."""
    noeuds, trans = defaultdict(lambda: [0.0, 0]), defaultdict(lambda: [0.0, 0])
    regles = Counter()
    det_rouges = agent_visites = 0
    for r in runs:
        vs = r['visites']
        for i, v in enumerate(vs):
            noeuds[v['noeud']][0] += cout(v) or 0.0
            noeuds[v['noeud']][1] += 1
            if i:
                t = f"{vs[i - 1]['noeud']} > {v['noeud']}"
                trans[t][0] += cout(v) or 0.0
                trans[t][1] += 1
            if v['role'] == 'porte' and v['code_sortie'] not in (0, None):
                det_rouges += 1
                nxt = next((w for w in vs[i + 1:] if w['type'] == 'prompt'), None)
                if nxt and nxt['role'] == 'réparation':
                    regles.update(v.get('regles') or [])
            if v['role'] in ('réparation', 'arbitrage'):
                agent_visites += 1
    rang = lambda d: [{'id': k, 'cout_usd': r6(c), 'visites': n} for k, (c, n) in sorted(d.items(), key=lambda x: (-x[1][0], -x[1][1], x[0]))]
    return {'noeuds': rang(noeuds)[:15], 'transitions': rang(trans)[:15],
            'repartition': {'rouges_attrapes_par_les_portes': det_rouges, 'visites_reparation_ou_arbitrage': agent_visites},
            'regles_candidates_porte_mecanique': [{'regle': k, 'retours_en_reparation': n} for k, n in sorted(regles.items(), key=lambda x: (-x[1], x[0])) if n > SEUILS['regle']]}


def comparaison_process(runs):
    """F14 : par empreinte de configuration, coût, itérations avant vert, taux de rouge des portes."""
    par = defaultdict(list)
    for r in runs:
        par[r['meta']['empreinte']].append(r)
    out = {}
    for fp in sorted(par):
        rs = par[fp]
        portes = [v for r in rs for v in r['visites'] if v['role'] == 'porte']
        its = [r['iterations_avant_vert'] for r in rs if r['iterations_avant_vert'] is not None]
        cs = [r['total']['cout_usd'] for r in rs if r['total']['cout_usd'] is not None]
        out[fp] = {'runs': len(rs), 'cout_moyen_usd': r6(statistics.fmean(cs)) if cs else None,
                   'iterations_avant_vert_moyennes': r6(statistics.fmean(its)) if its else None,
                   'taux_rouge_portes': r6(sum(1 for v in portes if v['code_sortie'] not in (0, None)) / len(portes)) if portes else None}
    return out


def propositions(portes, chauds, runs):
    """F13 : texte seul ; chaque proposition cite sa mesure ; décision humaine, retour arrière possible."""
    L = ['# Propositions de changement de process', '',
         f'Seuils provisoires (faute d\'historique) : boucle {SEUILS["boucle"]}, jamais rouge sur {SEUILS["jamais_rouge"]} versions, '
         f'tardive {SEUILS["tardive"]} fois, règle {SEUILS["regle"]} retours. Rien n\'est appliqué ; un retrait de porte ne se décide '
         'jamais sur la seule mesure : il passe par un essai à demande équivalente (comparaison d\'empreintes).', '']
    n = 0
    for k, p in portes.items():
        if 'instable' in p['signaux']:
            n += 1; L.append(f'{n}. Prioritaire : rendre `{k}` déterministe. Mesure : {p["instabilites"]} résultat(s) différent(s) sans visite d\'agent entre deux passages.')
    for k, p in portes.items():
        if 'tardive' in p['signaux']:
            n += 1; L.append(f'{n}. Avancer le contrôle de `{k}` ou en dupliquer la partie bon marché avant lui. Mesure : {p["tardives"]} rouge(s) juste après un passage vert de `{p["porte_moins_chere_passee"]}` (durée médiane {p["duree_mediane_ms"] / 1000:.0f} s contre {portes[p["porte_moins_chere_passee"]]["duree_mediane_ms"] / 1000:.0f} s).')
    for k, p in portes.items():
        if 'jamais-rouge' in p['signaux']:
            n += 1; L.append(f'{n}. Examiner `{k}` : durcir, ou élaguer après essai. Mesure : 0 rouge en {p["passages"]} passages sur {p["versions"]} versions ; une porte qui ne rougit jamais peut être celle qui garantit l\'absence de rouge.')
    boucles = Counter(v['noeud'] for r in runs for v in r['visites'] if v['cause'] == 'boucle-réparation')
    for k, c in sorted(boucles.items(), key=lambda x: (-x[1], x[0])):
        n += 1; L.append(f'{n}. Abaisser le nombre de visites permis à `{k}`, ou traiter la cause en amont. Mesure : {c} visite(s) au-delà de {SEUILS["boucle"]}.')
    for x in chauds['regles_candidates_porte_mecanique']:
        n += 1; L.append(f'{n}. Ajouter une porte mécanique pour `{x["regle"]}`. Mesure : {x["retours_en_reparation"]} retours en réparation.')
    if not n:
        L.append('Aucune proposition : aucun signal au-dessus des seuils.')
    return '\n'.join(L) + '\n'


# ─── F11 ───────────────────────────────────────────────────────────────────────────────────────────────────────────

NORMALISE = [(re.compile(r'\b\d+(\.\d+)?\s?(ms|s|m)\b'), '<durée>'), (re.compile(r'\d{4}-\d\d-\d\dT[\d:.]+Z?'), '<date>'),
             (re.compile(r'\b\d\d:\d\d(:\d\d)?\b'), '<heure>'), (re.compile(r'pid \d+'), 'pid <n>')]


def determinisme(node, loop):
    import yaml
    c = yaml.safe_load(open(loop, encoding='utf-8'))
    cmd = (c['nodes'].get(node) or {}).get('cmd')
    if not cmd:
        print(f'{node} : pas une commande de {loop}')
        return 2
    etat = lambda: subprocess.run('git rev-parse HEAD; git status --porcelain; git diff | sha256sum', shell=True, cwd=ROOT, capture_output=True, text=True).stdout
    e0, res = etat(), []
    for _ in range(2):
        p = subprocess.run(['bash', '-c', cmd], cwd=ROOT, capture_output=True, text=True)
        out = p.stdout + p.stderr
        for rx, rep in NORMALISE:
            out = rx.sub(rep, out)
        res.append((p.returncode, hashlib.sha256(out.encode()).hexdigest()[:12]))
    anomalies = []
    if etat() != e0:
        anomalies.append('la porte modifie l\'arbre de travail (non idempotente)')
    if res[0][0] != res[1][0]:
        anomalies.append(f'codes différents : {res[0][0]} puis {res[1][0]}')
    elif res[0][1] != res[1][1]:
        anomalies.append('sorties différentes à durées et dates près')
    for a in anomalies:
        print(f'ANOMALIE DE PROCESS {node} : {a}')
    print(f'determinisme {node} : {"anomalie" if anomalies else "stable"} (code {res[0][0]}, sortie {res[0][1]})')
    return 1 if anomalies else 0


# ─── persistance (point 2) ─────────────────────────────────────────────────────────────────────────────────────────

BRANCHE = opt('--branche', 'cuisine/couts')


def git(*a, inp=None, env=None):
    return subprocess.run(['git', *a], cwd=ROOT, input=inp, capture_output=True, text=True, env={**os.environ, **(env or {})})


def ref_archive():
    for ref in (f'refs/heads/{BRANCHE}', f'refs/remotes/origin/{BRANCHE}'):
        if git('rev-parse', '-q', '--verify', ref).returncode == 0:
            return ref
    return None


def runs_archives(locaux):
    """Runs archivés absents de la machine (machine neuve à chaque session) : ils calibrent F8 et F14."""
    ref = ref_archive()
    if not ref:
        return []
    out = []
    for f in git('ls-tree', '--name-only', f'{ref}:couts').stdout.split():
        rid = f[:-5] if f.endswith('.json') else None
        if rid and rid not in locaux:
            try:
                r = json.loads(git('show', f'{ref}:couts/{f}').stdout)
                r['meta']['archive'] = True
                out.append(r)
            except ValueError:
                pass
    return out


def archiver():
    import tempfile
    files = sorted(glob.glob(os.path.join(SORTIE, 'couts', '*.json')))
    if not files:
        print('archiver : aucun résultat ; lancer d\'abord couts.py')
        return 2
    idx = tempfile.NamedTemporaryFile(delete=False).name
    os.remove(idx)
    env = {'GIT_INDEX_FILE': idx}
    parent = git('rev-parse', '-q', '--verify', f'refs/heads/{BRANCHE}').stdout.strip() or None
    base = parent or (git('rev-parse', '-q', '--verify', f'refs/remotes/origin/{BRANCHE}').stdout.strip() or None)
    if base:
        git('read-tree', base, env=env)
    for f in files + [os.path.join(SORTIE, 'couts.json'), os.path.join(SORTIE, 'couts-propositions.md')]:
        if not os.path.exists(f):
            continue
        blob = git('hash-object', '-w', f).stdout.strip()
        dest = ('couts/' + os.path.basename(f)) if os.path.dirname(f).endswith('couts') else os.path.basename(f)
        git('update-index', '--add', '--cacheinfo', f'100644,{blob},{dest}', env=env)
    tree = git('write-tree', env=env).stdout.strip()
    os.path.exists(idx) and os.remove(idx)
    if base and git('rev-parse', f'{base}^{{tree}}').stdout.strip() == tree:
        print(f'archiver : {BRANCHE} déjà à jour')
        return 0
    args = ['commit-tree', tree, '-m', f'couts : {len(files)} run(s) mesurés'] + (['-p', base] if base else [])
    c = git(*args, env={'GIT_AUTHOR_NAME': 'cuisine', 'GIT_AUTHOR_EMAIL': 'cuisine@local', 'GIT_COMMITTER_NAME': 'cuisine', 'GIT_COMMITTER_EMAIL': 'cuisine@local'}).stdout.strip()
    git('update-ref', f'refs/heads/{BRANCHE}', c)
    print(f'archiver : {BRANCHE} = {c[:7]} ({len(files)} run(s)) ; publier : git push origin {BRANCHE}')
    return 0


# ─── principal ─────────────────────────────────────────────────────────────────────────────────────────────────────

def dump(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as fh:
        json.dump(data, fh, ensure_ascii=False, indent=1, sort_keys=True)
        fh.write('\n')


def main():
    if ARGS[:1] == ['empreinte']:
        print(empreinte())
        return 0
    if ARGS[:1] == ['archiver']:
        return archiver()
    if ARGS[:1] == ['determinisme'] and len(ARGS) >= 2:
        return determinisme(ARGS[1], opt('-c', os.path.join(ROOT, '.cuisine', 'cuisine.loop.yaml')))
    graphs = graphes()
    tours = journal_tours()
    fps = {}
    for f in glob.glob(os.path.join(SORTIE, 'empreintes', '*')):
        fps[os.path.basename(f)] = open(f).read().strip()
    runs = []
    for d in sorted(glob.glob(os.path.join(RUNS, '*'))):
        if not os.path.exists(os.path.join(d, 'state.json')):
            continue
        meta, vs = visites_run(d, graphs, tours, fps)
        r = {'meta': meta, 'visites': vs, 'total': somme(vs), 'iterations_avant_vert': iterations_avant_vert(vs),
             'gaspillage': gaspillage(vs),
             'causes': {c: n for c, n in sorted(Counter(v['cause'] for v in vs).items())},
             'donnees': 'absentes' if vs and all(v['source'] in ('données absentes', 'sans objet') for v in vs) else 'présentes'}
        runs.append(r)
        dump(os.path.join(SORTIE, 'couts', f'{meta["run"]}.json'), r)
    runs += runs_archives({r['meta']['run'] for r in runs})
    runs.sort(key=lambda r: r['meta']['run'])
    lab = lambda v, key: v.get(key) or ('commandes' if key == 'agent' else '—')
    par = lambda key: {k: somme([v for r in runs for v in r['visites'] if lab(v, key) == k])
                       for k in sorted({lab(v, key) for r in runs for v in r['visites']})}
    portes = sante_portes(runs)
    chauds = points_chauds(runs)
    agregat = {'seuils_provisoires': SEUILS, 'grille': os.path.relpath(TARIFS, ROOT), 'lignes_de_grille': len(tarifs()),
               'runs': {r['meta']['run']: {**r['meta'], **r['total'], 'iterations_avant_vert': r['iterations_avant_vert'],
                                           'gaspillage': r['gaspillage'], 'causes': r['causes'], 'donnees': r['donnees']} for r in runs},
               'par_agent': par('agent'), 'par_lot': par('lot'), 'par_version': par('version'),
               'estimation': estimation(runs), 'portes': portes, 'points_chauds': chauds, 'process': comparaison_process(runs)}
    dump(os.path.join(SORTIE, 'couts.json'), agregat)
    with open(os.path.join(SORTIE, 'couts-propositions.md'), 'w', encoding='utf-8') as fh:
        fh.write(propositions(portes, chauds, runs))
    v = opt('--version')
    sel = [r for r in runs if not v or r['meta']['version'] == v]
    for r in sel:
        t = r['total']
        c = f'{t["cout_usd"]:.2f} $' if t['cout_usd'] is not None else 'coût inconnu'
        print(f'{r["meta"]["run"]:<42} {c:>13}  {t["duree_ms"] / 60000:6.1f} min  {t["visites_agent"]:>3} visites d\'agent  '
              f'itérations avant vert : {r["iterations_avant_vert"] if r["iterations_avant_vert"] is not None else "jamais vert"}  '
              f'({t["visites_sans_cout"]} sans coût ; données {r["donnees"]})')
    sig = [f'{k} : {", ".join(p["signaux"])}' for k, p in portes.items() if p['signaux']]
    print(f'couts: {len(runs)} run(s), {sum(len(r["visites"]) for r in runs)} visite(s) ; portes signalées : {"; ".join(sig) or "aucune"}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
