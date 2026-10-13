# 98 — Arbitrages

Réponses aux questions ouvertes du chapitre 99, rendues par l'opérateur de la cuisine le 8 octobre 2026. Une réponse « observée » a été établie en interrogeant l'API d'origine en boîte noire (requêtes HTTP, sans lecture de code) ; une réponse « décidée » fixe un comportement que les sources laissaient libre. Une réponse « reportée » laisse le comportement par défaut du chapitre concerné et demande l'arbitrage du propriétaire ; elle ne bloque pas la reconstruction. Ces arbitrages l'emportent sur les positions par défaut des chapitres 10 à 70.

## Plateforme

- **Q-PLAT-01 (décidé).** Corps d'erreur : `status`, `code`, `message` dans tous les cas. Les erreurs `api.validation.incoming_failed` ajoutent `details`, liste d'objets `{ path, message }`. Aucun corps d'erreur ne contient de pile d'appels, de requête SQL ni de chemin de fichier, dans aucun environnement. Les codes « non révélateurs » (`security.invalid_credentials`, `import.preview_not_found`) restent limités à `status`, `code`, `message`.
- **Q-PLAT-02 (décidé).** En-tête de réponse `X-Request-Id` sur toutes les réponses, UUID généré par le serveur ; un identifiant fourni par le client est ignoré. Il figure dans chaque ligne de journal technique et n'apparaît dans aucun corps.
- **Q-PLAT-03 (observé, puis décidé).** Le document OpenAPI est servi en JSON sur `GET /api-json` et l'interface de consultation sur `GET /api`, en environnements `development` et `test` seulement ; en production, ces deux chemins répondent `404`.
- **Q-PLAT-04 (décidé).** Corps JSON limité à 1 Mio ; au-delà, `413` et code `api.payload_too_large`. Un JSON mal formé donne `400 api.validation.incoming_failed`.
- **Q-PLAT-05 (décidé).** Une route sans déclaration d'accès empêche le démarrage du serveur : la vérification a lieu à l'amorçage et le message nomme la route. À l'exécution, une route qui échapperait à cette vérification répond `403 security.access_denied`. Une route authentifiée qui n'admet aucun rôle (`roles: []`) sans être protégée par une garde métier (`@UseGuards`) empêche aussi le démarrage (`rule-foundation-access-no-role-without-guard-refused`) ; avec une garde elle est admise et la garde seule décide (`rule-foundation-access-guard-only-route`, version `socle-garde-metier-et-reponses-non-json`).
- **Q-PLAT-06 (observé, puis décidé).** Chemin inexistant : `404`, code `api.route_not_found`, pour tout appelant, connecté ou non ; l'existence d'un chemin n'est pas un secret. Toute erreur non prévue donne `500 api.unknown_error`.
- **Q-PLAT-07 (observé).** Hors `PATCH`, les clés inconnues sont retirées en silence ; sur `PATCH`, elles sont refusées par `400 api.validation.incoming_failed`.
- **Q-PLAT-08 (observé).** `GET /server/health-check` répond `{ "status": "healthy", "services": { "postgres": { "status": "healthy", "latency": <ms> } } }` ; `503` avec `status: "unhealthy"` quand la base ne répond pas en 2 secondes. La base est le seul service surveillé.
- **Q-PLAT-09 (décidé).** `(inferred)` pour les trois règles.

## Authentification

- **Q-AUTH-01 (observé).** Connexion sans en-tête `Origin` et sans `returnToken: true` : `400`, code `security.invalid_origin`.
- **Q-AUTH-02 (décidé).** Provenance `(user)` : ces règles décrivent la demande de connexion du propriétaire.
- **Q-AUTH-03 (reporté).** Pas de révocation côté serveur dans cette version ; la déconnexion expire le cookie.
- **Q-AUTH-04 (reporté).** Le rôle reste figé dans le jeton jusqu'à la reconnexion.
- **Q-AUTH-05 (observé).** Cookie `<slug>-jwt-<hôte de l'Origin>`, `Max-Age=86400`, `Domain=<hôte de l'Origin>`, `Path=/`, `HttpOnly`, `SameSite=Strict`, `Secure` hors `localhost`.

## Comptes

- **Q-COMPTES-01 (reporté).** Borne exprimée en caractères (8 à 72), conforme au contrat.
- **Q-COMPTES-02 (décidé).** Adresse valide : 254 caractères au plus, une seule arobase, partie locale non vide sans espace, domaine contenant au moins un point, sans espace ni point en tête ou en fin. Un seul validateur partagé par `POST /users`, `POST /auth/login` et l'import. Comparaison et stockage inchangés (chapitre 30 : sensible à la casse, enregistrée telle que saisie).
- **Q-COMPTES-03 (décidé).** Volontaire : aucun écran pour les utilisateurs ordinaires dans cette version.

## Groupes et périmètres

- **Q-PERIM-01 (décidé).** Non prévu.
- **Q-PERIM-02 (décidé).** La preuve de la règle par ligne est fournie par des tests du socle qui créent, dans leur propre préparation, une table rattachée à un périmètre (hors contrat de données) et vérifient lecture, écriture et refus pour un utilisateur ordinaire, un membre de groupe et un administrateur.

## Journal d'audit

- **Q-AUDIT-01 (décidé).** Singulier pour 0 et 1, pluriel à partir de 2, selon l'usage français.
- **Q-AUDIT-02 (décidé).** Le suffixe `import-confirm` s'affiche « Import ».
- **Q-AUDIT-03 (décidé).** Base de recette : nom se terminant par `_test`.

## Import

- **Q-IMPORT-01 (reporté).** Comptes importés sans secret de connexion ; arbitrage du propriétaire attendu.
- **Q-IMPORT-02 (décidé).** Une entrée par import, type d'objet « Import de comptes ».
- **Q-IMPORT-03 (décidé).** Entrée chiffrée dans un `.xlsx` : `import.unsafe_archive`.
- **Q-IMPORT-04 (décidé).** CSV sans ligne d'en-tête : `import.missing_columns` ; fichier `.csv` vide : `import.invalid_file_type`.
- **Q-IMPORT-05 (décidé).** Cohérence voulue : l'API reste permissive, l'écran protège l'utilisateur.
- **Q-IMPORT-06 (reporté).** Pas de limite d'analyses simultanées dans cette version.
- **Q-IMPORT-07 (décidé).** `413 import.file_too_large`.
- **Q-IMPORT-08 (décidé).** Constantes conservées telles que décrites au chapitre 60.

## Écrans

- **Q-ECRANS-01 (décidé).** Les spécifications de pages font foi.
- **Q-ECRANS-02 (décidé).** Document HTML en `lang="fr"` ; sélecteurs de date natifs, affichés `jj/mm/aaaa` dans un navigateur réglé en français.
- **Q-ECRANS-03 (décidé).** Acceptés par l'API ; l'écran les affiche échappés, sans interprétation.
