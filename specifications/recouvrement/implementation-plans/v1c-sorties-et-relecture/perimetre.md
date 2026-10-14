# Périmètre du lot v1c-sorties-et-relecture : Sorties comptables, relecture hebdomadaire, indicateurs (routes)

Ce lot est une tranche de la version `v1-cerveau-recouvrement`. La demande complète (`prompts/v1-cerveau-recouvrement.md`) et les plans (`specifications/recouvrement/implementation-plans/v1-cerveau-recouvrement/`) restent la référence ; la recette scellée est celle de toute la v1. Ne fabriquer que ce qui suit.

## Plans à implémenter (dossier `v1-cerveau-recouvrement`)
- sorties-comptables-api-modification-request.md
- relecture-api-modification-request.md
- indicateurs-api-modification-request.md (routes GET /indicators et /indicators/filters seulement : déclaration d'accès, schémas, calcul de ce qui existe déjà ; les tests de ce fichier ne font pas partie de la porte, ils sont du lot final)

## À écrire dans ce lot
- sorties comptables : états, approbation par lot, export au format pivot, constat par l'import suivant, écart, passage en perte
- relecture : tirage reproductible, entrées du dossier à la date de la décision, avis du superviseur
- routes des indicateurs (nécessaires parce que les sondes d'accès des fichiers de recette des outils des agents les interrogent)

## Porte de recette de ce lot (fichiers dans `acceptance/`)
- acceptance-v1-politiques.test.ts
- acceptance-v1-imports.test.ts
- acceptance-v1-lot-du-jour.test.ts
- acceptance-v1-dossiers.test.ts
- acceptance-v1-file-decisions.test.ts
- acceptance-v1-sorties-comptables.test.ts
- acceptance-v1-relecture.test.ts

`bash .cuisine/scripts/acceptance.sh` ne joue que ces fichiers (43 tests propres au lot, les fichiers des lots précédents restant verts). Les autres fichiers `acceptance-v1-*` appartiennent aux lots suivants : ne pas les rendre verts par anticipation, ne pas construire leurs routes. Les routes déjà fabriquées des lots précédents ne changent pas de comportement.

## Écrans de ce lot
- sorties-comptables (plan `sorties-comptables-page-implementation-plan.md`)
- relecture (plan `relecture-page-implementation-plan.md`)

## Hors de ce lot
- outils des agents et MCP
- indicateurs complets (réclamations, engagements : lot final)

## Règles de conduite
- Aucune route provisoire qui répond 501 ou 404 de convenance : une route d'un lot suivant n'existe pas encore.
- Si un test de la porte ne peut passer que par une route d'un lot suivant, ne rien contourner et ne pas ouvrir de contestation : le dire en dernière ligne de la réponse (titre du test, route manquante). L'opérateur déplace alors le fichier vers le lot concerné.
- Écrire par fonctionnalité, dans l'ordre ci-dessus, et lancer les tests de la fonctionnalité après chacune : le disque garde l'avancement si la session est recyclée.
