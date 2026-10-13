# Demande à l'API : profils de recouvrement et garde de profil

Écrans demandeurs : Utilisateurs (attribution), mise en page commune et Accueil (menu selon le profil), tous les écrans de recouvrement (garde). Besoin : attribuer à un compte du socle un profil (Superviseur, Compte agent, Service litiges, Lecteur des indicateurs), le lire pour construire le menu, et refuser côté serveur toute route de recouvrement à un compte qui n'a pas le profil requis.

Les routes de la fonctionnalité `profiles` vivent dans un nouveau dossier ; aucune table contractuelle du socle n'est modifiée (`base.users.role` reste `user` | `admin`, l'énumération `base.user_role` n'est pas étendue). Les profils sont rangés dans une table nouvelle de la fonctionnalité (voir Compatibilité).

## Opérations
Convention de lecture : « garde de profil P » = déclaration `roles: []` avec une garde métier qui admet le compte portant le profil P ; sans jeton `401 security.missing_token` / `security.invalid_token`, avec un jeton d'un autre profil `403 security.access_denied`, avant toute validation et lecture du corps. Les listes suivent `rule-foundation-list-pagination` (`from` 0 à 2147483647, `size` 1 à 100, défaut 10, réponse `{ items, total }`).

| Méthode et chemin | Action déclarée | Rôles | Entrée (bornes comprises) | Réponses (codes et formes) |
|---|---|---|---|---|
| `GET /profiles/me` | `profiles:me` | tout compte connecté (`user`, `admin`) | aucune | `200 { profile: 'supervisor' \| 'agent' \| 'litigation' \| 'indicators' \| null, channel: 'voice' \| 'email_sms' \| 'mail' \| null }` ; `401` visiteur |
| `GET /user-profiles` | `profiles:list` | `admin` | `from`, `size` | `200 { items: UserProfileDto[], total }` triés par e-mail ; seuls les comptes ayant un profil y figurent ; `403` non-administrateur ; `401` visiteur |
| `PUT /user-profiles/:userId` | `profiles:set` | `admin` | `userId` uuid ; corps strict `{ profile: 'supervisor' \| 'agent' \| 'litigation' \| 'indicators' \| null, channel?: 'voice' \| 'email_sms' \| 'mail' \| null }` | `200 { userProfile: UserProfileDto }` (état après modification ; `profile: null` retire le profil, l'objet porte alors `profile: null, channel: null`) ; `400 api.validation.incoming_failed` ; `404 repository.not_found` compte inconnu ; `409 profiles.channel_required` ; `409 profiles.channel_not_allowed` ; `409 profiles.channel_taken` ; `409 profiles.agent_requires_user_role` ; `409 profiles.cannot_change_own_profile` |

`UserProfileDto` = `{ userId: uuid, email: string, profile: Profile | null, channel: Channel | null }`. `Profile` = `supervisor` | `agent` | `litigation` | `indicators` ; `Channel` = `voice` | `email_sms` | `mail`. Aucune autre propriété.

Gardes de profil de la version, pour mémoire (déclarées route par route dans les autres demandes) : `supervisor`, `agent`, `litigation`, `indicators`. Le journal (`GET /audit-logs`, `GET /audit-logs/filters`) admet en plus le superviseur (voir `journal-api-modification-request.md`).

Trace d'audit : `PUT /user-profiles/:userId` est tracée (type d'objet « Profil de compte », identifiant = `userId`, résumé français « Profil Superviseur attribué à <e-mail>. » / « Profil retiré à <e-mail>. » / « Profil Compte agent (canal Voix) attribué à <e-mail>. »).

## Règles
- `rule-recouvrement-profiles-assigned-by-admin` (user) : seul l'administrateur du socle crée les comptes et attribue les profils (`PUT /user-profiles/:userId`) ; un compte sans profil n'a aucun droit de recouvrement (sauf option B de Q-RECOUVREMENT-01 pour l'administrateur).
- `rule-recouvrement-profile-server-enforced` (user) : chaque route de recouvrement vérifie le profil du compte à chaque requête, depuis la base (pas depuis le jeton) ; un changement de profil est effectif à la requête suivante ; masquer un bouton ne suffit pas. Le refus est `403 security.access_denied`, sans révéler l'existence de l'objet demandé.
- `rule-recouvrement-profile-single` (inferred, default Q-RECOUVREMENT-02) : un compte porte au plus un profil ; `PUT` avec un autre profil remplace le précédent. (Option B : corps `{ profiles: Profile[] }` ; le profil `agent` n'est jamais cumulable.)
- `rule-recouvrement-admin-no-business-access` (inferred, default Q-RECOUVREMENT-01) : un compte de rôle `admin` sans profil reçoit `403 security.access_denied` sur toutes les routes de recouvrement (hors `GET /profiles/me`, `GET /user-profiles`, `PUT /user-profiles/:userId` et le journal). Un administrateur peut porter un profil ; il exerce alors celui-ci.
- `rule-recouvrement-agent-channel-required` (user) : le profil `agent` exige un `channel` (compte machine, un par canal) : sans canal `409 profiles.channel_required` ; un canal sur un autre profil `409 profiles.channel_not_allowed`.
- `rule-recouvrement-agent-one-per-channel` (user) : au plus un compte agent par canal ; un second `409 profiles.channel_taken` (la base garantit l'unicité par un index unique partiel sur le canal des comptes agent).
- `rule-recouvrement-agent-user-role` (inferred) : le profil `agent` n'est attribuable qu'à un compte de rôle `user` (`409 profiles.agent_requires_user_role`) ; inversement, un compte agent ne peut pas devenir `admin` : `PATCH /users/:id` du socle reste inchangé, la contrainte est contrôlée à l'attribution du profil et par une contrainte de la base sur la table des profils (trigger ou clé composée sur le rôle), sans modifier `PATCH /users/:id`.
- `rule-recouvrement-own-profile-locked` (inferred) : un administrateur ne modifie pas son propre profil (`409 profiles.cannot_change_own_profile`), par analogie avec `rule-foundation-user-own-role-locked`.
- `rule-recouvrement-profile-no-delete` (inferred) : aucune route de suppression ; retirer un profil se fait par `profile: null` ; le compte n'est jamais supprimé (`rule-foundation-user-no-delete`).

## Compatibilité
- Aucune opération existante n'est modifiée. `GET /auth/current-user` reste `{ id, email, role }` : le studio lit le profil par `GET /profiles/me` (pas de rupture du contrat de référence).
- Données : une table nouvelle `base.user_profiles` (`user_id` uuid clé primaire et clé étrangère vers `base.users(id)` en CASCADE, `profile` énumération, `channel` énumération nullable, `created_at`, `updated_at`), index unique partiel sur `channel` pour `profile = 'agent'`, contrainte `channel IS NOT NULL` ssi `profile = 'agent'`. C'est un ajout au contrat de données de la base : `specifications/socle/data-contract.md` est en lecture seule pour les agents de fabrication, donc le propriétaire de la recette doit l'étendre ; en attendant, l'agent de fabrication ouvre `OPEN: contract data-contract: base.user_profiles ajoutée pour les profils de recouvrement` dans `DISPUTES.md`. La recette crée les comptes par SQL dans `base.users` et `base.credentials` puis le profil dans `base.user_profiles`.
- `specifications/permissions.yaml` : ajouter une ligne par opération de ce fichier et de chaque demande de la version (les lignes `allow` sont exprimées en `anonymous | user | admin` : une route à garde de profil est observée `allow: []` et `customGuards` renseigné).
- Dossiers `api/src/features/users/**` et `api/src/features/auth/**` gelés : non touchés.
