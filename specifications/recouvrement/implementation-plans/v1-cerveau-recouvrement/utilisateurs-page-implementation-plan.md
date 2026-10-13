# Écran Utilisateurs (mise à jour) : plan de réalisation

Objet : l'administrateur du socle crée les comptes et leur attribue un profil de recouvrement (Superviseur, Compte agent, Service litiges, Lecteur des indicateurs) ; pour un compte agent, il choisit le canal. Chemin `/utilisateurs`, accès administrateur (inchangé). Le reste de l'écran (`rule-foundation-users-admin-screen`) ne change pas.

## Parcours
1. L'administrateur ouvre `/utilisateurs` : le tableau gagne la colonne « Profil ». Les profils sont lus en entier (`GET /user-profiles`, pages de 100) en même temps que la page de comptes.
2. « Nouvel utilisateur » : aux champs existants s'ajoutent « Profil » et, pour le profil « Compte agent », « Canal ». « Enregistrer » envoie `POST /users`, puis, si un profil est choisi, `PUT /user-profiles/:userId`.
3. « Modifier l'utilisateur <e-mail> » : « Profil » (et « Canal ») sont préremplis. « Enregistrer » envoie `PATCH /users/:id`, puis `PUT /user-profiles/:userId` seulement si le profil ou le canal a changé.
4. Succès : dialogue fermé, liste rechargée, notification « Utilisateur créé. » ou « Utilisateur modifié. ». Si le compte est créé ou modifié mais que l'attribution du profil échoue : le dialogue se ferme, la liste est rechargée et la notification d'avertissement est « Utilisateur enregistré, mais le profil n'a pas pu être attribué. Modifiez l'utilisateur pour réessayer. ».

## Éléments à l'écran
| Élément | Libellé exact (nom accessible) | Comportement | Données (route d'API) |
|---|---|---|---|
| Colonne du tableau | « Profil » | pastille : « Superviseur », « Compte agent · Voix » (ou « Courriel et SMS », « Courrier »), « Service litiges », « Lecteur des indicateurs » ; « Aucun profil » sinon | `GET /user-profiles` |
| Champ de liste (dialogues) | « Profil » | options : « Aucun profil » (par défaut), « Superviseur », « Compte agent », « Service litiges », « Lecteur des indicateurs » ; aide : « Le profil donne accès aux écrans de recouvrement. Sans profil, un compte n'a aucun droit de recouvrement. » | `PUT /user-profiles/:userId` |
| Champ de liste (dialogues) | « Canal » | visible et obligatoire seulement pour « Compte agent » ; options « Voix », « Courriel et SMS », « Courrier » ; aide : « Un seul compte agent par canal. » | idem |
| Aide sous « Mot de passe » (création d'un compte agent) | « Le compte agent se connecte avec ce mot de passe pour obtenir son jeton. » | affichée si « Compte agent » est choisi | — |
| Aide sous « Rôle » (compte agent) | « Un compte agent doit avoir le rôle Utilisateur. » | affichée si « Compte agent » est choisi ; l'option « Administrateur » est refusée localement | — |
| Champ « Profil » sur sa propre ligne | « Profil » désactivé | aide : « Vous ne pouvez pas modifier votre propre profil. » | — |
| Messages d'erreur | `409 profiles.channel_taken` : « Ce canal a déjà un compte agent. » sous « Canal » ; `409 profiles.agent_requires_user_role` : « Un compte agent doit avoir le rôle Utilisateur. » sous « Rôle » ; `409 profiles.channel_required` : « Choisissez un canal pour un compte agent. » ; `409 profiles.cannot_change_own_profile` : « Vous ne pouvez pas modifier votre propre profil. » ; `400` : « Données invalides. Vérifiez les champs. » | dialogue ouvert, saisies conservées | `PUT /user-profiles/:userId` |
| Échec du chargement des profils | alerte « Impossible de charger les profils. » avec « Réessayer » | le tableau reste lisible sans la colonne remplie (« — ») ; « Enregistrer » est désactivé dans les dialogues | `GET /user-profiles` |

## Règles
- `rule-recouvrement-users-profile-screen` (inferred) : l'administrateur du socle attribue les profils (énoncé de la demande) depuis l'écran des comptes ; aucun autre écran ne le permet.
- `rule-recouvrement-users-profile-local-validation` (inferred) : validation locale sans appel : « Compte agent » exige un « Canal » ; « Canal » est masqué et non envoyé pour tout autre profil ; « Compte agent » avec le rôle « Administrateur » est refusé avec le message de `profiles.agent_requires_user_role`. Les règles font foi côté API (`profils-api-modification-request.md`).
- `rule-recouvrement-users-profile-two-calls` (inferred) : l'attribution est un second appel après la création ou la modification du compte ; « Aucun profil » sur un compte sans profil n'envoie rien ; « Aucun profil » sur un compte qui en a un envoie `{ profile: null, channel: null }`.
- `rule-recouvrement-users-single-profile` (inferred, default Q-RECOUVREMENT-02) : un seul profil par compte, champ « Profil » à choix unique. (Option B : champ « Profils » à choix multiple sans « Compte agent » cumulable.)

## Accès
Administrateur du socle seulement (`rule-foundation-admin-screens-guard` inchangée). Un utilisateur ordinaire, même superviseur, voit « Accès refusé » et aucun appel n'est fait.

## Hypothèses
- La liste des profils est jointe à la liste des comptes par l'identifiant du compte ; un compte absent de `GET /user-profiles` n'a pas de profil.
- Le mot de passe d'un compte agent est transmis à la personne qui configure l'agent hors du studio (aucune fonction d'invitation ou de jeton dans cette version, option A de Q-RECOUVREMENT-03).
- L'import de comptes du socle (`/utilisateurs/import`) ne porte pas de profil : les profils s'attribuent ensuite, compte par compte.
