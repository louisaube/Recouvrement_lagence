# 40 — Groupes, périmètres et règle par ligne

Routes : `GET /scopes`, `POST /scopes`, `PATCH /scopes/:id`, `GET /groups`, `POST /groups`, `PATCH /groups/:id`. Écrans : `/perimetres`, `/groupes` (`70-ecrans.md`). Tables : `base.scopes`, `base.groups`, `base.group_users`, `base.group_scopes` (`out/data-contract.md`).

## 1. Périmètres

`ScopeDto` = `{ id, code, name }`. `GET /scopes` → `200 { scopes, total }` trié par `code` croissant. `POST /scopes` → `201 { scope }`. `PATCH /scopes/:id` → `200 { scope }`.

### `rule-foundation-scope-definition` (user) — Définition d'un périmètre
Un périmètre est un ensemble nommé de données (un site, une crèche…) identifié par un **code** unique et doté d'un **nom**, tous deux saisis à la création. `POST /scopes { code, name }` crée le périmètre et renvoie `{ id, code, name }` exactement ; le nom est enregistré **rogné** (espaces de bord retirés) ; le périmètre est persistant et apparaît dans `GET /scopes`.

### `rule-foundation-scope-code-unique` (user) — Code unique
Un code déjà utilisé donne `409 scopes.code_already_exists`. Quatre créations simultanées du même code donnent exactement un `201` et trois `409`, jamais de 500. Unicité garantie par la base (index unique sur `base.scopes.code`). À l'écran, le message « Ce code est déjà utilisé. » apparaît sous le champ.

### `rule-foundation-scope-code-format` (inferred) — Format du code et du nom
- `code` : de 1 à 50 caractères respectant `^[a-z0-9][a-z0-9_-]{0,49}$` : lettres minuscules non accentuées, chiffres, `_` et `-`, ne commençant pas par un séparateur. Refusés : majuscule, espace, accent, `-` ou `_` en tête, point, vide, 51 caractères. Aucune mise en minuscules automatique.
- `name` : de 1 à 100 caractères, non vide après rognage (vide, blanc ou 101 caractères refusés).
- Champs manquants ou de mauvais type refusés.
Tout manquement : `400 api.validation.incoming_failed`, rien n'est créé. Les bornes (1 et 50 caractères pour le code, 100 pour le nom) sont acceptées.

### `rule-foundation-scope-code-immutable` (inferred) — Code immuable
`PATCH /scopes/:id` n'accepte que `{ name }` (requis, mêmes bornes) : un corps contenant `code` ou toute autre clé donne `400 api.validation.incoming_failed` et le périmètre reste inchangé. Le code est ce que les tables métier référencent ; la base refuse aussi toute modification d'un code référencé.

### `rule-foundation-scope-no-delete` (inferred) — Pas de suppression de périmètre
`DELETE /scopes/:id` et `DELETE /scopes` répondent `404` ; le périmètre est conservé. La base refuse la suppression d'un périmètre référencé par un groupe ou une ligne métier.

### `rule-foundation-scopes-admin-screen` (user) — Gestion des périmètres réservée aux administrateurs
Les trois routes sont réservées au rôle `admin` : utilisateur ordinaire `403 security.access_denied`, visiteur `401`. `PATCH /scopes/:id` : identifiant mal formé `400`, inconnu `404 repository.not_found`. La table des périmètres elle-même n'est pas filtrée par périmètre (un administrateur voit tous les périmètres dans l'écran d'administration).

## 2. Groupes

`GroupDto` = `{ id, name, members: { id, email }[], scopes: ScopeDto[] }`. `GET /groups` → `200 { groups, total }`. `POST /groups` → `201 { group }`. `PATCH /groups/:id` → `200 { group }` (état après modification).

### `rule-foundation-group-definition` (user) — Définition d'un groupe
Un groupe a un nom, des membres (comptes) et des périmètres ; il donne à ses membres accès à ses périmètres. Nom, membres et périmètres sont créés ensemble en une seule requête atomique (`POST /groups { name, userIds?, scopeIds }`) et modifiés ensemble :
- `PATCH /groups/:id { name?, userIds?, scopeIds? }` : chaque champ **fourni remplace** la valeur actuelle ; un champ absent est inchangé (nom seul, membres seuls, périmètres seuls, ou tout à la fois) ;
- deux modifications concurrentes d'un même groupe ne s'entremêlent pas (l'une s'applique entièrement après l'autre) ;
- ordre des listes : groupes par nom **sans tenir compte de la casse**, puis identifiant ; membres par e-mail ; périmètres par code ;
- identifiant mal formé `400`, inconnu `404 repository.not_found` (la vérification d'existence du groupe précède la validation des identifiants référencés).

### `rule-foundation-group-needs-scope` (user) — Au moins un périmètre
`scopeIds` contient de **1 à 200** identifiants uuid **distincts** de périmètres **existants**, à la création et à chaque fois qu'il est fourni en modification. Liste vide ou absente à la création, doublons, identifiant inconnu ou mal formé, 201 éléments : `400 api.validation.incoming_failed`, rien n'est créé et un groupe modifié reste inchangé.

### `rule-foundation-group-members-optional` (inferred) — Membres facultatifs
`userIds` contient de **0 à 1000** identifiants uuid distincts de comptes existants ; absent à la création = aucun membre ; `[]` en modification retire tous les membres ; 1001 éléments, doublon ou compte inconnu : `400` et rien n'est écrit.

### `rule-foundation-group-name-unique` (inferred) — Nom unique sans tenir compte de la casse
Le nom fait de 1 à 100 caractères, non vide après rognage (enregistré rogné). Un nom égal à celui d'un autre groupe **sans tenir compte de la casse** (`Équipe A` / `équipe a`) donne `409 groups.name_already_exists`, à la création comme au renommage ; lors d'un renommage refusé, rien de la même requête n'est appliqué (ni membres, ni périmètres). Renommer un groupe en son propre nom avec une autre casse est accepté. Créations simultanées : jamais de 500. Unicité garantie par la base (index unique sur `lower(name)`).

### `rule-foundation-group-no-delete` (inferred) — Pas de suppression de groupe
`DELETE /groups/:id` répond `404` ; le groupe est conservé.

### `rule-foundation-groups-admin-screen` (user) — Gestion des groupes réservée aux administrateurs
Les trois routes sont réservées au rôle `admin` : utilisateur ordinaire `403 security.access_denied`, visiteur `401` ; identifiant inconnu `404`, mal formé `400`.

## 3. Règle par ligne (mécanisme réutilisable)

Le socle n'a **aucune table métier** dans cette version : ces règles s'appliquent aux tables que les futures fonctionnalités rattacheront à un périmètre (voir `90-capacites-pour-le-metier.md`). Elles ne sont pas observables par la recette sur les routes du contrat ; elles doivent néanmoins être implémentées et prouvées par des tests propres à la réécriture (par exemple une table et des routes de test présentes seulement en environnement de test, EXI-PLAT-12). Les données d'entrée du mécanisme (groupes, appartenances, périmètres des groupes) sont, elles, couvertes par la recette.

### Ce que voit un utilisateur

**Périmètres atteints** : pour un utilisateur ordinaire, ce sont les codes des périmètres de tous les groupes dont il est membre (chemin compte → `group_users` → `group_scopes` → `scopes.code`). Ils sont **relus à chaque requête** : un ajout ou un retrait d'appartenance, ou une modification des périmètres d'un groupe, s'applique dès la requête suivante, sans reconnexion. Pour un administrateur, voir `rule-foundation-admin-scope-access`.

### `rule-foundation-scope-row-filter` (user) — Une ligne n'est lisible et modifiable que dans un périmètre atteint
Pour toute table métier dont chaque ligne porte un code de périmètre :
- **lecture** (liste, détail, comptage, recherche) : seules les lignes dont le périmètre est atteint par l'appelant sont visibles ; les autres n'existent pas pour lui (absentes des listes, non comptées dans `total`, détail en `404`). Un périmètre atteint par deux groupes ne produit pas de doublon ;
- **modification et suppression** : seules les lignes de périmètres atteints sont touchées ; viser une ligne hors périmètre se comporte comme une ligne inexistante (`404 repository.not_found`, ou aucun effet pour une suppression en masse), et la ligne reste intacte ;
- **création et changement de périmètre** : écrire une ligne avec un code de périmètre non atteint, ou déplacer une ligne vers un tel périmètre, est refusé avec `403 scopes.access_denied` et rien n'est écrit ;
- **insertion avec mise à jour en cas de conflit** : une ligne d'un périmètre non atteint qui entre en conflit n'est jamais modifiée, et la mise à jour ne peut pas changer le code de périmètre ;
- les écritures en masse (plusieurs lignes) appliquent les mêmes filtres que les écritures unitaires ;
- chaque fonctionnalité obtient ce filtre **sans le réécrire** (voir `90-capacites-pour-le-metier.md`).

### `rule-foundation-user-no-group-no-data` (user) — Sans groupe, aucune donnée
Un utilisateur ordinaire membre d'aucun groupe n'atteint aucun périmètre : ses lectures de données rattachées à un périmètre sont vides (comptage 0, détail introuvable) et toutes ses écritures sur ces données sont refusées (`403 scopes.access_denied` pour une création, `404` pour une modification d'une ligne existante). Un compte sans groupe a `groups: []` dans l'API. Le formulaire de compte le rappelle sous « Groupes ».

### `rule-foundation-admin-scope-access` (user) — Accès d'un administrateur, réglable par route
Par défaut, un administrateur atteint **tous** les périmètres, en lecture et en écriture ; un code de périmètre inconnu dans une écriture donne alors `400 api.validation.incoming_failed` (jamais une erreur de clé étrangère). Une route peut déclarer un accès réduit pour les administrateurs :
- **lecture seule** : l'administrateur lit toutes les lignes ; toute création, modification ou suppression répond `403 scopes.read_only` ;
- **aucun** : l'administrateur n'atteint aucun périmètre : lectures vides, écritures `403 scopes.access_denied`.
Ce réglage n'a **aucun effet sur les utilisateurs ordinaires**, qui suivent toujours leurs groupes, en lecture et en écriture. Le rôle pris en compte est celui du jeton de session.

### `rule-foundation-scope-fail-closed` (inferred) — En l'absence de contexte, aucune ligne
Si l'identité de l'appelant n'est pas établie (route publique, traitement hors requête comme une tâche planifiée), l'accès aux données rattachées à un périmètre est **nul** : lectures vides, écritures refusées. Jamais « tout ». Un traitement hors requête qui doit légitimement tout voir le déclare explicitement en indiquant l'accès sous lequel il s'exécute.

### `rule-foundation-no-multi-company` (user) — Pas de multi-entreprise
Aucune notion d'entreprise, de société ou de locataire dans cette version : aucune table, colonne, propriété de réponse, paramètre, filtre ni écran ne porte un tel champ (noms du type `company`, `companyId`, `tenant`, `entreprise` interdits). Les réponses des périmètres, groupes et comptes portent exactement les champs spécifiés ; le document OpenAPI servi ne contient aucun paramètre ni propriété de ce type.

## 4. Limites connues (pas des règles)
- Le filtre ne protège que les accès aux données passant par le mécanisme fourni par le socle ; une requête écrite à la main par une fonctionnalité doit appliquer elle-même la condition de périmètre (voir `90-capacites-pour-le-metier.md`).
- Un administrateur rétrogradé garde son rôle d'administrateur jusqu'à l'expiration de son jeton (24 h).
