# Périmètre du lot v1b-lot-du-jour : Cerveau : lot du jour, file de décisions, fiche dossier, litiges

Ce lot est une tranche de la version `v1-cerveau-recouvrement`. La demande complète (`prompts/v1-cerveau-recouvrement.md`) et les plans (`specifications/recouvrement/implementation-plans/v1-cerveau-recouvrement/`) restent la référence ; la recette scellée est celle de toute la v1. Ne fabriquer que ce qui suit.

## Plans à implémenter (dossier `v1-cerveau-recouvrement`)
- lot-du-jour-api-modification-request.md
- file-de-decisions-api-modification-request.md
- dossiers-api-modification-request.md (décisions, historique d'états, fiche)
- litiges-api-modification-request.md (POST /disputes, POST /disputes/:id/close)
- referentiel-etats-et-transitions.md

## À écrire dans ce lot
- table de décision (JDM) appliquée dossier par dossier, ordres d'envoi structurés, contrôles et libération du lot, arrêt automatique, témoins, un ordre par dossier, type et jour
- prescription, familles : transfert proposé jamais exécuté
- file du superviseur et ses décisions motivées
- ouverture et clôture d'un litige (gel et dégel de la facture)

## Porte de recette de ce lot (fichiers dans `acceptance/`)
- acceptance-v1-politiques.test.ts
- acceptance-v1-imports.test.ts
- acceptance-v1-lot-du-jour.test.ts
- acceptance-v1-dossiers.test.ts
- acceptance-v1-file-decisions.test.ts

`bash .cuisine/scripts/acceptance.sh` ne joue que ces fichiers (72 tests propres au lot, les fichiers des lots précédents restant verts). Les autres fichiers `acceptance-v1-*` appartiennent aux lots suivants : ne pas les rendre verts par anticipation, ne pas construire leurs routes. Les routes déjà fabriquées des lots précédents ne changent pas de comportement.

## Écrans de ce lot
- dossiers (plan `dossiers-page-implementation-plan.md`)
- dossier (plan `dossier-page-implementation-plan.md`)
- lot-du-jour (plan `lot-du-jour-page-implementation-plan.md`)
- file-de-decisions (plan `file-de-decisions-page-implementation-plan.md`)

## Hors de ce lot
- sorties comptables, relecture, indicateurs
- outils des agents et MCP (les engagements et les contestations d'agent viennent au lot suivant)

## Règles de conduite
- Aucune route provisoire qui répond 501 ou 404 de convenance : une route d'un lot suivant n'existe pas encore.
- Si un test de la porte ne peut passer que par une route d'un lot suivant, ne rien contourner et ne pas ouvrir de contestation : le dire en dernière ligne de la réponse (titre du test, route manquante). L'opérateur déplace alors le fichier vers le lot concerné.
- Écrire par fonctionnalité, dans l'ordre ci-dessus, et lancer les tests de la fonctionnalité après chacune : le disque garde l'avancement si la session est recyclée.
