# Module socle : plan de réalisation, version `socle-tests-ouverts-au-metier`

Version de correction des tests du socle. Aucun changement de comportement, de contrat (ni route, ni schéma, ni borne, ni code d'erreur), aucun changement de droits. Aucun écran : pas de plan de page ni de demande de modification d'API ; `specifications/permissions.yaml`, `specifications/openapi.json` et `contract-changes.yaml` restent inchangés. Aucune question au propriétaire : la demande ne laisse aucun choix ouvert qui change la recette (voir `questions.yaml`).

Cause : la première version métier (page « Mon compte ») ajoute des chemins et des mots au document OpenAPI ; le test `[Q-PLAT-03]` de `api/src/features/auth/tests/auth.test.ts` exige la liste exacte des chemins et interdit `company|tenant|entreprise` dans tout le document, donc échoue dès qu'un module métier existe.

## Données
Aucune table, colonne ni migration.

## Opérations
Aucune opération créée ni modifiée. Seules opérations exercées : `GET /api-json` et `GET /api` (existantes, hors contrat, développement et test seulement).

## Règles
Aucune règle nouvelle. Règles existantes concernées :
- `Q-PLAT-03` (décidé, `98-arbitrages.md`) : le document OpenAPI est servi en test avec les deux schémas de sécurité et aucun chemin de test. Ce que le test vérifie devient (voir Tests) :
  - **tous les chemins du socle sont présents** ; les chemins ajoutés par un module métier sont permis ;
  - **aucune clé de `paths` ne contient `/test/`** (aucune route de test servie) ;
  - **`components.securitySchemes` contient `bearer` et `cookie`** (un schéma de plus n'est pas interdit) ;
  - `GET /api` répond 200.
- `rule-foundation-no-multi-company` (user) : reste vérifiée **sur le socle**, pas sur le document entier. Le test cherche `company|tenant|entreprise` (insensible à la casse) dans les seules opérations du socle et dans les schémas qu'elles référencent (résolution transitive des `$ref` de `components.schemas`). Les « opérations du socle » sont celles dont le chemin figure dans `FOUNDATION_PATHS` (toutes méthodes). Un module métier peut librement utiliser ces mots. Ce contrôle conserve l'intention de `10-plateforme.md` (l.141) et `40-groupes-perimetres.md` (l.85) sans l'étendre au métier. La règle elle-même est `(user)` ; seule la restriction de son contrôle au socle est `(inferred)`.
- Règles d'audit, filtres du journal, menu : inchangées (voir « Audit des autres tests »).

## Tests
Tous les tests modifiés sont des tests de l'API (`api/src/**/tests/`), côté développeur ; `acceptance/**` n'est pas touché.

### 1. Test `[Q-PLAT-03]` (`features/auth/tests/auth.test.ts`)
Réécriture, titre conservé :
- liste `FOUNDATION_PATHS` des 16 chemins actuels (`/audit-logs`, `/audit-logs/filters`, `/auth/current-user`, `/auth/login`, `/auth/logout`, `/groups`, `/groups/{id}`, `/scopes`, `/scopes/{id}`, `/server/health-check`, `/users`, `/users/imports/preview`, `/users/imports/specification`, `/users/imports/{importId}/confirm`, `/users/imports/{importId}/errors`, `/users/{id}`) ; assertion : chacun est une clé de `doc.paths` (`arrayContaining`, pas d'égalité) ;
- aucune clé de `paths` ne correspond à `/test/` ;
- `bearer` et `cookie` appartiennent à `Object.keys(doc.components.securitySchemes)` ;
- recherche de `company|tenant|entreprise` restreinte au sous-ensemble du socle (voir règle ci-dessus), : `JSON.stringify` des seules opérations de `FOUNDATION_PATHS` plus des schémas atteints par `$ref` transitifs (petite fonction d'aide locale au fichier de test, pas de code partagé) ; l'ancienne recherche de `/test/` dans tout le document est remplacée par le contrôle sur les clés de `paths` ;
- `GET /api` : 200.
Le test échoue encore si un chemin du socle disparaît, si une route de test est servie ou si un schéma de sécurité manque.

### 2. Audit des autres tests du socle
Relecture de `api/src/**/tests/` (aucun test de studio n'existe dans le dépôt courant) pour toute énumération exhaustive qui interdirait un ajout métier. Résultat de l'inventaire, à confirmer par l'agent de correction en relisant le code :
- **À corriger** : uniquement le test `[Q-PLAT-03]`.
- **Sans changement, car bornés au socle ou à des données semées** :
  - `audit.test.ts` (`/audit-logs/filters`, listes `actions`, `objectTypes`, `scopes`) : le journal est vidé en `beforeEach` et semé par le test ; les valeurs attendues sont celles semées, pas la liste des actions déclarées.
  - `audit-trace.test.ts` (« six routes », `count() === 7`) : compte les entrées laissées par les seuls appels du test sur un journal vidé ; une route métier n'écrit rien tant qu'elle n'est pas appelée.
  - `audit-mechanism.test.ts` : `findAuditProblems` s'applique au catalogue d'une application de test (contrôleurs fictifs) ; le test « application réelle sans route d'écriture non tracée » est une règle de socle qui doit rester vraie pour le métier.
  - `platform.test.ts` (document OpenAPI) : construit à partir des routes fictives du test.
  - `users.test.ts`, `groups.test.ts` (« exactement `{ id, email, role, groups }` », « exactement `{ id, name, members, scopes }` ») : bornés aux réponses du socle ; inchangés.
  - `platform/testing/helpers.ts` `resetData` : vide les tables de `base` lues dans `pg_tables`, pas une liste figée ; une table métier est vidée aussi.
  - `audit-mechanism.test.ts` l.278-287 (`RouteCatalog.list()`) : les assertions portent sur des routes fictives nommées (`/forgotten/*`, `/probes/*`) via `filter`/`some`, pas sur la liste complète ; le « boot check » (l.291) ne vérifie que `health-check` = 200. Une route métier correctement tracée ne les affecte pas.
  - `imports-api.test.ts` (liste de routes, l.51) : parcourt des routes d'import connues, n'énumère pas le document.
- Si la relecture trouve une autre énumération qui interdit un ajout (liste exacte de chemins, de tables de `base`, d'actions d'audit déclarées dans le catalogue réel, d'entrées de menu), la remplacer par un « contient » sur les éléments du socle, sans retirer ce qui est vérifié sur eux, et la signaler dans le compte rendu.

### 3. Contrôle de non-régression
- Tous les tests du socle passent, avec le code de la première version métier (page « Mon compte ») présent dans l'arbre.
- Contrôle de mutation manuel : retirer un chemin du socle du document, servir une route sous `/test/` ou retirer le schéma `cookie` fait échouer le test `[Q-PLAT-03]`.
- Ajouter un chemin métier ou un texte « entreprise » dans une route métier ne le fait plus échouer ; le même texte dans une opération ou un schéma du socle le fait encore échouer.

## Hypothèses
- (inferred) « Le socle » désigne les 16 chemins aujourd'hui servis ; une version de fondation qui en ajoute un l'ajoute à la liste du test.
- (inferred) `rule-foundation-no-multi-company` reste vérifiée sur le socle : la demande exige de ne pas « affaiblir ce qu'ils vérifient sur le socle » ; d'où un contrôle restreint plutôt que sa suppression.
- (inferred) « Aucun chemin de test » s'entend comme aucune clé de `paths` contenant `/test/`.
- Aucun test de studio (menu) n'existe dans l'arbre ; la vérification des entrées de menu est sans objet, sauf test apparu depuis.
- `acceptance/**` n'est pas modifié : une énumération qui y poserait le même problème serait une contestation (`DISPUTES.md`) ; l'inventaire courant n'en révèle pas.
