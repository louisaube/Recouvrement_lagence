# Groupes (`/groupes`) : état réalisé

Écran réservé aux administrateurs. Code : `features/groups/pages/GroupsPage.tsx`, `components/GroupDialog.tsx`, `hooks/useGroupLoader.ts`. Règles API : `40-groupes-perimetres.md` §2. Écran : `70-ecrans.md` §8.

## Ce qui existe
- Titre « Groupes », bouton « Nouveau groupe » (`rule-foundation-groups-admin-screen`, user).
- Tableau lu par `GET /groups?from=&size=` (nom sans tenir compte de la casse) : « Nom », « Membres » (« Aucun membre », « 1 membre », « N membres »), « Périmètres » (pastille = code, nom en infobulle), « Actions » (« Modifier », nom accessible « Modifier le groupe <nom> »). Pagination serveur. Vide : « Aucun groupe pour le moment. Créez le premier groupe. ». Pas de suppression (`rule-foundation-group-no-delete`, inferred).
- **Dialogue** de création et de modification (`rule-foundation-group-definition`, user) : « Nom », « Membres » (choix multiple d'e-mails, facultatif : `rule-foundation-group-members-optional` inferred), « Périmètres » (« <code> — <nom> », aide « Au moins un périmètre. »). Il charge tous les comptes et tous les périmètres à l'ouverture ; en modification il est prérempli et envoie toujours `{ name, userIds, scopeIds }`. Échec du chargement : « Impossible de charger les utilisateurs et les périmètres. » avec « Réessayer ».
- **Validation locale** (`rule-foundation-group-needs-scope`, user) : nom obligatoire après rognage et ≤ 100, au moins un périmètre ; sans périmètre existant, « Aucun périmètre n'existe encore. Créez-en depuis l'écran Périmètres. » avec lien.
- Succès : « Groupe créé. » / « Groupe modifié. », liste rechargée. Échecs : `groups.name_already_exists` → « Ce nom de groupe est déjà utilisé. » sous le nom (`rule-foundation-group-name-unique`, inferred) ; 400 → « Données invalides. Vérifiez les champs. ».
- Les créations et modifications laissent une entrée au journal (`groups:create`, `groups:update`).

## Limites connues
- Pas de recherche ni de filtre dans la liste. Le nom d'un groupe peut être modifié, mais le groupe ne peut pas être supprimé.
