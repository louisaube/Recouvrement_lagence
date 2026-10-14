# Périmètre du lot v1k-indicateurs : Indicateurs complets

Tranche de la version `v1-cerveau-recouvrement`. Demande de référence : `prompts/v1-cerveau-recouvrement.md` ; plans : `specifications/recouvrement/implementation-plans/v1-cerveau-recouvrement/` ; recette scellée de toute la v1. Un seul sujet par lot : ne fabriquer que ce qui suit.

## Plans à implémenter (dossier `v1-cerveau-recouvrement`)
- indicateurs-api-modification-request.md (calcul complet : encaissé/dû, engagements tenus/pris, remises/dû, réclamations/actions, erreurs/décisions relues ; par segment, version de politique et version d'agent)

## À écrire dans ce lot
- calcul complet des cinq indicateurs en deux termes, sans note agrégée
- accès du lecteur des indicateurs limité aux agrégats

## Nouveau fichier de recette de ce lot
- acceptance-v1-indicateurs.test.ts

## Porte cumulée (`bash .cuisine/scripts/acceptance.sh` ne joue que ces fichiers ; tous doivent rester verts)
- acceptance-v1-politiques.test.ts
- acceptance-v1-imports.test.ts
- acceptance-v1-lot-du-jour.test.ts
- acceptance-v1-file-decisions.test.ts
- acceptance-v1-dossiers.test.ts
- acceptance-v1-sorties-comptables.test.ts
- acceptance-v1-relecture.test.ts
- acceptance-v1-agents.test.ts
- acceptance-v1-mcp.test.ts
- acceptance-v1-engagements.test.ts
- acceptance-v1-litiges.test.ts
- acceptance-v1-indicateurs.test.ts

Les autres fichiers `acceptance-v1-*` appartiennent aux lots suivants : ne pas les rendre verts par anticipation, ne pas construire leurs routes. Les routes des lots précédents ne changent pas de comportement.

## Écrans de ce lot
- indicateurs (plan `indicateurs-page-implementation-plan.md`)

## Hors de ce lot
- profils

## Règles de conduite
- Pas de route provisoire (501, 404 de convenance) : une route d'un lot suivant n'existe pas encore.
- Si un test de la porte ne peut passer que par une route d'un lot suivant (par exemple POST /agent/... pour les outils des agents), ne rien contourner et ouvrir une contestation `OPEN: <titre exact du test> : dépend de <route> (lot <slug>)` dans le DISPUTES.md de ce dossier : la QA déplace alors le test à l'identique, avec ses assertions et son identifiant, dans le fichier du lot concerné.
- Le disque garde l'avancement : écrire par fonctionnalité et lancer ses tests après chacune.
