# Journal (`/journal`), accès élargi au superviseur : état réalisé

Complète `specifications/socle/page-journal.summary.md` : seul l'accès change, l'écran et ses filtres sont ceux du socle.

## Ce qui existe
- L'écran et l'onglet « Journal » sont ouverts à l'administrateur et au profil Superviseur (`RequireProfile profiles={['supervisor']} admin` dans `App.tsx`). Les autres profils, agent compris, voient « Accès refusé » sans appel au journal (`rule-recouvrement-journal-supervisor`, `rule-recouvrement-journal-others-refused`, `rule-recouvrement-journal-agent-never`, user).
- Côté API, `GET /audit-logs` et `GET /audit-logs/filters` sont gardées par `RequireAdminOrProfile('supervisor')` ; la déclaration reste `roles: ['admin']` (litige ACCEPTED sur `specifications/permissions.yaml`).

## Limites connues
- Un administrateur sans profil garde l'accès au journal mais n'a aucun autre accès de recouvrement.
