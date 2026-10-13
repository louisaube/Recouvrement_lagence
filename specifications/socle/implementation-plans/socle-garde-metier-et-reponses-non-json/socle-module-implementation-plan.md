# Module socle : plan de réalisation, version `socle-garde-metier-et-reponses-non-json`

Deux capacités de déclaration de la plateforme, additives et facultatives : (1) une route authentifiée réservée à une garde métier, sans rôle du socle admis (`roles: []`) ; (2) le type de contenu d'une réponse déclaré dans `@ApiRoute`. Reprend la demande de l'agent frontend (`plateforme-api-modification-request.md`) et ses choix : `roles: []` explicite avec garde obligatoire, liste fermée de types de contenu.

Aucune route créée, supprimée ni modifiée : `specifications/permissions.yaml`, `openapi.json` et `contract-changes.yaml` restent inchangés, aucune dispute. Aucun écran, `studio/src/**` ne change. La sortie de `cuisine:openapi` et celle de `cuisine:routes` restent identiques pour toutes les routes actuelles.

## Données
Aucune table, colonne ni migration. Schéma `base` et `data-contract.md` intacts.

## Opérations
Aucune opération applicative. Changements de plateforme (périmètre de fondation levé pour cette version) :

### 1. Route réservée à une garde métier
- `access/access.decorators.ts` : `AccessDeclaration.roles` admet la liste vide ; commentaire mis à jour (`[]` : aucun rôle du socle, une garde métier décide, au moins une `@UseGuards` exigée). `admittedRoles([])` reste `[]`.
- `access/access.guard.ts` : **point à ne pas manquer**. Le garde global refuse aujourd'hui toute route dont le rôle n'est pas dans `admittedRoles(roles)` ; `roles: []` donnerait donc un 403 à tout le monde, y compris à la garde métier qui ne serait jamais atteinte. Le commentaire de classe du garde est mis à jour. Nouveau comportement : authentification d'abord (sans jeton valide, `401 security.missing_token` / `security.invalid_token`, inchangé), puis, si aucune déclaration n'existe, `403 security.access_denied` (inchangé : filet de Q-PLAT-05), puis, si `declaration.roles.length === 0`, la plateforme laisse passer quel que soit le rôle (`user`, `admin`), `req.user` étant posé pour la garde métier ; sinon contrôle de rôle inchangé (`403 security.access_denied`). Le garde global s'exécute avant les `@UseGuards` de la route : aucune validation ni lecture de corps avant la garde métier, dont le refus (par exemple 403) est le sien.
- `access/access-check.ts` :
  - `describeRoute` : `allow` vide pour `roles: []` (c'est déjà le résultat de `admittedRoles([])`), `regime: 'auth+custom'` si garde, `action` déclarée, `customGuards` listées. Aucun changement pour les autres routes.
  - `findAccessProblems` : le refus « admits no role » ne se déclenche plus que pour `roles: []` **sans** garde, et devient `Route <route> admits no role and no business guard` (le test existant de `platform.test.ts` filtre sur `/admits no role/` et reste vert). Nouveau refus : `ownerOnly: true` avec `roles: []`. Les autres refus sont inchangés (route sans déclaration, public et authentifié à la fois, action mal formée ou dupliquée) ; l'audit exige toujours un régime authentifié (`findAuditProblems` inchangé).
- Document OpenAPI : sécurité `bearer` / `cookie` comme toute route authentifiée ; vérifier que le constructeur ne lit pas `roles` pour la décider.

| Déclaration | Au démarrage | Sans jeton | Jeton `user` / `admin` | `cuisine:routes` |
|---|---|---|---|---|
| `roles: []` + `@UseGuards` | accepté | 401 | la garde décide | `auth+custom`, `allow: []` |
| `roles: []` sans garde | refusé, route nommée | n/a | n/a | n/a |
| `roles: []` + `ownerOnly: true` | refusé, route nommée | n/a | n/a | n/a |
| aucune déclaration | refusé (inchangé) | n/a | n/a | n/a |

### 2. Type de contenu d'une réponse
- `openapi/route-contract.ts` : `ResponseContract.contentType?: 'application/json' | 'text/csv' | 'text/csv; charset=utf-8'` (défaut `application/json`), avec la liste exportée `RESPONSE_CONTENT_TYPES`.
- `openapi/openapi.builder.ts` (construction des `responses`) : `content: { [contentType ?? 'application/json']: { schema } }` quand un schéma est déclaré ; sans `contentType`, document identique à l'actuel. Les corps de requête ne changent pas.
- Contrôle au démarrage dans `AccessBootCheck` : un `contentType` hors liste produit `Route <route> declares an unsupported response content type "<x>"` (la liste est fermée, y compris pour du code non typé). L'étendre est un changement de la plateforme.
- Déclaratif : la plateforme n'écrit pas l'en-tête `Content-Type` ; la route le pose elle-même (`exports.controller.ts` le fait déjà avec `res.setHeader`). Elle ne valide pas la réponse, **sauf** le contrôle existant de `AuditInterceptor.checkResponse` (`audit/audit.interceptor.ts`), qui confronte la valeur retournée par une route tracée au premier schéma 2xx : inchangé, mais à documenter dans `docs/socle.md` (une route tracée à réponse non JSON doit retourner une valeur conforme à son schéma). `/api-json` et `cuisine:openapi` restent identiques (même constructeur).
- `api-client:generate` donne un client identique tant qu'aucune route n'adopte `contentType`.

### Documentation
- `docs/socle.md` (aussi l'exemple `@Access(...)` du squelette de route et la section du module métier qui décrit `roles: ['user']` + `CapabilityGuard`, à compléter par la mention de `roles: []`) : sections « Access declaration » et « Declaring a route » : `roles: []` + garde, `contentType`, exemple de la demande (`exports:absences`, `text/csv; charset=utf-8`), nouveaux refus au démarrage.
- `specifications/socle/10-plateforme.md`, `98-arbitrages.md` (Q-PLAT-05 : refus d'une route sans rôle ni garde) et `module-socle.summary.md` : règles ci-dessous.

## Règles
- `rule-foundation-access-guard-only-route` (user) : appliquée dans `AccessGuard` (liste vide, laisse passer après authentification) et `describeRoute` (`allow: []`).
- `rule-foundation-access-guard-only-regime` (inferred) : `auth+custom`, 401 sans jeton, jamais de refus par le rôle ; `AccessGuard`, `regimeOf`.
- `rule-foundation-access-undeclared-refused` (user) : `findAccessProblems`, inchangée.
- `rule-foundation-access-no-role-without-guard-refused` (user) : `findAccessProblems`, `roles: []` sans `customGuards`.
- `rule-foundation-access-owner-only-needs-role` (inferred) : `findAccessProblems`, `ownerOnly` avec `roles: []`.
- `rule-foundation-response-content-type` (user) : `ResponseContract.contentType`, `openapi.builder.ts`.
- `rule-foundation-response-content-type-default` (inferred) : `application/json` sans déclaration.
- `rule-foundation-response-content-type-closed-list` (inferred) : liste fermée contrôlée au démarrage.
- `rule-foundation-response-content-type-declarative` (inferred) : aucun en-tête posé par la plateforme ; la déclaration ne change aucun contrôle de réponse existant (`AuditInterceptor.checkResponse` inchangé).
- `rule-foundation-existing-routes-unchanged` (user) : comparaison avant/après de `cuisine:openapi` et `cuisine:routes`.

Chaque règle est citée en commentaire là où elle est appliquée et dans le test qui la couvre.

## Tests
Dans `api/src/platform/tests/` (routes de test `hidden: true`, hors document) ; `acceptance/**` n'est pas touché :
1. Route `roles: []` + garde qui admet : sans jeton 401, `user` 200, `admin` 200 ; garde qui refuse : 403 de la garde pour `user` et `admin` ; corps invalide non lu avant la garde.
2. `describeRoute` : `allow: []`, `regime: 'auth+custom'`, `action` non nulle, `customGuards` non vide.
3. `findAccessProblems` : `roles: []` sans garde signalé ; avec garde, aucun problème ; `ownerOnly` avec `roles: []` signalé ; route sans déclaration toujours signalée ; test existant « admits no role » inchangé.
3 bis. Garde global : route sans déclaration d'accès toujours refusée à l'exécution ; `roles: ['admin']` et `roles: ['user']` inchangés (test `EXI-PLAT-10` existant vert).
4. Démarrage : `AccessBootCheck` lève pour `roles: []` sans garde et pour un `contentType` hors liste.
5. Constructeur OpenAPI : `contentType: 'text/csv'` donne la clé `text/csv` et pas `application/json` ; idem `'text/csv; charset=utf-8'` ; sans `contentType`, document identique à celui d'avant.
5 bis. Route tracée avec `roles: []` + garde et réponse `text/csv` : l'entrée d'audit porte l'action déclarée, et `checkResponse` s'applique au schéma déclaré comme avant.
6. Régression : suites existantes vertes ; `cuisine:openapi` et `cuisine:routes` identiques avant/après (sorties de référence produites AVANT toute modification de code, `diff` vide après, routes socle et métier du dépôt comprises) ; `api-client:generate` sans diff ; `type:check` de l'API.

## Hypothèses
- Les choix de l'agent frontend sont repris tels quels, avec leurs provenances : forme `roles: []`, une `@UseGuards` sur méthode ou contrôleur compte comme garde, la plateforme n'évalue pas la garde, liste fermée de types.
- Aucune question au propriétaire (`questions.yaml` reste `[]`) : aucun de ces choix n'est observable par la recette tant qu'aucune route existante ne les adopte ; l'adoption par le module métier relève de sa version métier, avec ses propres disputes de contrat et de permissions.
