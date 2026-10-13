# Module socle : plan de réalisation, version `socle-bearer-rfc6750`

Alignement de la lecture de l'en-tête `Authorization` sur la RFC 6750 (section 2.1). Aucune fonctionnalité nouvelle, aucun changement de contrat de l'API (ni route, ni schéma, ni borne, ni code d'erreur), aucun changement de droits : `specifications/permissions.yaml`, `openapi.json` et `contract-changes.yaml` restent inchangés. Aucun écran : pas de plan de page. L'agent frontend n'a déposé aucune demande de modification d'API (aucun fichier nouveau sous `specifications/`), ce qui est cohérent. Le seul changement est un assouplissement du comportement interne de lecture de l'en-tête (`SessionService.tokenSource`).

## Données
Aucune table, colonne ni migration.

## Opérations
Aucune opération créée ni modifiée. Opérations dont le comportement change, toutes par le même point de lecture :
- `GET /auth/current-user` (public, session optionnelle) et toute route protégée (garde d'accès) : l'en-tête `Authorization` est lu par `SessionService.tokenSource`, fonction unique.
- Réponses inchangées : jeton valide, session ; en-tête illisible, `401 security.invalid_token` (corps `{ status, code, message }`), jamais ignoré, et l'emporte sur un cookie valide. Pas de trace d'audit.

Forme acceptée : `Bearer`, casse indifférente, puis **une ou plusieurs espaces (U+0020 uniquement)**, puis un jeton sans aucun blanc, puis la fin de l'en-tête. Expression visée : `/^Bearer +(\S+)$/i`. Sans `trim` : les blancs de début et de fin sont déjà retirés par Node avant l'application (contestation acceptée du renfort de recette), le plan n'y change rien.

| En-tête | Résultat |
| --- | --- |
| `Bearer abc` | accepté |
| `Bearer  abc`, `Bearer    abc` (plusieurs espaces) | accepté, jeton `abc` (**changement**) |
| `bearer abc`, `BEARER  abc` | accepté (casse indifférente, inchangé) |
| tabulation ou tout autre blanc que l'espace entre le mot et le jeton (`Bearer<TAB>abc`, `Bearer<espace><TAB>abc`, espace insécable) | 401 `security.invalid_token` |
| `Bearer abc extra`, `Bearer abc abc`, `Bearer abc<TAB>x` | 401 |
| `Bearer`, `Bearer ` (jeton vide) | 401 |
| `Basic abc`, `Token abc`, `abc`, `Bearerabc` | 401 |

## Hypothèses
- « Un second jeton ou tout texte après le jeton » : le jeton ne contient aucun blanc ; tout blanc suivi d'un caractère après le jeton est refusé.
- Le mot `Bearer` suivi d'une tabulation ou d'un autre blanc non espace reste refusé, même si des espaces suivent ensuite.
- La casse du mot `Bearer` reste indifférente (« comme aujourd'hui »).

## Règles
Aucune règle nouvelle. Règles existantes, provenance inchangée :
- `rule-foundation-session-expired` (inferred) : un jeton présent mais invalide n'est jamais ignoré. Appliquée dans `SessionService.tokenSource` (`api/src/platform/security/session.service.ts`) : remplacer l'expression `^Bearer ([^\s]+)$` par `^Bearer +(\S+)$` (flag `i`) et corriger le commentaire qui dit « one space ». Rien d'autre à toucher : la garde et `current-user` partagent cette fonction.
- `rule-foundation-session-persists` (user) : l'ordre jeton porteur puis cookie est inchangé.

Documentation à tenir à jour : `docs/socle.md` et `specifications/socle/20-authentification-session.md` ne décrivent pas ce détail (rien à changer). À réécrire : la phrase de `specifications/socle/module-socle.summary.md` (ligne sur `rule-foundation-session-expired`, « une seule espace ») en « une ou plusieurs espaces (U+0020), ni tabulation ni autre blanc ». Le commentaire de `tokenSource` sur les blancs de début et de fin retirés par Node reste valable.

## Tests
Porte « rouge » : les tests qui exigeaient exactement un espace, une fois adaptés, doivent échouer contre le code actuel, puis passer après la correction.

1. **Test unitaire** `api/src/platform/tests/session-token-source.test.ts` (existant) : la ligne `['Bearer  abc', { kind: 'malformed' }]` devient `{ kind: 'present', token: 'abc' }`. Ajouter : trois et dix espaces, `bearer` / `BEARER` avec plusieurs espaces ; refus de `Bearer\tabc`, `Bearer \tabc`, `Bearer  abc`, `Bearer abc  def`, `Bearer abc\tdef`, `Bearer abc def` (le jeton ne contient aucun blanc, `\S`). L'espace insécable (U+00A0) est écrit en échappement ` ` dans le test, jamais en caractère littéral : `Bearer abc` et `Bearer  abc` sont refusés. Les cas existants (`Bearer abc extra`, `Bearer abc abc`, `Bearer`, `Bearer `, autre préfixe, cookie écarté quand l'en-tête est illisible) restent verts.
2. **Intégration** `api/src/features/auth/tests/auth.test.ts` : aucun test n'exige un seul espace ; ajouter, sous `[rule-foundation-session-expired]`, un cas `Bearer` + trois espaces + jeton valide sur `GET /auth/current-user` (200, utilisateur courant) et un cas `Bearer` + tabulation + jeton valide (`401 security.invalid_token`).
3. **Recette** `acceptance/acceptance-renfort-token.test.ts` et `acceptance/COVERAGE-socle-renfort-recette.md` : propriété de QA, **non modifiés par le backend**. Le cas « Bearer + deux espaces + <jeton> » (attendu 401) contredit désormais la demande, ainsi que la mention « two spaces » du fichier de couverture. QA les adapte (deux espaces acceptés, avec témoin sur `GET /auth/current-user` et `GET /users` ; la tabulation reste refusée). Si ce test reste rouge, le backend ajoute `OPEN: acceptance-renfort-token « Bearer + deux espaces + <jeton> »: exige exactement un espace, contraire à la RFC 6750 §2.1 et à la demande de cette version` à `specifications/socle/implementation-plans/socle-bearer-rfc6750/DISPUTES.md`, sans éditer le fichier.
4. Gates : `pnpm --dir api type:check`, redémarrage du serveur de test, `pnpm --dir api test`. Pas de `pnpm api-client:generate` (contrat inchangé).
