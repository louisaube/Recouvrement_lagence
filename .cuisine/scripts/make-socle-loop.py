#!/usr/bin/env python3
"""Génère .cuisine/socle.loop.yaml depuis .cuisine/cuisine.loop.yaml : même chaîne, mêmes portes,
mais pour une version DU SOCLE (la cuisine appliquée à elle-même). Seule différence : un préambule
qui lève l'interdiction de toucher au socle, sauf pour la cuisine elle-même et le harnais de recette."""
import re, sys, os
here = os.path.dirname(os.path.abspath(__file__))
src = open(os.path.join(here, '..', 'cuisine.loop.yaml')).read()
PRE = ("FOUNDATION VERSION (Cuisine sauvage applied to itself). For this version only, the foundation part of the rule \"Read-only for coding agents\" "
       "of CLAUDE.md is lifted for the foundation folders (`api/src/platform/**`, the foundation features, `api/src/main.ts`, `api/scripts/**`, `studio/src/**`, "
       "`packages/api-client/scripts/**`): the foundation itself is the product of this version, "
       "and every application created from this repository will inherit it. It still applies to `.cuisine/**`, `CLAUDE.md`, the tooling contract of CLAUDE.md, "
       "`specifications/socle/data-contract.md` and `acceptance/**`. Keep the foundation generic: no business domain, French user interface texts, "
       "existing foundation tests must keep passing unless the specification of this version changes them. Foundation operations go into "
       "`specifications/permissions.yaml` like business ones.\n")
out = src.replace('name: cuisine-sauvage-version', 'name: cuisine-sauvage-socle', 1)
# insert the preamble as the first line of every prompt block
out = re.sub(r"(\n    prompt: \|\n)(      )", lambda m: m.group(1) + m.group(2) + PRE.replace('\n', '\n' + m.group(2)) + '\n' + m.group(2), out)
open(os.path.join(here, '..', 'socle.loop.yaml'), 'w').write(out)
print('socle.loop.yaml :', out.count('FOUNDATION VERSION'), 'prompts')

# Graphes « suite » : même chaîne, reprise après l'arbitrage du propriétaire (cuisine arbitre), à partir d'arbitrage-apply.
for name, text in (('cuisine', src), ('socle', out)):
    suite = re.sub(r'^name: (\S+)', lambda m: f'name: {m.group(1)}-suite', text, count=1, flags=re.M)
    suite = re.sub(r'^entry: \S+', 'entry: arbitrage-apply', suite, count=1, flags=re.M)
    open(os.path.join(here, '..', f'{name}.suite.loop.yaml'), 'w').write(
        '# Généré par make-socle-loop.py : ne pas modifier à la main.\n' + suite)
    print(f'{name}.suite.loop.yaml : entrée arbitrage-apply')
