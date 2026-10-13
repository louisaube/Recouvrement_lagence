# 50 — Journal d'audit

Routes : `GET /audit-logs`, `GET /audit-logs/filters` (lecture seule). Écran : `/journal` (`70-ecrans.md`). Table : `base.audit_logs` (`out/data-contract.md`).

## 1. Contenu d'une entrée

`AuditEntryDto` = `{ id, occurredAt, actor: { id, email }, action, objectType, objectId, scope, summary }`.

| Champ | Colonne | Contenu |
|---|---|---|
| `id` | `id` | uuid de l'entrée |
| `occurredAt` | `occurred_at` | instant de l'écriture, ISO 8601 UTC à la milliseconde (`2026-01-31T10:15:30.123Z`) |
| `actor.id` | `actor_id` | identifiant du compte auteur (sans lien contraint vers `base.users`) |
| `actor.email` | `actor_email` | **copie** de l'e-mail de l'auteur au moment de l'action (1 à 254 caractères) |
| `action` | `action` | code `<fonctionnalité>:<verbe>` (1 à 100) : le code d'action déclaré par la route, par exemple `groups:update` |
| `objectType` | `object_type` | libellé **français** du type d'objet (1 à 100), choisi une fois pour toutes par la fonctionnalité |
| `objectId` | `object_id` | identifiant de l'objet visé, texte de 1 à 100 caractères, pas forcément un uuid |
| `scope` | `scope_code` | code du périmètre visé (1 à 50) ou `null` |
| `summary` | `summary` | résumé lisible en français, 1 à 500 caractères, sans secret |

La base garantit ces bornes (contraintes de longueur). La table n'a ni date de création ni date de modification : `occurred_at` est la seule date.

### Entrées produites par le socle

| Route | `action` | `objectType` | `objectId` | `scope` | Résumé |
|---|---|---|---|---|---|
| `POST /users` | `users:create` | `Utilisateur` | id du compte | `null` | « Création du compte <e-mail> (rôle Administrateur\|Utilisateur, <n> groupe(s)) » |
| `PATCH /users/:id` | `users:update` | `Utilisateur` | id du compte | `null` | « Modification du compte <e-mail> (<champs envoyés : rôle, groupes>) » |
| `POST /scopes` | `scopes:create` | `Périmètre` | id du périmètre | code du périmètre | « Création du périmètre « <nom> » (<code>) » |
| `PATCH /scopes/:id` | `scopes:update` | `Périmètre` | id du périmètre | code du périmètre | « Modification du périmètre <code> (nouveau nom : « <nom> ») » |
| `POST /groups` | `groups:create` | `Groupe` | id du groupe | `null` | « Création du groupe « <nom> » (<n> membre(s), <m> périmètre(s) : <codes>) » |
| `PATCH /groups/:id` | `groups:update` | `Groupe` | id du groupe | `null` | « Modification du groupe « <nom> » (<champs envoyés : nom, membres, périmètres>) » |
| `POST /users/imports/:importId/confirm` | `users:import-confirm` | `Import de comptes` | `importId` | `null` | « Import de <n> compte(s) depuis « <nom du fichier> » » |

Accords : singulier pour 0 et 1, pluriel au-delà (« 0 membre, 1 périmètre », « 2 comptes », « 1 compte »). Exemple réel : « Création du groupe « Équipe du Parc » (0 membre, 1 périmètre : creche-parc) ». Pour une modification, le résumé cite les **noms** des champs envoyés, jamais leurs valeurs (sauf le nouveau nom d'un périmètre, donnée publique) ; il ne décrit pas l'avant/après.

## 2. Règles

### `rule-foundation-audit-trace-content` (user) — Toute écriture réussie laisse une trace complète
Toute action réussie qui crée, modifie ou supprime des données métier ou d'administration laisse **exactement une** entrée : auteur (identifiant et e-mail), date, code d'action, type d'objet, identifiant d'objet, périmètre le cas échéant, résumé. Pour le socle : les sept routes du tableau ci-dessus. Deux administrateurs différents laissent chacun leur propre identité. Une requête refusée (401, 403, 400, 404, 409) ne laisse aucune entrée. Le mécanisme couvre aussi les suppressions des futures fonctionnalités (code `<fonctionnalité>:delete`), bien qu'aucune route de suppression n'existe dans le socle.

### `rule-foundation-audit-declarative-route` (user) — Une route est tracée par simple déclaration
Une fonctionnalité déclare qu'une route est tracée, en fournissant le type d'objet et la façon d'en tirer l'identifiant d'objet, le résumé et le périmètre ; elle n'écrit jamais l'entrée elle-même. Le code d'action est celui du régime d'accès de la route (pas de seconde déclaration). Toute route d'écriture (`POST`, `PUT`, `PATCH`, `DELETE`) doit être tracée ou figurer dans une liste explicite et motivée d'exceptions (connexion, déconnexion, analyse d'aperçu d'import, routes de test) ; un contrôle automatique avant livraison échoue en nommant toute route d'écriture qui n'est ni tracée ni exemptée. Une route tracée apparaît dans l'écran et ses filtres sans modification de l'écran. Détails pour les auteurs de fonctionnalités : `90-capacites-pour-le-metier.md`.

### `rule-foundation-audit-immutable` (user) — Le journal n'est ni modifiable ni effaçable par l'application
- Aucune route d'écriture sous `/audit-logs` : `POST`, `PUT`, `PATCH`, `DELETE` sur `/audit-logs`, `/audit-logs/filters`, `/audit-logs/:id` ne réussissent jamais, pour aucun rôle (administrateur : `404` ; visiteur : `401` ou `404`), et le journal reste inchangé.
- L'application ne dispose d'aucune opération de modification ou de suppression d'entrée, même pour un administrateur.
- L'écran n'offre aucune commande de modification, de suppression ni d'export.

### `rule-foundation-audit-db-append-only` (inferred) — Protection au niveau de la base
La base de données elle-même refuse toute modification (`UPDATE`) et toute suppression de ligne (`DELETE`) dans `base.audit_logs`, y compris par la connexion de l'application et à l'intérieur d'une transaction (erreur PostgreSQL de privilège, SQLSTATE `42501`) ; les lignes restent inchangées. Le vidage complet (`TRUNCATE`) est refusé lui aussi, **sauf** dans la base de recette, que le harnais de recette vide entièrement entre deux scénarios. Limite assumée : le propriétaire de la table peut toujours la supprimer ou désactiver la protection ; en déploiement, l'application doit se connecter avec un rôle n'ayant que la lecture et l'insertion sur cette table.

### `rule-foundation-audit-survives-author-deletion` (user) — La trace survit à la suppression de son auteur
Aucune contrainte ne lie `actor_id` à `base.users` (ni `scope_code` à `base.scopes`) et l'e-mail est copié. Si le compte auteur est supprimé (par SQL : aucune route ne le permet), ses entrées restent inchangées, listées avec l'e-mail d'origine, filtrables par `actorId`, et l'auteur reste présent dans les valeurs de filtre.

### `rule-foundation-audit-admin-only` (user) — Seuls les administrateurs consultent le journal
`GET /audit-logs` et `GET /audit-logs/filters` : administrateur `200` ; utilisateur ordinaire `403 security.access_denied` sans aucune donnée ; visiteur `401` ; jeton invalide `401`. Le refus de rôle précède la validation des paramètres (un utilisateur avec des paramètres invalides reçoit `403`). Un utilisateur ordinaire refusé sur une route tracée ne laisse aucune entrée. À l'écran, l'onglet « Journal » n'est montré qu'aux administrateurs.

### `rule-foundation-audit-filters` (user) — Filtres par auteur, action, type d'objet, périmètre et période
`GET /audit-logs` accepte, en plus de `from` (0 à 2147483647, défaut 0) et `size` (1 à 100, défaut 10) :

| Paramètre | Contrainte | Effet |
|---|---|---|
| `actorId` | uuid | entrées de cet auteur (compte supprimé compris) |
| `action` | 1 à 100 caractères | égalité exacte du code (`groups:upd` ne trouve pas `groups:update`) |
| `objectType` | 1 à 100 caractères | égalité exacte |
| `scope` | 1 à 50 caractères | égalité exacte du code de périmètre |
| `occurredFrom` | date-heure ISO 8601 **avec fuseau** (`Z` ou décalage), 16 à 35 caractères | `occurredAt` ≥ borne (incluse) |
| `occurredTo` | idem, pas antérieure à `occurredFrom` | `occurredAt` ≤ borne (incluse) |

Pas de joker, pas de rognage, pas de recherche plein texte. Répondent `400 api.validation.incoming_failed` : pagination hors bornes, `actorId` non uuid, valeur vide ou trop longue, date invalide, date sans fuseau, date impossible (`2026-02-30T00:00:00Z`), année hors 1000–9999, `occurredFrom` postérieur à `occurredTo`, paramètre répété, caractère nul. Les longueurs limites sont acceptées.

### `rule-foundation-audit-filters-combine` (inferred) — Les filtres se combinent par ET
Les filtres présents se combinent par ET ; un filtre absent n'est pas appliqué ; une valeur vide est une erreur `400`. `total` compte les entrées correspondant à l'ensemble des filtres, indépendamment de la pagination.

### `rule-foundation-audit-newest-first` (inferred) — Plus récentes d'abord
Ordre fixe : `occurredAt` décroissant, puis `id` décroissant en cas d'égalité ; ordre total et stable d'une page à l'autre ; non modifiable par le client. Des actions réelles successives apparaissent de la plus récente à la plus ancienne.

### `rule-foundation-audit-ms-precision` (inferred) — Précision à la milliseconde
`occurred_at` est enregistré tronqué à la milliseconde (aucune partie sub-milliseconde stockée) : c'est l'heure de la base au moment de l'écriture. Les bornes `occurredFrom` / `occurredTo` sont incluses à la milliseconde près des deux côtés (une entrée à `…23:59:59.999Z` est incluse par `occurredTo=…23:59:59.999Z`).

### `rule-foundation-audit-filter-options-from-journal` (inferred) — Valeurs de filtre tirées du journal
`GET /audit-logs/filters` renvoie `{ actors, actions, objectTypes, scopes }` calculés **uniquement** à partir des entrées du journal (jamais à partir des comptes ou des périmètres existants) :
- journal vide → quatre listes vides, même s'il existe des comptes et des périmètres ; un compte qui n'a jamais agi n'apparaît pas ;
- `actors` : un élément par auteur `{ id, email }`, avec l'e-mail de sa **dernière** entrée ; trié par e-mail sans tenir compte de la casse, puis identifiant ; un auteur supprimé reste présent ;
- `actions`, `objectTypes`, `scopes` : valeurs distinctes, non nulles (pas de `null` dans `scopes`), triées ;
- au plus 1000 éléments par liste ;
- les paramètres de requête éventuels sont ignorés ; refus de rôle comme `rule-foundation-audit-admin-only`.

### `rule-foundation-audit-summary-no-secret` (inferred) — Aucun secret dans le journal
Un résumé ne contient jamais de mot de passe, de jeton ni d'empreinte : après `POST /users`, ni le mot de passe envoyé, ni son empreinte bcrypt, ni un jeton n'apparaissent dans aucune colonne de `base.audit_logs` ni dans la réponse de l'API. Pour un import, ni les e-mails importés, ni le contenu du fichier, ni son empreinte n'y figurent. Le résumé est construit à partir de la réponse de l'action et des noms des champs envoyés. Il est normalisé : espaces et caractères de contrôle consécutifs réduits à un espace, coupé à 500 caractères avec « … ». L'écran l'affiche en texte brut, jamais interprété comme du HTML.

### `rule-foundation-audit-reads-not-traced` (inferred) — Les lectures ne sont pas tracées
Aucune route `GET` n'est tracée : consulter le journal, ses filtres, les comptes, les groupes ou les périmètres ne laisse aucune entrée.

### `rule-foundation-audit-scope-of-trace` (inferred) — Connexion et déconnexion non tracées
`POST /auth/login` et `POST /auth/logout` ne laissent aucune entrée : ils ne créent ni ne modifient de données métier ou d'administration.

### `rule-foundation-audit-atomic-with-action` (inferred) — Trace et action dans la même transaction
L'entrée est écrite dans la même transaction que l'action : les deux sont validées ou aucune. Elle n'est écrite que si l'action a réussi (réponse 2xx). Une erreur de validation (400), une ressource inconnue (404), un conflit (409, y compris lors de créations simultanées : un seul `201` et une seule entrée), un membre inconnu, une erreur du traitement, une description de trace invalide ou une réponse non conforme au contrat ne laissent **ni entrée ni donnée**. L'e-mail de l'auteur est lu juste avant l'action ; un jeton valide dont le compte n'existe plus reçoit `401 security.invalid_token` sur une route tracée.

### `rule-foundation-audit-scope-field` (inferred) — Le champ périmètre
`scope` est le code de l'unique périmètre visé par l'action : `scopes:create` et `scopes:update` portent le code du périmètre ; les entrées `users:*` et `groups:*` (et l'import de comptes) portent `null` (un compte ou un groupe n'est pas rattaché à un seul périmètre ; les périmètres d'un groupe figurent dans son résumé). Une future table métier rattachée à un périmètre renseigne le code de la ligne visée.

### `rule-foundation-audit-no-op-traced` (inferred) — Toute requête acceptée est tracée, même sans effet
Tout appel réussi d'une route tracée est tracé, même s'il n'a rien changé : `PATCH /groups/:id` avec `{}` laisse une entrée. Le journal enregistre les requêtes acceptées, pas des différences.

### `rule-foundation-audit-french-screen` (user) — Journal lisible en français
L'API renvoie le code d'action (`groups:update`) tel quel ; les types d'objet (`Utilisateur`, `Groupe`, `Périmètre`, `Import de comptes`) et les résumés sont en français. L'écran traduit le verbe (« Création », « Modification », « Suppression »), affiche dates et libellés en français (voir `70-ecrans.md`).

### Règles d'écran du journal
`rule-foundation-audit-shareable-filter`, `rule-foundation-audit-period-inclusive-days` et `rule-foundation-audit-url-sanitized` sont décrites dans `70-ecrans.md` (§ Journal d'audit).

## 3. Limites connues (pas des règles)
- Les modifications de comptes et de groupes ne sont pas filtrables par périmètre (`scope` = `null`) ; pas de filtre « sans périmètre », ni recherche plein texte, ni export, ni page de détail.
- Un import produit une seule entrée (pas une par compte créé) ; le lien entre l'entrée et les comptes est la ligne conservée de `base.import_previews` (`id` = `objectId`).
- Renommer un type d'objet scinderait l'historique : un libellé choisi est définitif.
