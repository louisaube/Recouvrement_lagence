# Demande à l'API : route réservée à une garde métier, réponse autre que JSON

Écran demandeur : aucun (évolution de la plateforme du socle, constatée sur la première version métier). Aucun écran n'est créé ni modifié : pas de plan de page, et `studio/src/**` ne change pas. Besoin : qu'une version métier puisse (1) réserver une route authentifiée à ses propres comptes, vérifiés par une garde métier, sans qu'aucun rôle du socle y soit admis ; (2) déclarer dans le contrat OpenAPI qu'une route répond autre chose que `application/json`, au moins `text/csv`.

## Opérations
Aucune route n'est créée, supprimée ni modifiée : `specifications/permissions.yaml` ne reçoit aucune entrée nouvelle. Ce sont deux capacités de déclaration de la plateforme (`api/src/platform/access/`, `api/src/platform/openapi/`), utilisables par toute route à venir.

| Capacité | Déclaration | Effet à l'exécution | Effet sur `cuisine:routes` / OpenAPI | Refus au démarrage |
|---|---|---|---|---|
| Route réservée à une garde métier | `@Access({ action: '<feature>:<verb>', roles: [] })` avec au moins une `@UseGuards(...)` sur la méthode ou le contrôleur | Sans jeton valide : `401 security.missing_token` / `security.invalid_token`, comme toute route authentifiée. Avec un jeton valide, quel que soit le rôle (`user`, `admin`) : la plateforme laisse passer, la garde métier décide (son refus est le sien, par exemple `403`). Aucune validation ni lecture de corps avant la garde. | `regime: auth+custom`, `allow: []`, `action` déclarée, `customGuards` listées. Le document OpenAPI porte la sécurité `bearer` / `cookie` comme pour toute route authentifiée. | `roles: []` sans aucune garde métier ; `ownerOnly: true` avec `roles: []` ; toute combinaison déjà refusée aujourd'hui (route sans déclaration, public et authentifié à la fois, action mal formée ou dupliquée, trace d'audit sans régime authentifié) |
| Type de contenu d'une réponse | dans `@ApiRoute`, une réponse déclare `contentType` (par défaut `application/json`) ; valeurs admises : `application/json`, `text/csv`, `text/csv; charset=utf-8` | Aucun : la déclaration documente, la route pose elle-même son en-tête `Content-Type` comme aujourd'hui | Le document OpenAPI porte, pour cette réponse, `content: { "<contentType>": { schema } }` à la place de `application/json`. Sans `contentType`, document identique à l'actuel octet pour octet | un `contentType` hors de la liste admise |

Autres refus de démarrage inchangés : route sans `@Public()` ni `@Access(...)` ; route sans `@ApiRoute`. Le message d'erreur nomme la route, comme aujourd'hui (« admits no role » devient « admits no role and no business guard » pour `roles: []` sans garde).

### Forme de la déclaration d'accès (choix de ce plan)
`roles: []` explicite, accompagné d'une garde métier. Pas de nouveau champ.

### Exemple (documentation pour `docs/socle.md`)
```ts
@Post('absences')
@UseGuards(CapabilityGuard('export:run'))          // garde métier : obligatoire avec roles: []
@Access({ action: 'exports:absences', roles: [] })  // aucun rôle du socle admis
@ApiRoute({
  responses: { 200: { description: 'CSV file', contentType: 'text/csv; charset=utf-8', schema: z.string() } },
})
```

## Règles
- `rule-foundation-access-guard-only-route` (user) : une route authentifiée peut être réservée à une garde métier, sans rôle du socle admis ; `cuisine:routes` la rapporte avec `allow: []`.
- `rule-foundation-access-guard-only-regime` (inferred) : une telle route est rapportée `regime: auth+custom` ; sans jeton valide elle répond 401, avec un jeton valide la plateforme ne refuse jamais par le rôle (ni `user` ni `admin`), la garde métier seule décide.
- `rule-foundation-access-undeclared-refused` (user) : le serveur continue de refuser de démarrer pour une route sans déclaration d'accès.
- `rule-foundation-access-no-role-without-guard-refused` (user) : le serveur refuse de démarrer pour une route authentifiée qui n'admet aucun rôle sans être protégée par une garde métier.
- `rule-foundation-access-owner-only-needs-role` (inferred) : `ownerOnly: true` avec `roles: []` fait refuser le démarrage.
- `rule-foundation-response-content-type` (user) : une route peut déclarer le type de contenu de sa réponse, au moins `text/csv`, qui apparaît alors dans le document OpenAPI (`/api-json` et `cuisine:openapi`, identiques).
- `rule-foundation-response-content-type-default` (inferred) : sans déclaration, une réponse est `application/json`, comme aujourd'hui.
- `rule-foundation-response-content-type-closed-list` (inferred) : la liste des types admis est fermée (`application/json`, `text/csv`, `text/csv; charset=utf-8`) ; un autre type fait refuser le démarrage ; l'étendre est un changement de la plateforme.
- `rule-foundation-response-content-type-declarative` (inferred) : la déclaration ne change pas la réponse HTTP ; l'en-tête reste posé par la route. Le contrôle de réponse existant des routes tracées (`AuditInterceptor.checkResponse`) est inchangé.
- `rule-foundation-existing-routes-unchanged` (user) : aucun changement de comportement, de contrat ni de droits pour les routes existantes, socle et métier compris : la sortie de `cuisine:openapi` et celle de `cuisine:routes` restent identiques pour toutes les routes actuelles (le module métier n'adopte les deux capacités que dans une version métier ultérieure, avec sa propre dispute de contrat et de permissions).

## Tests attendus (pour l'agent de fabrication ; `acceptance/**` reste à QA)
Routes de test masquées (`hidden: true`, hors document), comme dans `platform/tests/*.test.ts` :
1. Route `roles: []` + garde qui admet : sans jeton `401`, jeton `user` `200`, jeton `admin` `200` ; garde qui refuse : `403` de la garde pour `user` et `admin`.
2. `describeRoute` sur cette route : `allow: []`, `regime: 'auth+custom'`, `action` non nulle.
3. `findAccessProblems` : `roles: []` sans garde signalé ; avec garde, aucun problème ; `ownerOnly` avec `roles: []` signalé ; route sans déclaration toujours signalée.
4. Construction du document OpenAPI : une réponse `contentType: 'text/csv'` donne la clé `text/csv` et non `application/json` ; sans `contentType`, le document reste identique ; un type hors liste est signalé au démarrage.
5. Régression : suites existantes vertes ; `pnpm --dir api cuisine:openapi` et `cuisine:routes` identiques à la version précédente (comparaison avant/après).

## Compatibilité
Aucune opération existante modifiée ; additions optionnelles et rétrocompatibles de `AccessDeclaration` (liste vide admise avec garde) et de `ResponseContract` (`contentType` facultatif). Pas de rupture de contrat, pas de dispute. `api-client:generate` donne un client identique. Fichiers de la plateforme concernés (périmètre de fondation levé pour cette version) : `access/access-check.ts` (`describeRoute`, `findAccessProblems`), `access/access.guard.ts` (admission avec liste vide si garde), `access/access.decorators.ts`, `openapi/route-contract.ts`, `openapi/openapi.builder.ts`. Documentation à tenir à jour : `docs/socle.md` (sections « Access declaration » et « Declaring a route », exemple ci-dessus), `specifications/socle/10-plateforme.md` et `98-arbitrages.md` (règles ci-dessus), `module-socle.summary.md`.

## Hypothèses
- `roles: []` plutôt qu'un nouvel indicateur ; une `@UseGuards` sur la méthode ou le contrôleur compte comme garde métier (c'est déjà la définition de `auth+custom`).
- La plateforme ne peut pas vérifier que la garde « protège » réellement ; elle exige seulement sa présence.
- « Au moins `text/csv` » : le contrat accepte aussi `text/csv; charset=utf-8`, valeur réellement répondue par l'export paie ; liste fermée plutôt que tout type libre.
- La déclaration est documentaire : la plateforme n'écrit pas l'en-tête de réponse et ne valide pas la réponse contre le schéma.
- Aucune question au propriétaire : aucun de ces choix n'est observable par la recette ; aucune fonctionnalité exclue n'est ajoutée (pas de négociation de contenu, pas d'autre type que ceux listés, pas de changement du module métier).
