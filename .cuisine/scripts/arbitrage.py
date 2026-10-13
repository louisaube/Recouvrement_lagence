#!/usr/bin/env python3
"""Étape d'arbitrage révisable de la cuisine. Scripts sans modèle : l'agent rédige les questions, ce script juge.

  arbitrage.py check        [version]          valide questions.yaml (schéma, options distinctes, identifiants libres)
  arbitrage.py renumber     [version] Q-ANCIEN Q-NOUVEAU   renumérote une question de la version dans ses seuls fichiers
  arbitrage.py filter       [version]          retient 5 groupes au plus, applique le défaut aux autres, écrit questions-retenues.md
  arbitrage.py wait         [version]          code 0 si chaque question retenue a une décision active, sinon EN ATTENTE
  arbitrage.py show         [version]          affiche les questions retenues (situation, options, coût, défaut)
  arbitrage.py arbitre      [version] "A/B/B"  inscrit les réponses dans l'ordre affiché ; « defaut » applique tous les défauts
  arbitrage.py check-spec   [version]          chaque règle liée à une décision active porte « decision D-xxxx »
  arbitrage.py check-tests  [version]          chaque décision observable a son test [D-xxxx] (route et attendu de l'option choisie)
  arbitrage.py append-only  [git-ref]          aucune ligne du registre n'a disparu ni changé depuis git-ref (défaut HEAD)
  arbitrage.py revise       Q-ID CHOIX "motif" ajoute une décision, calcule l'impact, écrit la demande de version de correction
  arbitrage.py metrics      [version]          mesures de la version (questions produites, retenues, contredites, révisions)

Version : argument, sinon .cuisine-run/version. Questions : specifications/<module>/implementation-plans/<version>/questions.yaml.
Registre : specifications/<module>/arbitrages.yaml, en ajout seul (seul `statut` passe de active à revisee, avec `remplacee_par`).
"""
import datetime, glob, hashlib, json, os, re, subprocess, sys
import yaml

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
os.chdir(ROOT)
MAX_GROUPES = 5
# v1 : une question qui touche la sécurité ou les données personnelles revient toujours au propriétaire
SENSIBLE = re.compile(r'\bauth|password|mot[- ]de[- ]passe|token|jeton|session|permission|credential|login|connexion|'
                      r'\brole\b|\br[ôo]le\b|rgpd|gdpr|donn[ée]es personnelles|e-?mail', re.I)


def die(msg, code=2):
    print(msg, file=sys.stderr)
    sys.exit(code)


def version_of(args):
    if args and not args[0].startswith('Q-'):
        return args.pop(0)
    try:
        return open('.cuisine-run/version').read().strip()
    except OSError:
        die('version inconnue : argument ou .cuisine-run/version')


def question_files(version):
    return sorted(glob.glob(f'specifications/*/implementation-plans/{version}/questions.yaml'))


def module_of(path):
    return path.split(os.sep)[1]


def load_questions(version):
    out = []
    for f in question_files(version):
        data = yaml.safe_load(open(f, encoding='utf-8')) or []
        if not isinstance(data, list):
            die(f'{f} : une liste de questions est attendue')
        for q in data:
            q['_fichier'], q['_module'] = f, module_of(f)
            out.append(q)
    return out


def all_questions():
    """Toutes les questions de toutes les versions (pour retrouver une question à réviser)."""
    out = {}
    for f in sorted(glob.glob('specifications/*/implementation-plans/*/questions.yaml')):
        for q in yaml.safe_load(open(f, encoding='utf-8')) or []:
            q['_fichier'], q['_module'] = f, module_of(f)
            out[q['id']] = q
    return out


def registry_path(module):
    return f'specifications/{module}/arbitrages.yaml'


def load_registry(module=None):
    paths = [registry_path(module)] if module else sorted(glob.glob('specifications/*/arbitrages.yaml'))
    out = []
    for p in paths:
        if os.path.exists(p):
            for d in yaml.safe_load(open(p, encoding='utf-8')) or []:
                d['_module'] = p.split(os.sep)[1]
                out.append(d)
    return out


def save_registry(module, entries):
    clean = [{k: v for k, v in d.items() if not k.startswith('_')} for d in entries]
    with open(registry_path(module), 'w', encoding='utf-8') as fh:
        fh.write('# Registre des arbitrages (ajout seul). Écrit par `cuisine arbitre` et `cuisine revise`, jamais à la main par un agent.\n')
        yaml.safe_dump(clean, fh, allow_unicode=True, sort_keys=False, width=200)


def next_decision_id():
    nums = [int(d['decision'][2:]) for d in load_registry() if re.match(r'^D-\d+$', str(d.get('decision', '')))]
    return f'D-{(max(nums) if nums else 0) + 1:04d}'


def active(question_id, registry=None):
    for d in registry if registry is not None else load_registry():
        if d.get('question') == question_id and d.get('statut') == 'active':
            return d
    return None


def oui(v):
    return str(v).strip().lower() in ('oui', 'yes', 'true')


def normalise(q):
    """Champs dérivés par le script, jamais crus sur parole : effet sur la recette et décideur."""
    opts = q.get('options') or []
    attendus = {str((o.get('test') or {}).get('attendu', '')).strip() for o in opts}
    observable = oui(q.get('observable'))
    # une question observable dont les options n'attendent pas la même chose change la recette, quoi qu'en dise l'agent
    q['_effet'] = True if observable and len(attendus) > 1 else oui(q.get('effet_recette'))
    texte = ' '.join([q.get('titre', ''), ' '.join(q.get('regles') or [])])
    q['_sensible'] = bool(SENSIBLE.search(texte))
    # Règle B (arbitrage du 9 octobre) : le propriétaire est imposé seulement si la question touche la sécurité ou les
    # données personnelles, qu'une de ses règles a été déduite par la cuisine (inferred), et que le défaut affaiblit un
    # contrôle : son test accepte (2xx) là où une autre option refuse (4xx). Tout est lu dans les fichiers, sans modèle.
    q['_affaiblit'] = default_is_permissive(q)
    q['_deduite'] = any(PROVENANCE[r] == 'inferred' for r in q.get('regles') or [])
    q['_force'] = q['_sensible'] and q['_deduite'] and q['_affaiblit']
    q['_decideur'] = 'proprietaire' if q['_force'] else str(q.get('decideur', 'proprietaire'))
    return q


def status_class(attendu):
    m = re.search(r'\b([1-5])\d\d\b', str(attendu or ''))
    return m.group(1) if m else None


def default_is_permissive(q):
    if not oui(q.get('observable')):
        return False
    opts = {o['code']: status_class((o.get('test') or {}).get('attendu')) for o in q.get('options') or []}
    d = opts.get(q.get('defaut'))
    return d == '2' and any(c == '4' for k, c in opts.items() if k != q.get('defaut'))


def provenances():
    """Provenance de chaque règle, lue sur sa définition « `rule-…` (inferred, …) » dans les spécifications."""
    out = {}
    for f in glob.glob('specifications/**/*.md', recursive=True):
        for m in re.finditer(r'`(rule-[a-z0-9-]+)`\s*\((user|inferred|excel|code)\b', open(f, encoding='utf-8', errors='replace').read()):
            out.setdefault(m.group(1), set()).add(m.group(2))
    return {r: ('inferred' if 'inferred' in p else sorted(p)[0]) for r, p in out.items()}


class _Lazy(dict):
    def __missing__(self, key):
        if not self.get('__loaded__'):
            self.update(provenances()); self['__loaded__'] = True
            return self.get(key)
        return None


PROVENANCE = _Lazy()


# ─── check ──────────────────────────────────────────────────────────────
def cmd_check(args):
    version = version_of(args)
    files = question_files(version)
    if not files:
        print(f'aucune question pour {version} : rien à arbitrer')
        return 0
    errors, seen = [], set()
    known_rules = set(re.findall(r'rule-[a-z0-9]+(?:-[a-z0-9]+)+', subprocess.run(
        ['grep', '-rhoE', r'rule-[a-z0-9]+(-[a-z0-9]+)+', 'specifications', '--include=*.md'], capture_output=True, text=True).stdout))
    for q in load_questions(version):
        qid = q.get('id', '?')
        err = lambda m: errors.append(f'{q["_fichier"]} {qid} : {m}')
        if not re.match(r'^Q-[A-Z0-9]+-\d+$', str(qid)):
            err('id attendu de la forme Q-<MODULE>-<n>')
        if qid in seen:
            err('id en double')
        seen.add(qid)
        for k in ('titre', 'regles', 'observable', 'decideur', 'options', 'defaut'):
            if k not in q:
                err(f'champ « {k} » manquant')
        if q.get('decideur') not in ('proprietaire', 'defaut'):
            err('decideur : proprietaire ou defaut')
        if str(q.get('observable')) not in ('oui', 'non'):
            err('observable : oui ou non')
        regles = q.get('regles') or []
        if not regles:
            err('aucune règle liée')
        for r in regles:
            if r not in known_rules:
                err(f'règle {r} absente des spécifications')
        opts = q.get('options') or []
        if len(opts) < 2:
            err('deux options au moins')
        codes = [o.get('code') for o in opts]
        if len(set(codes)) != len(codes) or not all(re.match(r'^[A-Z]$', str(c)) for c in codes):
            err('codes d\'option : lettres majuscules distinctes')
        if q.get('defaut') not in codes:
            err('le défaut doit être l\'un des codes')
        for o in opts:
            for k in ('libelle', 'cout', 'resultat'):
                if not o.get(k):
                    err(f'option {o.get("code")} : « {k} » manquant')
            if o.get('cout') not in ('leger', 'lourd'):
                err(f'option {o.get("code")} : cout leger ou lourd')
        resultats = [str(o.get('resultat', '')).strip() for o in opts]
        if len(set(resultats)) != len(resultats):
            err('deux options ont le même résultat : la question ne départage rien')
        if str(q.get('observable')) == 'oui':
            if not q.get('situation'):
                err('question observable sans « situation »')
            tests = [o.get('test') or {} for o in opts]
            for o, t in zip(opts, tests):
                if not all(t.get(k) for k in ('route', 'entree', 'attendu')):
                    err(f'option {o.get("code")} : test incomplet (route, entree, attendu)')
            attendus = [str(t.get('attendu', '')).strip() for t in tests]
            if len(set(attendus)) != len(attendus):
                err('deux options ont le même test.attendu : la recette ne les distingue pas')
        elif any(o.get('test') for o in opts):
            err('question non observable : pas de « test »')
    # Un identifiant de question est unique dans tout le dépôt : repris d'une autre version, la question hériterait en
    # silence de la décision de l'autre (filter n'inscrirait pas son défaut, wait la croirait tranchée, check-spec
    # exigerait la décision étrangère sur ses règles).
    others = taken_ids(exclude=version)
    clashes = [q for q in load_questions(version) if qkey(q.get('id')) in others]
    for module in sorted({qkey(q['id'])[0] for q in clashes}):
        mine = [q for q in clashes if qkey(q['id'])[0] == module]
        for q, new in zip(mine, free_ids(module, len(mine))):
            other_id, other_v = others[qkey(q['id'])]
            errors.append(f'{q["_fichier"]} {q["id"]} : identifiant déjà pris par la version {other_v} ({other_id}) ; le remplacer '
                          f'par {new} dans tous les fichiers de cette version : python3 .cuisine/scripts/arbitrage.py renumber '
                          f'{version} {q["id"]} {new}')
    for e in errors:
        print('QUESTIONS', e)
    print(f'questions: {len(seen)} question(s), {len(errors)} défaut(s) de forme')
    return 1 if errors else 0


QID = re.compile(r'^Q-([A-Z0-9]+)-(\d+)$')


def qkey(qid):
    """(module, numéro) d'un identifiant Q-<MODULE>-<n>, None sinon ; Q-PLAT-9 et Q-PLAT-09 désignent la même question."""
    m = QID.match(str(qid or ''))
    return (m.group(1), int(m.group(2))) if m else None


def origin_version(d, registry):
    """Version qui a posé la question d'une décision : les révisions (`remplace`) renvoient à la décision d'origine."""
    by_id = {x.get('decision'): x for x in registry}
    seen = set()
    while d.get('remplace') in by_id and d.get('decision') not in seen:
        seen.add(d.get('decision'))
        d = by_id[d['remplace']]
    return d.get('version')


def taken_ids(exclude=None):
    """Identifiants de question déjà posés (clé qkey) : (identifiant, version) pour les questions.yaml de toutes les versions
    et pour le registre (version d'origine de chaque décision), hors la version `exclude`."""
    out = {}
    for f in sorted(glob.glob('specifications/*/implementation-plans/*/questions.yaml')):
        v = f.split(os.sep)[3]
        if v == exclude:
            continue
        for q in yaml.safe_load(open(f, encoding='utf-8')) or []:
            k = qkey(q.get('id')) if isinstance(q, dict) else None
            if k:
                out.setdefault(k, (q['id'], v))
    reg = load_registry()
    for d in reg:
        k, v = qkey(d.get('question')), origin_version(d, reg)
        if k and v != exclude:
            out.setdefault(k, (d['question'], v))
    return out


def free_ids(module, n=1):
    """Les n premiers identifiants libres du module, au-delà du plus grand numéro posé (toutes versions et registre)."""
    top = max([num for m, num in taken_ids() if m == module] or [0])
    return [f'Q-{module}-{top + i:02d}' for i in range(1, n + 1)]


def foreign_decisions(version):
    """Questions de la version dont l'identifiant porte la décision active d'une autre version : (question, décision, version)."""
    reg = load_registry()
    out = []
    for q in load_questions(version):
        d = active(q.get('id'), reg)
        if d and origin_version(d, reg) != version:
            out.append((q, d, origin_version(d, reg)))
    return out


def cmd_renumber(args):
    """Remplace l'identifiant d'une question de la version dans les fichiers de ses dossiers de plans, et nulle part ailleurs."""
    version = version_of(args)
    if len(args) != 2:
        die('Usage : arbitrage.py renumber [version] Q-ANCIEN Q-NOUVEAU')
    old, new = args
    if old not in {q.get('id') for q in load_questions(version)}:
        die(f'{old} n\'est pas une question de {version}')
    if not qkey(new) or qkey(new)[0] != qkey(old)[0]:
        die(f'{new} : identifiant Q-<MODULE>-<n> du même module que {old} attendu')
    if qkey(new) in taken_ids():
        die(f'{new} est déjà pris (questions d\'une version ou registre) ; libre : {free_ids(qkey(old)[0])[0]}')
    reg = load_registry()
    if any(d.get('question') == old and origin_version(d, reg) == version for d in reg):
        die(f'{old} porte déjà une décision inscrite pour {version} : la renuméroter romprait son lien avec le registre')
    changed = []
    for folder in sorted(glob.glob(f'specifications/*/implementation-plans/{version}')):
        for f in sorted(glob.glob(os.path.join(folder, '**', '*'), recursive=True)):
            if not os.path.isfile(f) or not f.endswith(('.yaml', '.yml', '.md')):
                continue
            text = open(f, encoding='utf-8').read()
            fixed = re.sub(rf'\b{re.escape(old)}\b', new, text)
            if fixed != text:
                open(f, 'w', encoding='utf-8').write(fixed)
                changed.append(f)
    for f in changed:
        print(f'renuméroté {old} en {new} : {f}')
    print(f'Ensuite : arbitrage.py check {version}, puis arbitrage.py filter {version} (inscrit le défaut de {new} '
          f'si la question ne revient pas au propriétaire)')
    return 0


# ─── filter ─────────────────────────────────────────────────────────────
def groups_of(questions):
    """Regroupe les questions qui partagent une règle (union-find)."""
    parent = {q['id']: q['id'] for q in questions}

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x
    owner = {}
    for q in questions:
        for r in q.get('regles') or []:
            if r in owner:
                parent[find(q['id'])] = find(owner[r])
            else:
                owner[r] = q['id']
    groups = {}
    for q in questions:
        groups.setdefault(find(q['id']), []).append(q)
    out = list(groups.values())
    out.sort(key=lambda g: (-len({r for q in g for r in q.get('regles') or []}), min(q['id'] for q in g)))
    return out


def retained_path(version, module):
    return f'specifications/{module}/implementation-plans/{version}/questions-retenues.md'


def cmd_filter(args):
    version = version_of(args)
    qs = [normalise(q) for q in load_questions(version)]
    # Veto de la règle B : une question imposée au propriétaire est toujours retenue, hors plafond de cinq et quel que
    # soit l'ordre des questions ; le plafond ne s'applique qu'aux autres. Groupes et classement ne dépendent que des
    # règles et des identifiants, jamais de l'ordre du fichier.
    candidats = sorted([q for q in qs if q['_effet'] and q['_decideur'] == 'proprietaire'], key=lambda q: q['id'])
    groupes = groups_of(candidats)
    veto = [g for g in groupes if any(q['_force'] for q in g)]
    libres = [g for g in groupes if g not in veto]
    retenus = veto + libres[:MAX_GROUPES]
    debordes = [q for g in libres[MAX_GROUPES:] for q in g]
    retenus_ids = [q['id'] for g in retenus for q in g]
    collisions = foreign_decisions(version)
    if collisions:
        for q, d, v in collisions:
            print(f'COLLISION {q["id"]} : identifiant déjà tranché pour la version {v} ({d["decision"]}) ; renuméroter la question '
                  f'de {version} (arbitrage.py renumber {version} {q["id"]} {free_ids(qkey(q["id"])[0])[0]}), puis relancer filter')
        return 1
    today = datetime.date.today().isoformat()
    par_module = {}
    for q in qs:
        par_module.setdefault(q['_module'], []).append(q)
    appliques = []
    for module, mqs in par_module.items():
        reg = load_registry(module)
        for q in mqs:
            if q['id'] in retenus_ids or active(q['id'], reg):
                continue
            d = {'decision': None, 'question': q['id'], 'choix': q['defaut'], 'date': today, 'statut': 'active',
                 'choix_par': 'defaut', 'version': version,
                 'motif': 'hors périmètre du propriétaire' if q not in debordes else 'au-delà des cinq questions retenues'}
            d['decision'] = next_decision_id_with(reg)
            reg.append(d)
            appliques.append(q['id'])
        save_registry(module, reg)
    etat = {'version': version, 'groupes': [[q['id'] for q in g] for g in retenus],
            'produites': len(qs), 'retenues': len(retenus_ids), 'debordees': [q['id'] for q in debordes],
            # filter peut être relancé (renumérotation) : le compte vient du registre, pas de ce seul passage
            'par_defaut': len([d for d in load_registry() if d.get('version') == version and d.get('choix_par') == 'defaut']),
            'forcees_proprietaire': [q['id'] for q in qs if q['_force'] and q.get('decideur') == 'defaut'],
            'effet_force': [q['id'] for q in qs if q['_effet'] and not oui(q.get('effet_recette'))],
            # veto de la règle B : chaque question sécurité ou données personnelles non remontée, avec la condition qui l'a écartée
            'securite_ecartees': [{'id': q['id'], 'titre': q.get('titre', ''), 'raison': veto_reason(q)}
                                  for q in qs if q['_sensible'] and q['id'] not in retenus_ids]}
    os.makedirs('.cuisine-run', exist_ok=True)
    json.dump(etat, open(f'.cuisine-run/questions-{version}.json', 'w'), ensure_ascii=False, indent=1)
    if qs:
        md = render(version, retenus, etat)
        with open(retained_path(version, qs[0]['_module']), 'w', encoding='utf-8') as fh:
            fh.write(md)
    print(f'filtre: {len(qs)} produite(s), {len(retenus_ids)} retenue(s) en {len(retenus)} groupe(s), {len(appliques)} tranchée(s) par défaut'
          + (f', {len(debordes)} au-delà de cinq' if debordes else ''))
    for g in retenus:
        print('RETENUE ' + ' + '.join(q['id'] for q in g))
    return 0


def veto_reason(q):
    if not oui(q.get('observable')):
        return 'non observable par l\'API : le défaut ne peut pas être jugé permissif'
    if not q['_deduite']:
        return 'règles fixées par le propriétaire (user), aucune déduite par la cuisine'
    if not q['_affaiblit']:
        return 'le défaut n\'affaiblit aucun contrôle (il ne passe pas d\'un refus 4xx à une acceptation 2xx)'
    return 'condition inconnue'


def next_decision_id_with(extra):
    nums = [int(d['decision'][2:]) for d in load_registry() + extra if re.match(r'^D-\d+$', str(d.get('decision') or ''))]
    return f'D-{(max(nums) if nums else 0) + 1:04d}'


def render(version, groupes, etat):
    lines = [f'# Questions retenues pour {version}', '',
             f'{etat["produites"]} questions produites ; {etat["retenues"]} retenues pour le propriétaire ; '
             f'{etat["par_defaut"]} tranchées par défaut et inscrites au registre.', '']
    n = 0
    for g in groupes:
        if len(g) > 1:
            lines += [f'## Groupe {" + ".join(q["id"] for q in g)} (règles communes)', '']
        for q in g:
            n += 1
            lines += [f'### {n}. {q["id"]} : {q["titre"]}', '']
            if q.get('situation'):
                lines += [f'Situation : {q["situation"]}', '']
            for o in q['options']:
                defaut = ' (défaut)' if o['code'] == q['defaut'] else ''
                ouvre = f' Questions ouvertes : {", ".join(o["ouvre"])}.' if o.get('ouvre') else ''
                lines.append(f'- **{o["code"]}{defaut}. {o["libelle"]}.** {o["resultat"]} Coût : {o["cout"]}.{ouvre}')
            lines.append('')
    if not n:
        lines.append('Aucune question ne revient au propriétaire.')
    else:
        lines += ['Répondre dans l\'ordre : `cuisine arbitre "' + '/'.join('?' * n) + '"` ou `cuisine arbitre defaut`.']
    return '\n'.join(lines) + '\n'


def displayed(version):
    try:
        etat = json.load(open(f'.cuisine-run/questions-{version}.json'))
    except OSError:
        die(f'pas de filtre pour {version} : lancer d\'abord la fabrication')
    qs = {q['id']: q for q in load_questions(version)}
    return etat, [qs[i] for g in etat['groupes'] for i in g]


# ─── wait / show / arbitre ──────────────────────────────────────────────
def cmd_wait(args):
    version = version_of(args)
    _, ordre = displayed(version)
    reg = load_registry()
    manquent = [q['id'] for q in ordre if not active(q['id'], reg)]
    if manquent:
        print(f'EN ATTENTE : {len(manquent)} question(s) pour le propriétaire ({", ".join(manquent)}). '
              'Voir `cuisine questions`, répondre par `cuisine arbitre`.')
        return 1
    print('ARBITRAGE COMPLET')
    return 0


def cmd_show(args):
    version = version_of(args)
    etat, ordre = displayed(version)
    qs = {q['id']: q for q in ordre}
    print(render(version, [[qs[i] for i in g] for g in etat['groupes']], etat))
    return 0


def cmd_arbitre(args):
    version = version_of(args)
    if not args:
        die('Usage : arbitrage.py arbitre [version] "A/B/B" | defaut')
    _, ordre = displayed(version)
    reponses = [q['defaut'] for q in ordre] if args[0].strip().lower() in ('defaut', 'défaut') else [r.strip().upper() for r in args[0].split('/')]
    if len(reponses) != len(ordre):
        die(f'{len(ordre)} réponse(s) attendue(s), {len(reponses)} reçue(s)')
    today = datetime.date.today().isoformat()
    for q, r in zip(ordre, reponses):
        if r not in [o['code'] for o in q['options']]:
            die(f'{q["id"]} : « {r} » n\'est pas une option')
        reg = load_registry(q['_module'])
        if active(q['id'], reg):
            die(f'{q["id"]} a déjà une décision active : utiliser `cuisine revise`')
        reg.append({'decision': next_decision_id_with(reg), 'question': q['id'], 'choix': r, 'date': today, 'statut': 'active',
                    'choix_par': 'proprietaire', 'version': version, 'defaut_propose': q['defaut']})
        save_registry(q['_module'], reg)
        print(f'{reg[-1]["decision"]} {q["id"]} = {r}' + ('' if r == q['defaut'] else ' (contre le défaut)'))
    return 0


# ─── check-spec / check-tests ───────────────────────────────────────────
def decisions_of(version):
    """Décisions actives de la version : celles de ses questions, et celles qu'elle porte (version de correction)."""
    qs = {q['id']: q for q in load_questions(version)}
    allq = None
    out = []
    reg = load_registry()
    for d in reg:
        if d.get('statut') != 'active':
            continue
        if d.get('question') in qs:
            if origin_version(d, reg) == version:   # sinon identifiant repris d'une autre version : foreign_decisions()
                out.append((d, qs[d['question']]))
        elif d.get('version') == version:
            allq = allq or all_questions()
            if d.get('question') in allq:
                out.append((d, allq[d['question']]))
    return out


def spec_lines():
    out = []
    for f in glob.glob('specifications/**/*.md', recursive=True):
        if f.endswith('questions-retenues.md') or os.path.basename(f).startswith('impact-'):
            continue
        out += [(f, l) for l in open(f, encoding='utf-8', errors='replace')]
    return out


def cmd_check_spec(args):
    version = version_of(args)
    # les plans des versions passées sont de l'histoire : seuls comptent les textes vivants et les plans de cette version
    lines = [(f, l) for f, l in spec_lines() if '/implementation-plans/' not in f or f'/implementation-plans/{version}/' in f]
    faults, n = [], 0
    for q, d, v in foreign_decisions(version):
        faults.append(f'{q["id"]} : identifiant déjà tranché pour la version {v} ({d["decision"]}) ; la question de cette version '
                      f'n\'a aucune décision. Opérateur : arbitrage.py renumber {version} {q["id"]} {free_ids(qkey(q["id"])[0])[0]}, '
                      f'puis arbitrage.py filter {version}')
    for d, q in decisions_of(version):
        for r in q.get('regles') or []:
            n += 1
            # la définition de la règle (titre « ### `rule-…` ») porte la décision ; à défaut de titre, une mention suffit
            # définition = l'identifiant suivi de sa provenance, « `rule-…` (inferred, …) », en titre ou en liste
            defs = [(f, l) for f, l in lines if re.search(rf'`?{r}`?\s*\((?:user|inferred|excel|code)\b', l)] or [(f, l) for f, l in lines if r in l]
            untagged = sorted({f for f, l in defs if not re.search(rf'decision {d["decision"]}\b', l)})
            if untagged:
                faults.append(f'{r} : la règle ne porte pas « decision {d["decision"]} » ({q["id"]} = {d["choix"]}) dans {", ".join(untagged)}')
            revised = [x['decision'] for x in load_registry() if x.get('question') == q['id'] and x.get('statut') == 'revisee']
            stale = sorted({f for f, l in lines if r in l and any(re.search(rf'decision {x}\b', l) for x in revised)})
            if stale:
                faults.append(f'{r} : porte encore une décision révisée ({", ".join(stale)})')
    for x in faults:
        print('ARBITRAGE', x)
    print(f'arbitrage-spec: {n - len(faults)}/{n} règles liées à leur décision active')
    return 1 if faults else 0


TEST_START = re.compile(r'''^\s*(?:it|test)(?:\.\w+)?\(\s*(['"`])(.*?)\1''', re.M)


def test_blocks():
    """(fichier, titre, corps) de chaque test de la recette et des tests de navigateur."""
    out = []
    for f in glob.glob('acceptance/**/*.ts', recursive=True):
        if 'node_modules' in f:
            continue
        text = open(f, encoding='utf-8', errors='replace').read()
        starts = list(TEST_START.finditer(text))
        for i, m in enumerate(starts):
            end = starts[i + 1].start() if i + 1 < len(starts) else len(text)
            out.append((f, m.group(2), text[m.start():end]))
    return out


def route_path(route):
    return route.split()[-1] if route else ''


def cmd_check_tests(args):
    version = version_of(args)
    blocks, faults, n = test_blocks(), [], 0
    for d, q in decisions_of(version):
        if not oui(q.get('observable')):
            continue
        n += 1
        opt = next(o for o in q['options'] if o['code'] == d['choix'])
        t = opt['test']
        mine = [(f, title, body) for f, title, body in blocks if f'[{d["decision"]}]' in title]
        if not mine:
            faults.append(f'{d["decision"]} ({q["id"]} = {d["choix"]}) : aucun test intitulé [{d["decision"]}]')
            continue
        # segments fixes de la route (les paramètres {id} ou :id varient d'un test à l'autre), statut et code d'erreur attendus
        segs = [x for x in route_path(t['route']).split('/') if x and not x.startswith(('{', ':'))]
        status = re.findall(r'\b[1-5]\d\d\b', t['attendu'])
        codes = re.findall(r'\b[a-z]+(?:\.[a-z_]+)+\b', t['attendu'])
        ok = any(all('/' + x in body for x in segs) and all(s in body for s in status) and all(c in body for c in codes)
                 for _, _, body in mine)
        if not ok:
            faults.append(f'{d["decision"]} : le test [{d["decision"]}] ne reprend pas la route {t["route"]} et l\'attendu « {t["attendu"]} »')
    revisees = {d['decision'] for d in load_registry() if d.get('statut') == 'revisee'}
    for f, title, _ in blocks:
        for x in re.findall(r'\[(D-\d+)\]', title):
            if x in revisees:
                faults.append(f'{x} : décision révisée, son test doit être remplacé ({title[:80]})')
    faults += revision_scope_faults(blocks)
    for x in faults:
        print('ARBITRAGE', x)
    print(f'arbitrage-tests: {n - len([x for x in faults if x.startswith("D-")])}/{n} décisions observables couvertes par leur test')
    return 1 if faults else 0


def revision_scope_faults(blocks):
    """Version de correction : seuls les tests listés par le calcul d'impact peuvent changer."""
    p = '.cuisine-run/revision.json'
    if not os.path.exists(p):
        return []
    rev = json.load(open(p))
    base = rev['base']
    before = {}
    files = subprocess.run(['git', 'ls-tree', '-r', '--name-only', base, 'acceptance'], capture_output=True, text=True).stdout.split()
    for f in files:
        if not f.endswith('.ts'):
            continue
        text = subprocess.run(['git', 'show', f'{base}:{f}'], capture_output=True, text=True).stdout
        starts = list(TEST_START.finditer(text))
        for i, m in enumerate(starts):
            end = starts[i + 1].start() if i + 1 < len(starts) else len(text)
            before[(f, m.group(2))] = hashlib.sha1(text[m.start():end].encode()).hexdigest()
    now = {(f, t): hashlib.sha1(b.encode()).hexdigest() for f, t, b in blocks}
    allowed = set(rev['tests'])
    faults = []
    for key, h in before.items():
        if key[1] in allowed:
            continue
        if key not in now:
            faults.append(f'révision {rev["decision"]} : test hors périmètre supprimé : {key[1]}')
        elif now[key] != h:
            faults.append(f'révision {rev["decision"]} : test hors périmètre modifié : {key[1]}')
    return faults


# ─── append-only ────────────────────────────────────────────────────────
def cmd_append_only(args):
    ref = args[0] if args else 'HEAD'
    faults = []
    olds = subprocess.run(['git', 'ls-tree', '-r', '--name-only', ref, 'specifications'], capture_output=True, text=True).stdout.split()
    for p in [x for x in olds if x.endswith('/arbitrages.yaml')]:
        old = yaml.safe_load(subprocess.run(['git', 'show', f'{ref}:{p}'], capture_output=True, text=True).stdout) or []
        new = yaml.safe_load(open(p, encoding='utf-8')) if os.path.exists(p) else []
        new_by = {d.get('decision'): d for d in new or []}
        for d in old:
            n = new_by.get(d.get('decision'))
            if n is None:
                faults.append(f'{p} : décision {d.get("decision")} supprimée')
                continue
            for k, v in d.items():
                if k in ('statut', 'remplacee_par') and d.get('statut') == 'active':
                    continue
                if n.get(k) != v:
                    faults.append(f'{p} : {d["decision"]}.{k} modifié ({v!r} devenu {n.get(k)!r})')
            if d.get('statut') == 'active' and n.get('statut') not in ('active', 'revisee'):
                faults.append(f'{p} : {d["decision"]} statut inconnu')
            if n.get('statut') == 'revisee' and not new_by.get(n.get('remplacee_par')):
                faults.append(f'{p} : {d["decision"]} révisée sans décision de remplacement')
    for x in faults:
        print('REGISTRE', x)
    print(f'registre: {"intact" if not faults else str(len(faults)) + " altération(s)"} depuis {ref}')
    return 1 if faults else 0


# ─── revise ─────────────────────────────────────────────────────────────
def cmd_revise(args):
    if len(args) < 3:
        die('Usage : arbitrage.py revise Q-ID CHOIX "motif"')
    qid, choix, motif = args[0], args[1].upper(), ' '.join(args[2:])
    q = all_questions().get(qid) or die(f'question {qid} introuvable')
    if choix not in [o['code'] for o in q['options']]:
        die(f'« {choix} » n\'est pas une option de {qid}')
    reg = load_registry(q['_module'])
    old = active(qid, reg) or die(f'{qid} n\'a pas de décision active : utiliser `cuisine arbitre`')
    if old['choix'] == choix:
        die(f'{qid} vaut déjà {choix}')
    new_id = next_decision_id_with(reg)
    old['statut'], old['remplacee_par'] = 'revisee', new_id
    today = datetime.date.today().isoformat()
    reg.append({'decision': new_id, 'question': qid, 'choix': choix, 'date': today, 'statut': 'active',
                'choix_par': 'proprietaire', 'version': f'revision-{new_id.lower()}', 'motif': motif, 'remplace': old['decision']})
    save_registry(q['_module'], reg)
    regles = q.get('regles') or []
    tests = sorted({t for _, t, _ in test_blocks() if any(r in t for r in regles) or f'[{old["decision"]}]' in t})
    specs = sorted({f for f, l in spec_lines() if any(r in l for r in regles)})
    opt = next(o for o in q['options'] if o['code'] == choix)
    impact = [f'# Impact de {new_id} ({qid} : {old["choix"]} devient {choix})', '',
              f'Motif : {motif}', '', f'Option retenue : {opt["libelle"]}. {opt["resultat"]}', '',
              '## Règles touchées', *[f'- {r}' for r in regles], '',
              '## Tests rouverts (seuls modifiables par l\'agent QA)', *[f'- {t}' for t in tests], '',
              '## Fichiers de spécification concernés', *[f'- {f}' for f in specs], '']
    p = f'specifications/{q["_module"]}/impact-{new_id}.md'
    open(p, 'w', encoding='utf-8').write('\n'.join(impact))
    version = f'revision-{new_id.lower()}'
    test_line = (f'Remplacer le test [{old["decision"]}] par un test [{new_id}] : route {opt["test"]["route"]}, '
                 f'entrée « {opt["test"]["entree"]} », attendu « {opt["test"]["attendu"]} ».') if opt.get('test') else ''
    prompt = (f'Version de correction : appliquer la décision {new_id} ({qid}, option {choix} : {opt["libelle"]}) aux règles '
              f'{", ".join(regles)} ; ne modifier aucune autre règle. {test_line} Les autres tests des règles touchées, listés dans '
              f'`{p}`, peuvent être réécrits pour suivre la décision ; tout autre test reste inchangé. Pas de question nouvelle.\n')
    os.makedirs('prompts', exist_ok=True)
    open(f'prompts/{version}.md', 'w', encoding='utf-8').write(prompt)
    head = subprocess.run(['git', 'rev-parse', 'HEAD'], capture_output=True, text=True).stdout.strip()
    json.dump({'decision': new_id, 'question': qid, 'tests': tests, 'base': head, 'version': version},
              open('.cuisine-run/revision.json', 'w'), ensure_ascii=False, indent=1)
    print(f'{new_id} remplace {old["decision"]} ; impact : {len(regles)} règle(s), {len(tests)} test(s), {len(specs)} fichier(s) ; '
          f'demande écrite dans prompts/{version}.md')
    print(version)
    return 0


# ─── metrics ────────────────────────────────────────────────────────────
def cmd_metrics(args):
    version = version_of(args)
    try:
        etat = json.load(open(f'.cuisine-run/questions-{version}.json'))
    except OSError:
        etat = {'produites': 0, 'retenues': 0, 'par_defaut': 0}
    reg = load_registry()
    proprio = [d for d in reg if d.get('version') == version and d.get('choix_par') == 'proprietaire']
    contre = [d for d in proprio if d.get('defaut_propose') and d['choix'] != d['defaut_propose']]
    revisions = [d for d in reg if d.get('remplace')]
    print(f'## Arbitrage de la version {version}\n')
    print(f'- Questions produites : {etat["produites"]} ; retenues pour le propriétaire : {etat["retenues"]} ; tranchées par défaut : {etat["par_defaut"]}.')
    print(f'- Réponses du propriétaire contraires au défaut : {len(contre)} sur {len(proprio)}.')
    print(f'- Révisions inscrites au registre (toutes versions) : {len(revisions)}.')
    ecartees = etat.get('securite_ecartees', [])
    print(f'- Questions sécurité ou données personnelles non remontées : {len(ecartees)}.')
    for e in ecartees:
        print(f'  - {e["id"]} ({e["titre"]}) : {e["raison"]}.')
    hist = []
    for f in sorted(glob.glob('.cuisine-run/questions-*.json')):
        v = json.load(open(f))['version']
        p = [d for d in reg if d.get('version') == v and d.get('choix_par') == 'proprietaire' and d.get('defaut_propose')]
        hist.append((v, len(p), len([d for d in p if d['choix'] != d['defaut_propose']])))
    recent = [h for h in hist if h[1]][-3:]
    if len(recent) == 3 and all(c == 0 for _, _, c in recent):
        print('- ALERTE : aucune réponse contraire au défaut sur les trois dernières versions arbitrées : '
              'le filtre est trop large ou les défauts suffisent, à réexaminer.')
    return 0


COMMANDS = {'check': cmd_check, 'renumber': cmd_renumber, 'filter': cmd_filter, 'wait': cmd_wait, 'show': cmd_show, 'arbitre': cmd_arbitre,
            'check-spec': cmd_check_spec, 'check-tests': cmd_check_tests, 'append-only': cmd_append_only,
            'revise': cmd_revise, 'metrics': cmd_metrics}

if __name__ == '__main__':
    if len(sys.argv) < 2 or sys.argv[1] not in COMMANDS:
        print(__doc__)
        sys.exit(2)
    sys.exit(COMMANDS[sys.argv[1]](sys.argv[2:]))
