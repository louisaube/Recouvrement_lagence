# Journal (`/journal`), accès élargi au superviseur : état réalisé

Complète `specifications/socle/page-journal.summary.md` : seul l'accès change, l'écran et ses filtres sont ceux du socle.

## Ce qui existe
- L'écran et l'onglet « Journal » sont ouverts à l'administrateur et au profil Superviseur (`RequireProfile profiles={['supervisor']} admin` dans `App.tsx`). Les autres profils, agent compris, voient « Accès refusé » sans appel au journal (`rule-recouvrement-journal-supervisor`, `rule-recouvrement-journal-others-refused`, `rule-recouvrement-journal-agent-never`, user).
- Côté API, `GET /audit-logs` et `GET /audit-logs/filters` sont gardées par `RequireAdminOrProfile('supervisor')` ; la déclaration est `roles: ['user']` (arbitrage du propriétaire du 14/10/2026) ; `specifications/permissions.yaml` garde `allow: [admin]`, conforme à l'accès observé (contestations REJECTED dans `v1b-lot-du-jour/DISPUTES.md`). Les préparations et libérations de lots y figurent sous l'objet « Lot du jour ».

## Limites connues
- Un administrateur sans profil garde l'accès au journal mais n'a aucun autre accès de recouvrement.
