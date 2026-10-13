# 10 — Plateforme : comportements transverses de l'API

Ce document décrit ce que toute route de l'API a en commun, tel qu'un client l'observe. Les comportements propres à une route sont dans les documents 20 à 60. Les points que les sources ne fixent pas (nom d'en-tête de corrélation, chemin du document OpenAPI, taille maximale d'un corps JSON, forme exacte de certains corps d'erreur) sont listés dans `99-questions-ouvertes.md` ; les exigences ci-dessous restent valables quelle que soit la réponse.

## 1. Format des erreurs

### EXI-PLAT-01 — Corps d'erreur JSON avec code stable
Toute réponse d'erreur émise par l'application (4xx, 5xx) a un corps JSON qui contient au moins :

| Champ | Type | Contenu |
|---|---|---|
| `status` | entier | le statut HTTP de la réponse |
| `code` | chaîne | code stable `<domaine>.<raison>` (liste au §2) ; c'est ce que les clients et la recette comparent |
| `message` | chaîne | texte technique en anglais, destiné aux développeurs ; jamais affiché tel quel par le studio ; ne contient ni contenu de cellule, ni secret, ni chemin de fichier, ni requête SQL, ni pile d'appel |

Le client typé de la recette rejette toute réponse non 2xx avec un objet portant `status` et `code` : ces deux champs sont donc **obligatoires et au premier niveau** du corps.

### EXI-PLAT-02 — Réponses d'erreur identiques à l'octet près pour les codes « non révélateurs »
Pour les codes qui ne doivent rien révéler, le corps ne contient **que** `status`, `code` et `message`, avec des valeurs identiques quelle que soit la cause :
- `401 security.invalid_credentials` (e-mail inconnu ou mot de passe faux, voir `rule-foundation-login-single-error`) ;
- `404 import.preview_not_found` (aperçu inconnu, expiré, encore en cours d'analyse ou appartenant à un autre administrateur, voir `rule-foundation-import-preview-owner`).

Deux réponses de ces codes à deux causes différentes doivent être égales octet pour octet (aucun champ variable : ni horodatage, ni identifiant de requête dans le corps).

## 2. Codes d'erreur stables

| Statut | Code | Signification |
|---|---|---|
| 400 | `api.validation.incoming_failed` | entrée invalide : corps, paramètre de chemin ou de requête hors bornes, de mauvais type, répété, contenant un caractère nul, clé inconnue sur une route de modification partielle, forme multipart incorrecte, référence à un identifiant inexistant dans une liste (groupes, membres, périmètres) |
| 401 | `security.missing_token` | route protégée appelée sans jeton |
| 401 | `security.invalid_token` | jeton présent mais invalide, altéré ou expiré ; ou jeton valide d'un compte qui n'existe plus |
| 401 | `security.invalid_credentials` | échec de connexion (cause jamais précisée) |
| 403 | `security.access_denied` | rôle insuffisant, ou utilisateur ordinaire lisant le compte d'un autre |
| 403 | `scopes.access_denied` | écriture visant un périmètre que l'appelant n'atteint pas (mécanisme de périmètre) |
| 403 | `scopes.read_only` | écriture tentée par un administrateur sur une route où il n'a qu'un accès en lecture aux périmètres |
| 404 | `repository.not_found` | ressource adressée inconnue (compte, groupe, périmètre, ou ligne hors périmètre) |
| 404 | `import.preview_not_found` | aperçu d'import introuvable pour l'appelant |
| 409 | `users.email_already_exists` | e-mail déjà utilisé |
| 409 | `users.cannot_change_own_role` | un administrateur tente de changer son propre rôle |
| 409 | `groups.name_already_exists` | nom de groupe déjà utilisé (sans tenir compte de la casse) |
| 409 | `scopes.code_already_exists` | code de périmètre déjà utilisé |
| 409 | `import.already_imported` | fichier déjà importé pour cette fonctionnalité |
| 400 | `import.invalid_file_type` | fichier ni `.xlsx` ni `.csv` valide, contenu en désaccord avec l'extension, fichier corrompu, tronqué ou protégé |
| 400 | `import.unsafe_archive` | classeur dont l'archive est dangereuse |
| 400 | `import.external_links` | classeur contenant des liaisons ou formules externes |
| 400 | `import.too_many_rows` | plus de lignes que le maximum |
| 400 | `import.empty_file` | en-tête valide mais aucune ligne de données |
| 400 | `import.missing_columns` | colonne obligatoire absente de l'en-tête |
| 413 | `import.file_too_large` | fichier plus gros que le maximum |
| 500 | `audit.misconfigured` | route déclarée tracée sans régime d'accès authentifié (erreur de construction, jamais atteinte en fonctionnement normal) |
| 500 | `audit.invalid_descriptor` | la description d'une trace fournie par une fonctionnalité est hors bornes (erreur de construction) ; l'action est annulée |

Ces codes sont un contrat : la réécriture doit produire exactement ces chaînes.

### EXI-PLAT-03 — Jamais de 500 sur une entrée cliente
Aucune entrée (paramètres aléatoires, octets aléatoires, conflits concurrents, fichiers piégés) ne produit une erreur 500. En particulier :
- une violation d'unicité de la base, y compris lors de deux créations simultanées, est traduite en le `409` métier correspondant ;
- une référence à un identifiant inexistant est détectée avant l'écriture et produit `400` (jamais une erreur de clé étrangère) ;
- une erreur de la base de données qui n'est pas liée à l'entrée reste un 500 (elle n'est jamais déguisée en faute de fichier ou d'entrée).

### EXI-PLAT-04 — Réponses conformes au contrat
Toute réponse 2xx respecte exactement le schéma déclaré dans le contrat OpenAPI (champs requis, types, bornes, `nullable`, nombre maximal d'éléments). Les réponses ne portent aucun champ supplémentaire non déclaré (la recette compare parfois des objets entiers, par exemple `current-user` = `{ id, email, role }`).

## 3. Identifiant de corrélation

### EXI-PLAT-05 — Corrélation des requêtes
Chaque requête reçoit un identifiant de corrélation, renvoyé au client dans un en-tête de réponse et repris dans les journaux techniques du serveur, afin de relier une réponse d'erreur à sa trace côté serveur.
- L'identifiant n'apparaît **pas** dans le corps des réponses de l'EXI-PLAT-02 (elles doivent rester identiques à l'octet près).
- Les journaux techniques ne contiennent jamais de contenu de cellule importée, de mot de passe ni de jeton.

Le nom de l'en-tête et le format de l'identifiant ne sont pas fixés par les sources : voir `99-questions-ouvertes.md` (Q-PLAT-02).

## 4. Validation et bornes des entrées

### EXI-PLAT-06 — Refus du caractère nul
Un caractère nul (`U+0000`, `%00` dans une URL) dans un paramètre de requête, un paramètre de chemin ou une valeur de corps JSON est refusé avec `400 api.validation.incoming_failed`, sur toutes les routes. Exemples vérifiés par la recette : `GET /audit-logs?action=a%00b`, `GET /audit-logs?scope=%00`, `GET /users/imports/:importId/errors?size=1%00`.

Exception documentée : dans le **nom de fichier** d'un envoi multipart d'import, les caractères nuls et de contrôle sont **remplacés** (jamais une erreur), voir `rule-foundation-import-formats`.

### EXI-PLAT-07 — Validation stricte des paramètres
- Un paramètre de requête attendu une seule fois mais répété (`?action=a&action=b`) : `400 api.validation.incoming_failed`.
- Entiers : une valeur non numérique, décimale (`1.5`), négative ou hors bornes : `400`.
- Identifiants de chemin attendus au format uuid : une valeur mal formée donne `400 api.validation.incoming_failed` (sauf pour `GET /users/:id` appelé par un utilisateur ordinaire, qui reçoit d'abord `403`, voir `rule-foundation-users-get-self-or-admin`).
- Chaînes : bornes de longueur appliquées telles que déclarées dans le contrat ; pas de rognage implicite des filtres de recherche (égalité exacte) ; rognage des noms saisis là où le contrat le dit (« trimmed »).
- Listes : nombre d'éléments minimal/maximal et unicité des éléments appliqués tels que déclarés (`uniqueItems`) ; un doublon dans une liste d'identifiants donne `400`.

### EXI-PLAT-08 — Clés inconnues dans les corps
- Sur les routes de **modification partielle** (`PATCH /users/:id`, `PATCH /groups/:id`, `PATCH /scopes/:id`) : toute clé non déclarée (par exemple `code`, `email`, `password`, `id`) ou un corps qui n'est pas un objet donne `400 api.validation.incoming_failed` et rien n'est modifié.
- Sur les autres routes : les clés non déclarées sont ignorées (elles n'ont aucun effet).

### EXI-PLAT-09 — Contrat fidèle aux contrôles
Chaque borne appliquée par l'API (minimum, maximum, longueurs, motif, format uuid ou date-heure, nombre d'éléments, `nullable`) est déclarée dans le contrat OpenAPI, et le contrat ne déclare aucune borne que l'API n'applique pas. Les changements incompatibles du contrat par rapport à `in/specifications/openapi.json` sont interdits, hors ceux listés dans `in/specifications/contract-changes.yaml`.

### `rule-foundation-list-pagination` (inferred) — Pagination des listes
Les routes de liste `GET /users`, `GET /groups`, `GET /scopes`, `GET /audit-logs` et `GET /users/imports/:importId/errors` acceptent :
- `from` : entier de 0 à 2147483647, défaut 0 (index du premier élément) ;
- `size` : entier de 1 à 100, défaut 10.

Elles renvoient la page demandée et `total`, le nombre total d'éléments correspondant aux critères (indépendant de la page). `size` = 100 est accepté ; `size` = 0 ou 101, `from` = −1, une valeur non numérique ou décimale donnent `400 api.validation.incoming_failed`. Un `from` au-delà du total donne une page vide avec le bon `total`. Les pages successives d'une liste triée ne présentent ni trou ni doublon.
Le studio pagine ces listes côté serveur (tailles 10 / 25 / 50, 10 par défaut) ; les listes de choix des formulaires sont lues en entier, page par page de 100, jusqu'à `from >= total`.

## 5. Régime d'accès des routes et refus par défaut

### `foundation-auth` — Contrôle d'accès du socle (étiquette de la suite de recette d'origine)
- Une route protégée appelée sans jeton répond `401` (par exemple `GET /users`) ;
- un jeton obtenu par `POST /auth/login` est accepté par une route protégée dont le rôle convient (`GET /users` pour un administrateur : `200`) ;
- un visiteur ne peut pas créer de compte par `POST /users` (`401`, aucune ligne créée).

### EXI-PLAT-10 — Toute route déclare son régime d'accès
Chaque route de l'API déclare explicitement l'un des régimes suivants :
- **publique** : accessible sans jeton (seules `POST /auth/login`, `GET /auth/current-user`, `POST /auth/logout`, `GET /server/health-check`) ;
- **authentifiée**, avec un code d'action `<fonctionnalité>:<verbe>` et la liste des rôles admis ; facultativement le niveau d'accès d'un administrateur aux périmètres (voir `rule-foundation-admin-scope-access`).

La matrice observée (rôle × route → statut) doit être exactement celle des fichiers `in/specifications/permissions.yaml` et `in/permissions-foundation.yaml` : un rôle admis obtient une réponse autre que 401/403, un rôle non admis obtient `403 security.access_denied`, un visiteur obtient `401`. Pour `GET /users/:id`, la ligne `allow: [admin]` avec `ownership: own` signifie : l'administrateur sur tout identifiant, l'utilisateur ordinaire sur le sien seulement.

### EXI-PLAT-11 — Refus par défaut, y compris en production
Une route qui ne déclare **aucun** régime d'accès n'est jamais servie : elle répond `401` à un visiteur et `403 security.access_denied` à un appelant authentifié, sans exécuter son traitement, **dans tous les environnements, production comprise**. Il n'existe aucun mode (variable d'environnement, configuration) qui ouvre par défaut une route non déclarée. L'oubli d'une déclaration doit en outre être détecté avant livraison (contrôle automatique qui échoue en nommant la route).

Les contrôles d'authentification et de rôle ont lieu **avant** toute validation des paramètres, toute lecture du corps et toute recherche en base : un appelant refusé reçoit `401`/`403` même si sa requête est par ailleurs invalide, et un corps volumineux n'est pas lu (voir `rule-foundation-import-users-admin-only`).

### Routes réservées à une garde métier et type de contenu des réponses (version `socle-garde-metier-et-reponses-non-json`)
- `rule-foundation-access-guard-only-route` (user) : une route authentifiée peut être réservée à une garde métier, sans rôle du socle admis (`roles: []`) ; `cuisine:routes` la rapporte avec `allow: []`.
- `rule-foundation-access-guard-only-regime` (inferred) : une telle route est rapportée `regime: auth+custom` ; sans jeton valide elle répond `401`, avec un jeton valide la plateforme ne refuse jamais par le rôle (ni `user` ni `admin`), la garde métier seule décide, avant toute validation et lecture du corps.
- `rule-foundation-access-undeclared-refused` (user) : une route sans déclaration d'accès empêche toujours le démarrage.
- `rule-foundation-access-no-role-without-guard-refused` (user) : une route authentifiée qui n'admet aucun rôle sans être protégée par une garde métier empêche le démarrage.
- `rule-foundation-access-owner-only-needs-role` (inferred) : `ownerOnly: true` avec `roles: []` empêche le démarrage.
- `rule-foundation-response-content-type` (user) : une route déclare le type de contenu de sa réponse (`application/json`, `text/csv`, `text/csv; charset=utf-8`), publié dans le document OpenAPI.
- `rule-foundation-response-content-type-default` (inferred) : sans déclaration, `application/json`.
- `rule-foundation-response-content-type-closed-list` (inferred) : liste fermée, un autre type empêche le démarrage.
- `rule-foundation-response-content-type-declarative` (inferred) : la déclaration ne change pas la réponse HTTP (l'en-tête est posé par la route) ni le contrôle de réponse des routes tracées.
- `rule-foundation-existing-routes-unchanged` (user) : aucun changement de comportement, de contrat ni de droits pour les routes existantes.

### EXI-PLAT-12 — Routes de test
Des routes réservées aux tests automatisés (préfixe `/test/`) peuvent exister uniquement dans l'environnement de test ; elles n'existent pas dans les autres environnements et ne figurent pas dans le contrat OpenAPI.

### EXI-PLAT-13 — Routes inexistantes
Une méthode ou un chemin non défini répond `404` (par exemple `DELETE /users/:id`, `DELETE /groups/:id`, `DELETE /scopes/:id`, `POST /audit-logs`, `PUT /audit-logs/:id`, `/auth/register`, `/auth/forgot-password`) ; aucun effet de bord. Pour un visiteur, une réponse `401` est tolérée sur ces chemins, jamais un 2xx.

## 6. Point de santé

### EXI-PLAT-14 — `GET /server/health-check`
Route publique (aucun jeton requis, tous rôles).
- `200` avec `{ "status": "healthy", "services": { … } }` quand tous les services dont dépend l'API (au minimum la base de données) répondent ;
- `503` quand au moins un service est indisponible, avec `status` = `"unhealthy"`.
`services` est un objet décrivant l'état de chaque service ; il ne contient aucun secret (pas de chaîne de connexion). La route n'est pas tracée au journal.

## 7. Exposition du contrat OpenAPI

### EXI-PLAT-15 — Document OpenAPI servi par l'API en fonctionnement
L'API en fonctionnement expose son document OpenAPI 3 (JSON) sur une route lisible sans authentification, généré à partir des routes réellement servies. Il doit être équivalent à `in/specifications/openapi.json` (mêmes chemins, opérations, paramètres, schémas et bornes ; seules sont tolérées les évolutions additives et celles listées dans `contract-changes.yaml`). Il :
- déclare les deux modes d'authentification : jeton porteur `bearer` (format JWT) et cookie de session ;
- ne contient aucune route de test (`/test/…`) ;
- ne contient aucun paramètre ni propriété évoquant une entreprise, une société ou un locataire (`rule-foundation-no-multi-company`).
Le chemin exact de cette route n'est pas fixé par les sources (Q-PLAT-03).

## 8. Limites de taille et réseau

### EXI-PLAT-16 — Limites de taille
- Corps JSON : limité à une taille raisonnable ; au-delà, `413` sans traitement (valeur non fixée par les sources, Q-PLAT-04). Les bornes métier (par exemple 1000 membres par groupe) restent en deçà.
- Envoi de fichier d'import (`multipart/form-data`) : voir `rule-foundation-import-limits` : 100 Mio (104 857 600 octets) pour le fichier ; un `Content-Length` déclaré supérieur à cette limite + 1 Mio est refusé immédiatement en `413` sans lecture ; un envoi qui dépasse la limite en cours de route est refusé en `413 import.file_too_large`, le reste du corps n'est pas conservé et la connexion est coupée au plus tard au double de la limite. Les autres parties du formulaire : au plus 5 champs texte de 1 Kio chacun, un seul fichier.
- Une analyse d'import peut durer plusieurs minutes : le serveur HTTP ne doit pas imposer de délai de réponse qui l'interrompe.

### EXI-PLAT-17 — CORS et cookies
Les réponses aux requêtes portant un en-tête `Origin` reflètent cette origine dans `Access-Control-Allow-Origin` (jamais `*`) et portent `Access-Control-Allow-Credentials: true`, afin que le studio, servi sur un autre port du même site, puisse envoyer le cookie de session. Studio et API doivent partager le même site (cookie `SameSite=Strict`).
