# 20 — Authentification et session

Routes : `POST /auth/login`, `GET /auth/current-user`, `POST /auth/logout` (toutes publiques, voir `in/permissions-foundation.yaml`). Aucune n'est tracée au journal d'audit (`rule-foundation-audit-scope-of-trace`).

Les comportements d'écran associés (formulaire, message unique, redirections) sont dans `70-ecrans.md`.

## 1. Connexion

### Contrat de `POST /auth/login`
Corps JSON : `email` (requis), `password` (requis), `returnToken` (booléen, facultatif).
- `returnToken: true` : réponse 2xx `{ "token": "<JWT>" }` ; le jeton s'utilise ensuite dans l'en-tête `Authorization: Bearer <jeton>`.
- `returnToken: false` avec un en-tête `Origin` (mode navigateur) : réponse 2xx avec le corps `{}` et un cookie de session (voir `rule-foundation-session-persists`). Le jeton n'apparaît jamais dans le corps.
- `returnToken: false` sans `Origin` : refusé en erreur (statut et code non fixés par les sources, Q-AUTH-01).

Les deux modes coexistent : un client sans navigateur utilise le jeton, le studio utilise le cookie.

### `rule-auth-login-email-password` (provenance non indiquée, voir Q-AUTH-02) — Connexion par e-mail et mot de passe
Un compte existant se connecte avec son e-mail et son mot de passe exacts :
- la réponse fournit un jeton (chaîne non vide) qui identifie ce compte : `GET /auth/current-user` avec ce jeton renvoie `{ user: { id, email, role } }` du compte ;
- un administrateur est identifié avec `role: "admin"` ;
- chaque compte obtient sa propre identité (deux comptes, deux jetons, deux identités) ;
- le mot de passe d'un autre compte ne connecte pas : `401 security.invalid_credentials` ;
- une connexion échouée ne crée ni compte ni session.

### `rule-auth-login-error-message` (provenance non indiquée, voir Q-AUTH-02) — Erreur de connexion
Un mot de passe faux répond `401 security.invalid_credentials` ; un e-mail inconnu répond la **même** erreur `401 security.invalid_credentials`.

### `rule-foundation-login-single-error` (user) — Message d'erreur unique
L'échec de connexion ne révèle jamais si l'e-mail existe :
- e-mail inconnu et mot de passe faux donnent des réponses **identiques** (statut 401, corps égal octet pour octet, limité à `status`, `code` = `security.invalid_credentials`, `message`) ; un mot de passe à la casse différente est un mot de passe faux ;
- un e-mail mal formé ou vide répond `400` (validation d'entrée) ;
- aucun cookie de session n'est posé sur un échec, et `current-user` reste anonyme ensuite.
Côté écran, toutes les causes (401, 400, réseau, 5xx) donnent le même message « Identifiants incorrects. » (voir `70-ecrans.md`).

Le mot de passe est comparé à son empreinte bcrypt (coût 10, préfixe `$2b$10$`) stockée dans `base.credentials` (`type = 'token'`, colonne `password`), conformément au contrat de données : la recette crée des comptes en écrivant directement ces tables et s'attend à pouvoir s'y connecter.

## 2. Session

### `rule-auth-session-persistence` (provenance non indiquée, voir Q-AUTH-02) — Session par jeton
- Sans jeton, `GET /auth/current-user` répond `200` sans propriété `user` (corps `{}`).
- Un jeton valide conservé par le client identifie toujours le même compte lors d'appels ultérieurs.
- Un jeton invalide (`invalid.token.value`) répond `401 security.invalid_token`.

### `rule-foundation-session-persists` (user) — La session survit au rechargement
En mode navigateur (`POST /auth/login` avec `Origin` et `returnToken: false`) :
- la réponse pose **un seul** cookie nommé `recouvrement-jwt-<hôte>`, où `<hôte>` est le nom d'hôte de l'`Origin` **sans le port** (`http://localhost:4200` et `http://localhost:5173` donnent tous deux `recouvrement-jwt-localhost`) ;
- attributs : `HttpOnly`, `SameSite=Strict`, `Domain=<hôte>`, `Path=/`, `Secure` en production uniquement ; durée de vie d'environ 24 heures (entre 23 h et 24 h + 1 min) ; valeur = le jeton de session ;
- `GET /auth/current-user` avec ce cookie et un en-tête `Origin` (ou, à défaut, `Referer`, cas d'un rechargement de page) de la même origine renvoie le compte connecté ; le nom du cookie recherché est déduit de `Origin`, sinon de `Referer`, port exclu ;
- chaque cookie identifie son propre compte ;
- CORS : l'origine est reflétée (jamais `*`) et `Access-Control-Allow-Credentials: true` (EXI-PLAT-17) ;
- le mode jeton (`returnToken: true`) fonctionne toujours comme avant.
Côté studio, la session est restaurée au chargement par `GET /auth/current-user`, sans nouvelle saisie.

Le jeton est sans état côté serveur et dure 24 heures. Il porte le rôle du compte au moment de la connexion : un changement de rôle n'est pris en compte qu'à la connexion suivante (les appartenances aux groupes, elles, sont relues à chaque requête).

### `rule-foundation-session-expired` (inferred) — Session invalide ou expirée
- Sans session, `GET /auth/current-user` répond `200 {}`.
- Un cookie (ou un jeton) portant un jeton invalide, altéré ou expiré répond `401 security.invalid_token` : un jeton présent mais invalide est toujours rejeté, jamais ignoré.
- Côté studio, `{}`, `401` ou une erreur réseau signifient « non connecté » (retour à l'écran de connexion pour une page protégée).

## 3. Déconnexion

### `rule-foundation-logout` (inferred) — Déconnexion effective
`POST /auth/logout`, route publique, sans corps :
- répond **`201`** sans corps (statut documenté par le contrat, inchangé), pour un visiteur, un utilisateur et un administrateur (jamais 401 ni 403) ;
- avec un en-tête `Origin`, la réponse expire le cookie de session : un unique `Set-Cookie` de **même nom, même `Domain`, même `Path`, mêmes `HttpOnly`, `SameSite` et `Secure`** que le cookie posé à la connexion, valeur vide, date d'expiration passée (ou `Max-Age` ≤ 0), de sorte que le navigateur le supprime réellement ; cela vaut pour toute origine (par exemple `http://app.example.com:3000` → nom `recouvrement-jwt-app.example.com`, `Domain=app.example.com`) ;
- idempotente : sans cookie ni session, ou appelée deux fois de suite, elle répond `201` ; sans `Origin`, elle répond `201` et ne pose aucun cookie de session ;
- elle ne supprime pas le compte : on peut se reconnecter ensuite ;
- une fois le cookie supprimé par le navigateur, `GET /auth/current-user` répond `{}`.
Le jeton étant sans état, la déconnexion ne révoque pas côté serveur un jeton déjà émis (Q-AUTH-03).
Côté studio : bouton « Se déconnecter », état local effacé et retour à `/connexion`, même si l'appel échoue ; un rechargement ne restaure pas la session.

## 4. Absences volontaires

### `rule-foundation-no-self-signup` (user) — Pas d'inscription en libre-service
- Un visiteur ne peut pas créer de compte par `POST /users` : `401`, aucune ligne créée.
- Un utilisateur ordinaire non plus : `403`, aucune ligne créée.
- Aucune route publique d'inscription n'existe : `POST` sur `/auth/register`, `/auth/signup`, `/auth/sign-up`, `/register`, `/signup` répond un statut ≥ 400 et ne crée rien.
- L'écran de connexion n'offre aucun lien de création de compte.
Seul un administrateur crée des comptes (`30-comptes.md`, `60-import.md`).

### `rule-foundation-no-password-reset` (user) — Pas de mot de passe oublié
- Aucune route de réinitialisation : `POST` sur `/auth/forgot-password`, `/auth/reset-password`, `/auth/password-reset`, `/auth/request-password-reset` répond un statut ≥ 400 et le mot de passe reste inchangé (la connexion avec l'ancien fonctionne).
- L'écran de connexion n'offre aucun lien ni formulaire « mot de passe oublié ».
Il n'existe pas non plus, dans cette version, de changement de mot de passe depuis l'administration.
