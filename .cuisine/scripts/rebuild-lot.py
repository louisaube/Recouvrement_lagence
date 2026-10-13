#!/usr/bin/env python3
"""Fiche d'un lot de reconstruction en salle blanche et périmètre cumulé des portes.
Usage : rebuild-lot.py <lot> <lot.env> <fiche.md>
lot.env : ACCEPTANCE_FILES, CONTRACT_PATHS, E2E_FILES cumulés jusqu'au lot inclus ; MATRIX=info sauf au dernier lot."""
import os, sys, yaml
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
lot, env_out, md_out = sys.argv[1:4]
doc = yaml.safe_load(open(os.path.join(ROOT, '.cuisine', 'rebuild', 'lots.yaml')))
order = doc['ordre']
if lot not in order:
    sys.exit(1)
done = order[:order.index(lot) + 1]
lots = doc['lots']
acc = [f for l in done for f in lots[l]['recette']]
paths = [p for l in done for p in lots[l]['contrat']]
e2e = [f'e2e/{l}.spec.ts' for l in done]
with open(env_out, 'w') as f:
    f.write(f'LOT="{lot}"\nACCEPTANCE_FILES="{" ".join(acc)}"\nCONTRACT_PATHS="{" ".join(paths)}"\nE2E_FILES="{" ".join(e2e)}"\n')
    f.write(f'MATRIX="{"strict" if lot == order[-1] else "info"}"\n')
L = lots[lot]
previous = order[:order.index(lot)]
lines = [
    f'# Lot {lot} : {L["titre"]}', '',
    f'Lot id: `{lot}` (browser tests file: `acceptance/e2e/{lot}.spec.ts`).',
    f'Lots already built: {", ".join(previous) if previous else "none (this lot creates the repository skeleton: api/, studio/, packages/api-client/, the whole tooling contract of CLAUDE.md, docs/socle.md and README.md)"}.', '',
    '## Specification chapters (in `specifications/socle/`)',
    *[f'- {c}' for c in L['chapitres']],
    '- 98-arbitrages.md (always; overrides the default positions of the other chapters)',
    '- data-contract.md (always; database schema `base`, exact)', '',
    '## Sealed acceptance files of this lot (in `acceptance/`)',
    *[f'- {f}' for f in L['recette']],
    f'All acceptance files of the lots built so far must stay green: {", ".join(acc)}.', '',
    '## Contract paths to reproduce without breaking change (from `specifications/openapi.json`)',
    *[f'- {p}' for p in L['contrat']], '',
    '## Screens of this lot',
    *[f'- {e}' for e in L['ecrans']], '',
    '## Out of scope',
    'Everything that belongs to later lots: ' + (', '.join(order[order.index(lot) + 1:]) or 'none') + '. Do not build their routes, tables or screens yet; leave clean extension points instead.',
]
if lot == order[0]:
    lines += ['', '## Skeleton requirements of the first lot',
              '- pnpm workspaces: `api`, `studio`, `packages/*`, `acceptance` (the last one already exists, do not touch it).',
              '- The route declarations, the platform pieces (configuration, database pool, error format, request id, validation, OpenAPI generation, access declaration and its boot-time check, `cuisine:openapi`, `cuisine:routes`, server start script, migrations) are built in this lot and serve all later lots.',
              '- The data contract tables of later lots may already be created by the migration of this lot, since the schema is fixed; their routes are not.']
open(md_out, 'w').write('\n'.join(lines) + '\n')
print(md_out)
