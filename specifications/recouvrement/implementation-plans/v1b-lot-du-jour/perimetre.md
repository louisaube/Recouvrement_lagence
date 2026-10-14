# Périmètre du lot v1b-lot-du-jour : Lot du jour : préparation, contrôles, libération

Tranche de la version `v1-cerveau-recouvrement`. Demande de référence : `prompts/v1-cerveau-recouvrement.md` ; plans : `specifications/recouvrement/implementation-plans/v1-cerveau-recouvrement/` ; recette scellée de toute la v1. Un seul sujet par lot : ne fabriquer que ce qui suit.

## Plans à implémenter (dossier `v1-cerveau-recouvrement`)
- lot-du-jour-api-modification-request.md
- referentiel-etats-et-transitions.md

## À écrire dans ce lot
- table de décision (JDM) appliquée dossier par dossier, ordres d'envoi structurés sans texte
- contrôles de libération, arrêt automatique, dossiers témoins, un ordre par dossier, type et jour
- prescription, familles (transfert proposé, jamais exécuté), plafond d'encours si prévu par le plan

## Nouveau fichier de recette de ce lot
- acceptance-v1-lot-du-jour.test.ts

## Porte cumulée (`bash .cuisine/scripts/acceptance.sh` ne joue que ces fichiers ; tous doivent rester verts)
- acceptance-v1-politiques.test.ts
- acceptance-v1-imports.test.ts
- acceptance-v1-lot-du-jour.test.ts

Les autres fichiers `acceptance-v1-*` appartiennent aux lots suivants : ne pas les rendre verts par anticipation, ne pas construire leurs routes. Les routes des lots précédents ne changent pas de comportement.

## Écrans de ce lot
- lot-du-jour (plan `lot-du-jour-page-implementation-plan.md`)

## Hors de ce lot
- décision sur un élément de la file
- fiche dossier et litiges ouvrir/clore
- sorties comptables, relecture, outils des agents

## Règles de conduite
- Pas de route provisoire (501, 404 de convenance) : une route d'un lot suivant n'existe pas encore.
- Si un test de la porte ne peut passer que par une route d'un lot suivant, ne rien contourner : le dire en dernière ligne de la réponse (titre du test, route manquante) ; ne pas ouvrir de contestation pour cela.
- Le disque garde l'avancement : écrire par fonctionnalité et lancer ses tests après chacune.
