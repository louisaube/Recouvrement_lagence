# Périmètre du lot v1d-outils-agents : Outils des agents : REST, MCP, engagements

Ce lot est une tranche de la version `v1-cerveau-recouvrement`. La demande complète (`prompts/v1-cerveau-recouvrement.md`) et les plans (`specifications/recouvrement/implementation-plans/v1-cerveau-recouvrement/`) restent la référence ; la recette scellée est celle de toute la v1. Ne fabriquer que ce qui suit.

## Plans à implémenter (dossier `v1-cerveau-recouvrement`)
- outils-agents-api-modification-request.md
- referentiel-etats-et-transitions.md (engagements : tenu, rompu, déchéance)

## À écrire dans ce lot
- comptes agent par canal, jeton porteur, version d'agent, clé d'idempotence, journal des appels
- huit outils sur l'API REST et sur le serveur MCP (enveloppe du premier, SDK TypeScript officiel)
- engagements : inscription, tenu, rompu, déchéance, sortie comptable de remise tenue
- plafond d'encours sous échéancier

## Porte de recette de ce lot (fichiers dans `acceptance/`)
- acceptance-v1-politiques.test.ts
- acceptance-v1-imports.test.ts
- acceptance-v1-lot-du-jour.test.ts
- acceptance-v1-dossiers.test.ts
- acceptance-v1-file-decisions.test.ts
- acceptance-v1-sorties-comptables.test.ts
- acceptance-v1-relecture.test.ts
- acceptance-v1-agents.test.ts
- acceptance-v1-mcp.test.ts
- acceptance-v1-engagements.test.ts

`bash .cuisine/scripts/acceptance.sh` ne joue que ces fichiers (80 tests propres au lot, les fichiers des lots précédents restant verts). Les autres fichiers `acceptance-v1-*` appartiennent aux lots suivants : ne pas les rendre verts par anticipation, ne pas construire leurs routes. Les routes déjà fabriquées des lots précédents ne changent pas de comportement.

## Écrans de ce lot
- aucun

## Hors de ce lot
- litiges (fichier de recette), indicateurs complets, profils (fichier de recette) : lot final

## Règles de conduite
- Aucune route provisoire qui répond 501 ou 404 de convenance : une route d'un lot suivant n'existe pas encore.
- Si un test de la porte ne peut passer que par une route d'un lot suivant, ne rien contourner et ne pas ouvrir de contestation : le dire en dernière ligne de la réponse (titre du test, route manquante). L'opérateur déplace alors le fichier vers le lot concerné.
- Écrire par fonctionnalité, dans l'ordre ci-dessus, et lancer les tests de la fonctionnalité après chacune : le disque garde l'avancement si la session est recyclée.
