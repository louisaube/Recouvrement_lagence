# Périmètre du lot v1e-sorties-comptables : Sorties comptables : approbation, export, constat

Tranche de la version `v1-cerveau-recouvrement`. Demande de référence : `prompts/v1-cerveau-recouvrement.md` ; plans : `specifications/recouvrement/implementation-plans/v1-cerveau-recouvrement/` ; recette scellée de toute la v1. Un seul sujet par lot : ne fabriquer que ce qui suit.

## Plans à implémenter (dossier `v1-cerveau-recouvrement`)
- sorties-comptables-api-modification-request.md

## À écrire dans ce lot
- états à approuver, approuvée, constatée, en écart ; approbation par lot ; export au format pivot
- constat par l'import de créances suivant, écart après le nombre d'imports de la politique, passage en perte

## Nouveau fichier de recette de ce lot
- acceptance-v1-sorties-comptables.test.ts

## Porte cumulée (`bash .cuisine/scripts/acceptance.sh` ne joue que ces fichiers ; tous doivent rester verts)
- acceptance-v1-politiques.test.ts
- acceptance-v1-imports.test.ts
- acceptance-v1-lot-du-jour.test.ts
- acceptance-v1-file-decisions.test.ts
- acceptance-v1-dossiers.test.ts
- acceptance-v1-sorties-comptables.test.ts

Les autres fichiers `acceptance-v1-*` appartiennent aux lots suivants : ne pas les rendre verts par anticipation, ne pas construire leurs routes. Les routes des lots précédents ne changent pas de comportement.

## Écrans de ce lot
- sorties-comptables (plan `sorties-comptables-page-implementation-plan.md`)

## Hors de ce lot
- relecture, outils des agents

## Règles de conduite
- Pas de route provisoire (501, 404 de convenance) : une route d'un lot suivant n'existe pas encore.
- Si un test de la porte ne peut passer que par une route d'un lot suivant (par exemple POST /agent/... pour les outils des agents), ne rien contourner et ouvrir une contestation `OPEN: <titre exact du test> : dépend de <route> (lot <slug>)` dans le DISPUTES.md de ce dossier : la QA déplace alors le test à l'identique, avec ses assertions et son identifiant, dans le fichier du lot concerné.
- Le disque garde l'avancement : écrire par fonctionnalité et lancer ses tests après chacune.
