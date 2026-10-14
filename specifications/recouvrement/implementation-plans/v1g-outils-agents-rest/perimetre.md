# Périmètre du lot v1g-outils-agents-rest : Outils des agents : API REST

Tranche de la version `v1-cerveau-recouvrement`. Demande de référence : `prompts/v1-cerveau-recouvrement.md` ; plans : `specifications/recouvrement/implementation-plans/v1-cerveau-recouvrement/` ; recette scellée de toute la v1. Un seul sujet par lot : ne fabriquer que ce qui suit.

## Plans à implémenter (dossier `v1-cerveau-recouvrement`)
- outils-agents-api-modification-request.md (huit outils REST, comptes agent par canal, jeton porteur, version d'agent, clé d'idempotence, journal des appels)

## À écrire dans ce lot
- les huit outils sur l'API REST
- engagements inscrits par l'outil (tenu, rompu, déchéance : la sortie comptable de remise tenue est vérifiée par le lot engagements)
- plafond d'encours sous échéancier

## Nouveau fichier de recette de ce lot
- acceptance-v1-agents.test.ts

## Porte cumulée (`bash .cuisine/scripts/acceptance.sh` ne joue que ces fichiers ; tous doivent rester verts)
- acceptance-v1-politiques.test.ts
- acceptance-v1-imports.test.ts
- acceptance-v1-lot-du-jour.test.ts
- acceptance-v1-file-decisions.test.ts
- acceptance-v1-dossiers.test.ts
- acceptance-v1-sorties-comptables.test.ts
- acceptance-v1-relecture.test.ts
- acceptance-v1-agents.test.ts

Les autres fichiers `acceptance-v1-*` appartiennent aux lots suivants : ne pas les rendre verts par anticipation, ne pas construire leurs routes. Les routes des lots précédents ne changent pas de comportement.

## Écrans de ce lot
- aucun

## Hors de ce lot
- serveur MCP
- fichier de recette des engagements

## Règles de conduite
- Pas de route provisoire (501, 404 de convenance) : une route d'un lot suivant n'existe pas encore.
- Si un test de la porte ne peut passer que par une route d'un lot suivant, ne rien contourner : le dire en dernière ligne de la réponse (titre du test, route manquante) ; ne pas ouvrir de contestation pour cela.
- Le disque garde l'avancement : écrire par fonctionnalité et lancer ses tests après chacune.
