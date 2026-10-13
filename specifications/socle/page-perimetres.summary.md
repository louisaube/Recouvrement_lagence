# Périmètres (`/perimetres`) : état réalisé

Écran réservé aux administrateurs. Code : `features/scopes/pages/ScopesPage.tsx`, `components/ScopeDialog.tsx`, `hooks/useScopeLoader.ts`. Règles API : `40-groupes-perimetres.md` §1. Écran : `70-ecrans.md` §9.

## Ce qui existe
- Titre « Périmètres », bouton « Nouveau périmètre » (`rule-foundation-scopes-admin-screen`, user).
- Tableau lu par `GET /scopes?from=&size=` (trié par code) : « Code », « Nom », « Actions » (« Modifier », nom accessible « Modifier le périmètre <code> »). Pagination serveur. Vide : « Aucun périmètre pour le moment. Créez le premier périmètre. ». Pas de suppression (`rule-foundation-scope-no-delete`, inferred).
- **Création** : champs « Code » (aide : « Lettres minuscules, chiffres, tirets et tirets bas (50 caractères maximum). Le code ne pourra plus être modifié. ») et « Nom » ; envoi `POST /scopes { code, name }` rognés (`rule-foundation-scope-definition`, user).
- **Modification** : « Code » en lecture seule (« Le code ne peut pas être modifié. »), envoi `PATCH /scopes/:id { name }` seulement (`rule-foundation-scope-code-immutable`, inferred).
- **Validation locale** (`rule-foundation-scope-code-format`, inferred) : code et nom obligatoires après rognage, code conforme à `^[a-z0-9][a-z0-9_-]{0,49}$` sinon « Le code ne doit contenir que des lettres minuscules, chiffres, tirets et tirets bas. », nom ≤ 100 ; aucune mise en minuscules automatique.
- Succès : « Périmètre créé. » / « Périmètre modifié. ». Échecs : `scopes.code_already_exists` → « Ce code est déjà utilisé. » sous le champ (`rule-foundation-scope-code-unique`, user) ; 400, 401, 403 et autres selon `rule-foundation-api-failure-handling`.
- Les créations et modifications laissent une entrée au journal portant le code du périmètre (`rule-foundation-audit-scope-field`, inferred).

## Limites connues
- Le code ne peut jamais être changé, ni le périmètre supprimé : les tables métier le référencent. Cet écran n'est pas filtré par périmètre (l'administrateur les voit tous).
