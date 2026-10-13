# 30 — Comptes utilisateurs

Routes : `GET /users`, `POST /users`, `GET /users/:id`, `PATCH /users/:id` ; l'import en masse est dans `60-import.md`. Écran : `/utilisateurs` (`70-ecrans.md`).

## 1. Représentation d'un compte

`UserDto` = `{ id, email, role, groups }` où `groups` est la liste `{ id, name }` des groupes du compte, **triée par nom sans tenir compte de la casse, puis par identifiant**. `role` vaut `user` ou `admin`. Aucune autre propriété (ni mot de passe, ni empreinte, ni entreprise).

| Route | Réponse |
|---|---|
| `GET /users` | `200 { users: UserDto[], total }`, comptes **triés par e-mail** (ordre croissant, puis identifiant) |
| `GET /users/:id` | `200 { user: UserDto }` |
| `POST /users` | `201 { user: UserDto }` |
| `PATCH /users/:id` | `200 { user: UserDto }` (état après modification) |

## 2. Règles

### `rule-foundation-users-admin-screen` (user) — Administration des comptes réservée aux administrateurs
Les administrateurs créent des comptes et modifient leur rôle et leurs groupes, dans un écran en français. Côté API, `POST /users`, `PATCH /users/:id` et `GET /users` sont réservés au rôle `admin` : utilisateur ordinaire `403 security.access_denied`, visiteur `401`. Sur `PATCH /users/:id` : identifiant mal formé `400 api.validation.incoming_failed`, identifiant inconnu `404 repository.not_found`.

### `rule-foundation-users-list-admin-only` (user) — Seul un administrateur liste les comptes
`GET /users` : administrateur `200` (liste paginée, voir `rule-foundation-list-pagination`, comptes triés par e-mail avec leurs groupes triés par nom) ; utilisateur ordinaire `403 security.access_denied` ; visiteur `401`. Un utilisateur ordinaire ne peut donc pas obtenir la liste des e-mails.

### `rule-foundation-users-get-self-or-admin` (user) — Lecture de son propre compte, ou de tout compte pour un administrateur
`GET /users/:id` :
- un administrateur lit n'importe quel compte (avec ses groupes) ; identifiant inconnu `404 repository.not_found` ; identifiant mal formé `400 api.validation.incoming_failed` ;
- un utilisateur ordinaire lit **son propre** compte et ses groupes (`200`) ;
- un utilisateur ordinaire qui demande tout autre identifiant reçoit **`403 security.access_denied`**, que le compte existe ou non, qu'il soit administrateur ou non, et **même si l'identifiant est mal formé** : la vérification de propriété a lieu avant toute validation de format et toute recherche, pour ne rien révéler ;
- visiteur `401`.

### `rule-foundation-user-create-fields` (inferred) — Champs de création
`POST /users` avec le corps `{ email, password, role, groupIds? }` :
- `email` : adresse e-mail valide, au plus **254** caractères (254 accepté, 255 refusé) ; enregistrée telle que saisie (pas de mise en minuscules) ;
- `password` : de **8 à 72** caractères (7 et 73 refusés, 8 et 72 acceptés) ; seule son empreinte bcrypt (coût 10) est stockée, dans `base.credentials` ;
- `role` : `user` ou `admin` ;
- `groupIds` (facultatif, aucun groupe par défaut) : de 0 à **100** identifiants uuid **distincts** de groupes **existants**.
Tout manquement (champ manquant, mauvais type, rôle ou e-mail invalide, doublon ou identifiant mal formé dans `groupIds`, 101 éléments, groupe inconnu) donne `400 api.validation.incoming_failed` et ne crée **ni compte, ni secret, ni appartenance**. Un compte créé peut se connecter avec ce mot de passe et lire ses groupes.

### `rule-foundation-user-email-unique` (inferred) — Un compte par e-mail
Un e-mail déjà utilisé (égalité exacte, sensible à la casse) donne `409 users.email_already_exists` (et non `400`), sans laisser d'appartenance orpheline. Quatre créations simultanées avec le même e-mail donnent exactement un `201` et trois `409`, jamais de 500. Unicité garantie par la base (index unique sur `base.users.email`).

### `rule-foundation-user-groups-membership` (user) — Appartenance à zéro, un ou plusieurs groupes
- Un compte appartient à 0, 1 ou plusieurs groupes, fixés à la création (`groupIds`) et **remplacés** par `PATCH /users/:id` (`groupIds: []` retire tous les groupes ; `groupIds` absent les laisse inchangés).
- Ce sont les mêmes appartenances que celles éditées depuis le groupe (`base.group_users`) : un compte ajouté depuis le groupe apparaît dans les `groups` du compte, et inversement ; la dernière écriture l'emporte.
- Un groupe inconnu dans la liste : `400`, l'opération entière est annulée (ni compte créé, ni rôle modifié).
- Un compte nouvellement créé avec des groupes se connecte et lit ses groupes par `GET /users/:id`.

### `rule-foundation-user-edit-scope` (inferred) — Modification limitée au rôle et aux groupes
`PATCH /users/:id` n'accepte que `role?` (`user` | `admin`) et `groupIds?` (mêmes contraintes qu'à la création) :
- toute autre clé (`email`, `password`, `id`, clé inconnue) donne `400 api.validation.incoming_failed` et rien n'est modifié (le mot de passe continue de fonctionner) ;
- un corps vide `{}` répond `200` avec le compte inchangé ;
- un rôle invalide ou des `groupIds` invalides donnent `400` ;
- rôle et groupes sont modifiés ensemble, de façon atomique.
Ni l'e-mail ni le mot de passe ne sont modifiables dans cette version.

### `rule-foundation-user-own-role-locked` (inferred) — Un administrateur ne change pas son propre rôle
Un administrateur qui envoie sur **son propre** compte un `role` différent de son rôle actuel reçoit `409 users.cannot_change_own_role`, et **rien** n'est appliqué (pas même les groupes envoyés dans la même requête). Renvoyer son rôle actuel est accepté ; modifier seulement ses groupes est accepté. À l'écran, le champ « Rôle » est désactivé sur sa propre ligne.

### `rule-foundation-user-no-delete` (inferred) — Pas de suppression de compte
Aucune route de suppression ni de désactivation : `DELETE /users/:id` répond `404` et le compte est conservé. L'écran n'offre aucune action de suppression.

### Rappels liés (règles décrites ailleurs)
- `rule-foundation-user-no-group-no-data` (user) : un compte sans groupe ne voit aucune donnée rattachée à un périmètre (`40-groupes-perimetres.md`).
- `rule-foundation-no-self-signup` (user) : seul un administrateur crée des comptes (`20-authentification-session.md`).
- Traces : `POST /users` et `PATCH /users/:id` laissent chacune une entrée au journal (`50-journal-audit.md`).

## 3. Limites connues (pas des règles)
- Les utilisateurs ordinaires n'ont pas d'écran propre : leur compte est lisible par l'API mais le studio ne l'utilise pas.
- Le mot de passe est borné en **caractères** (8–72) ; un mot de passe multi-octets dont l'encodage dépasse 72 octets est tronqué silencieusement par bcrypt (Q-COMPTES-01).
