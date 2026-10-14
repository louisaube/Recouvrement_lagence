# Périmètre du lot v1a-referentiel : Référentiels : politique, imports, dossiers en lecture

Ce lot est une tranche de la version `v1-cerveau-recouvrement`. La demande complète (`prompts/v1-cerveau-recouvrement.md`) et les plans (`specifications/recouvrement/implementation-plans/v1-cerveau-recouvrement/`) restent la référence ; la recette scellée est celle de toute la v1. Ne fabriquer que ce qui suit.

## Plans à implémenter (dossier `v1-cerveau-recouvrement`)
- recouvrement-module-implementation-plan.md
- referentiel-etats-et-transitions.md
- politiques-api-modification-request.md
- imports-recouvrement-api-modification-request.md
- dossiers-api-modification-request.md (routes de lecture : GET /cases, /cases/filters, /cases/:id, /cases/:id/decisions, /cases/:id/state-history, GET /invoices)
- litiges-api-modification-request.md (lecture seule : GET /disputes, GET /disputes/:id, GET /disputes/invoices)
- profils-api-modification-request.md (déjà fabriqué : ne pas le refaire)

## À écrire dans ce lot
- politique versionnée et sa lecture par @gorules/zen-engine, contrôles d'activation, dossiers témoins
- six imports du format pivot, aperçu, erreurs, rapport d'écarts, lettrage, gel des factures en litige
- tables et lecture des dossiers, factures, interlocuteurs, états et journal des transitions
- litiges : tables et lecture seule (la création et la clôture sont du lot suivant)
- journal : `GET /audit-logs` et `GET /audit-logs/filters` admettent l'administrateur ou le superviseur (garde métier, `journal-api-modification-request.md`) ; la porte des permissions compare ces deux routes à `specifications/permissions.yaml` dans tous les lots
- file de décisions, LECTURE SEULE : `GET /decision-queue/items` et `GET /decision-queue/counts` (les tests d'imports lisent les compteurs de la file ; `POST /decision-queue/items/:id/decision` reste du lot suivant)

## Porte de recette de ce lot (fichiers dans `acceptance/`)
- acceptance-v1-politiques.test.ts
- acceptance-v1-imports.test.ts

`bash .cuisine/scripts/acceptance.sh` ne joue que ces fichiers (119 tests propres au lot, les fichiers des lots précédents restant verts). Les autres fichiers `acceptance-v1-*` appartiennent aux lots suivants : ne pas les rendre verts par anticipation, ne pas construire leurs routes. Les routes déjà fabriquées des lots précédents ne changent pas de comportement.

## Écrans de ce lot
- accueil (plan `accueil-page-implementation-plan.md`)
- utilisateurs (profils) (plan `utilisateurs-page-implementation-plan.md`)
- imports (plan `imports-page-implementation-plan.md`)
- politique (plan `politique-page-implementation-plan.md`)

## Hors de ce lot
- lot du jour et décisions du cerveau (la négociation n'est pas encore là : les dossiers n'ont pas d'ordre du jour)
- sorties comptables, relecture, indicateurs, outils des agents, MCP
- ouverture et clôture d'un litige
- décision sur un élément de la file (`POST /decision-queue/items/:id/decision`)

## Règles de conduite
- Aucune route provisoire qui répond 501 ou 404 de convenance : une route d'un lot suivant n'existe pas encore.
- Si un test de la porte ne peut passer que par une route d'un lot suivant, ne rien contourner et ne pas ouvrir de contestation : le dire en dernière ligne de la réponse (titre du test, route manquante). L'opérateur déplace alors le fichier vers le lot concerné.
- Écrire par fonctionnalité, dans l'ordre ci-dessus, et lancer les tests de la fonctionnalité après chacune : le disque garde l'avancement si la session est recyclée.
