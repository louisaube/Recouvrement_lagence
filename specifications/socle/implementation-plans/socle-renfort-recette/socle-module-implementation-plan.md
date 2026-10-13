# Module socle : plan de réalisation, version `socle-renfort-recette`

Version de renfort de la recette. Aucune fonctionnalité nouvelle, aucun changement de contrat de l'API (ni route, ni schéma, ni borne, ni code d'erreur nouveau), aucun changement de droits. Aucun écran : pas de plan de page ni de demande de modification d'API ; `specifications/permissions.yaml` et `openapi.json` restent inchangés. Les cinq points décrivent des règles **déjà spécifiées** (`10-plateforme.md`, `20-authentification-session.md`, `98-arbitrages.md`) mais non vérifiées par la recette : le travail est d'abord un travail de test, puis de correction là où un test échoue.

Les agents de rédaction n'avaient écrit aucun plan : ce fichier a été rédigé par le relecteur à partir de la demande et du code.

## Données
Aucune table, colonne ni migration. Au point 3, le test pose temporairement une contrainte en base et la retire dans un `finally` ; il n'altère jamais le schéma durablement.

## Opérations
Aucune opération créée ni modifiée. Opérations exercées (existantes) :
- `POST /auth/login` (public) : points 1 et 2 ; `POST /users` (admin, corps JSON) : points 2 et 3 ;
- `GET /auth/current-user` (public, session optionnelle) et `GET /users` (admin) : points 4 et 5.

## Hypothèses
- Le corps JSON est lu par l'intercepteur de validation **après** la garde d'accès (EXI-PLAT-11) : le test de 413 s'envoie sur une route publique (`POST /auth/login`) et, authentifié en admin, sur `POST /users`. Un corps trop gros sur une route protégée sans authentification reste 401 (non vérifié ici).
- « Exactement `Bearer <jeton>` » : un seul espace, rien avant ni après. La casse du mot `Bearer` n'est pas tranchée par la demande : la recette ne l'affirme ni ne l'interdit.
- Un en-tête `Authorization` illisible l'emporte sur un cookie valide : 401 (`rule-foundation-session-expired` : un jeton présent mais invalide n'est jamais ignoré).
- Le cookie est présenté avec un `Origin` (ou `Referer`) de même hôte que celui de la connexion (`rule-foundation-session-persists`).

## Règles
Aucune règle nouvelle ; les règles ci-dessous existent déjà (provenance telle qu'écrite dans les spécifications) et sont celles que les nouveaux tests citent.
- `rule-foundation-login-single-error` : une empreinte illisible est refusée comme un mauvais mot de passe (point 1). Code : `features/auth/auth.service.ts` (`compare` intercepte déjà l'erreur de bcrypt ; vérifier le cas de l'empreinte vide et du texte quelconque, sans dupliquer la comparaison).
- `Q-PLAT-04` et `Q-PLAT-01` (décidés, `98-arbitrages.md`) : 413 `api.payload_too_large`, 400 `api.validation.incoming_failed`, corps d'erreur limité, rien écrit en base (point 2). Code : `platform/validation/zod-validation.interceptor.ts` (`JSON_BODY_LIMIT`) et `platform/http/exception.filter.ts` (`normalise`). Pas de second analyseur de corps.
- `EXI-PLAT-05`, `Q-PLAT-02`, `Q-PLAT-06` : 500 `api.unknown_error`, journal sans SQL, paramètres, empreinte ni e-mail, avec `X-Request-Id` (point 3). Code : `describeForLog` dans `exception.filter.ts`. Vérifier aussi que le journal de Nest (`logger: ['error','warn']` dans `main.ts`) et tout autre `console.*` n'écrivent pas l'erreur brute du pilote ; corriger au même endroit si oui.
- `rule-foundation-session-expired` (inferred) et `rule-foundation-session-persists` (user) : lecture stricte de l'en-tête et du cookie (point 4). Code : `SessionService.tokenSource` (`platform/security/session.service.ts`), fonction unique utilisée par la garde et par `current-user`. Défaut probable : `/^Bearer\s+(\S+)$/i` appliquée à `authorization.trim()` accepte plusieurs espaces, des espaces autour et des tabulations ; à resserrer en un seul espace, sans `trim`.
- `rule-foundation-session-expired` (inferred) : seul HS256 est accepté (point 5). Code : `TokenService.verify` (`algorithms: ['HS256']` déjà présent) ; le test le fige.

## Tests
Recette boîte noire écrite par QA avant toute correction : `acceptance/acceptance-<thème>.test.ts`, titres préfixés de l'identifiant de règle, et `acceptance/COVERAGE-socle-renfort-recette.md`. `resetData()` en `beforeEach`, `closePool()` en `afterAll`. Aucune entrée à ajouter à `permissions.yaml`.

Porte « rouge » : plusieurs de ces comportements sont probablement déjà corrects (le renfort vient d'un test de mutation). La porte exige qu'au moins un nouveau test échoue avant le code ; les tests qui passent déjà sont des tests de non-régression légitimes, à signaler comme tels dans le fichier de couverture. Le plus probable à échouer : la lecture stricte de l'en-tête (point 4).

1. **Empreinte illisible** (`rule-foundation-login-single-error`) : pour chacune des valeurs `''`, `pas-une-empreinte`, `$2b$10$tropcourt` et une empreinte valide altérée, avec le bon mot de passe : `401 security.invalid_credentials`, corps octet pour octet égal à celui d'un mauvais mot de passe, ni `token` ni `Set-Cookie`, y compris en mode cookie (`Origin`, `returnToken: false`) ; `GET /auth/current-user` reste `{}`. Témoin : un compte voisin à empreinte valide se connecte.
2. **Corps refusés** (Q-PLAT-04, Q-PLAT-01) :
   - JSON valide de 1 Mio + 1 octet sur `POST /auth/login` puis sur `POST /users` en admin : `413 api.payload_too_large`, clés du corps = `status`, `code`, `message` ;
   - juste sous la limite : pas de 413 (le 400 de validation est attendu) ;
   - JSON mal formé (`{"email":`, virgule finale, texte non JSON) : `400 api.validation.incoming_failed`, clés = `status`, `code`, `message`, `details` ;
   - aucun corps ne contient pile d'appel, chemin de fichier (`/home`, `node_modules`, `.ts`) ;
   - après un `POST /users` refusé, comptage SQL avant/après identique sur `base.users`, `base.credentials`, `base.audit_logs`.
3. **Aucun secret dans les journaux** (EXI-PLAT-05) : le test pose une contrainte temporaire (par exemple un `CHECK` refusant un e-mail donné sur `base.users`), appelle `POST /users` en admin avec un e-mail et un mot de passe reconnaissables, puis retire la contrainte. Attendu : `500 api.unknown_error`, corps limité à `status`, `code`, `message`, en-tête `X-Request-Id` ; dans la partie de `api/.server-test.log` ajoutée pendant le test (décalage d'octets), l'identifiant de requête figure, et ni le SQL (`insert into`), ni les paramètres, ni l'e-mail, ni le mot de passe, ni `$2b$`. L'identifiant présent dans le journal prouve que le test n'est pas vide.
4. **Lecture stricte du jeton** (`rule-foundation-session-expired`, `rule-foundation-session-persists`) : avec un jeton valide, `Authorization` valant `Bearer <jeton> extra`, `Bearer <jeton> <jeton>`, `Basic <jeton>`, `Token <jeton>`, `<jeton>` seul, `Bearer` seul, `Bearer  <jeton>` (deux espaces), ` Bearer <jeton>` (espace initial) donne `401 security.invalid_token` sur `GET /auth/current-user` et sur une route protégée ; `Bearer <jeton>` exact donne 200. Cookie : valide seul, parmi d'autres cookies, avec ou sans espaces après `;`, authentifie `GET /auth/current-user` (compte attendu) ; cookie d'un autre nom (autre préfixe, autre hôte) ou cookie de bon nom sans valeur : `200 {}`, jamais le compte.
5. **Algorithme du jeton** (`rule-foundation-session-expired`) : jeton HS512 signé avec le même secret et des revendications valides, jeton `alg: none` (avec et sans point final) : `401 security.invalid_token`, en en-tête et en cookie. Témoin : le jeton HS256 obtenu à la connexion est accepté. Le secret est lu depuis `api/.env.test` par le harnais de recette, sans importer de code de l'API.

Tests de l'API (`api/src/platform/tests/`, côté développeur, après scellement de la recette) : filtre d'exception sur une erreur `Failed query`, `tokenSource` sur les formes d'en-tête et de cookie. Ils ne remplacent pas la recette.

## Contestations
Toute divergence entre un test scellé et une règle existante s'écrit dans `specifications/socle/DISPUTES.md` (`OPEN: <titre du test>: <raison>`), jamais dans le test.
