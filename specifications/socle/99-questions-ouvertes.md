# 99 — Questions ouvertes

Comportements que les sources disponibles (spécifications, demandes d'origine, recette, captures, contrat de données) ne permettent pas de trancher. Pour chacun : ce qui est connu, ce qui manque, et la position retenue par défaut dans cette spécification quand il en faut une. À arbitrer par le propriétaire du socle.

## Plateforme

**Q-PLAT-01 — Forme complète du corps d'erreur.** Connu : `status` et `code` sont présents au premier niveau ; pour `security.invalid_credentials` et `import.preview_not_found`, le corps est limité à `status`, `code`, `message`, ce qui laisse entendre que les autres erreurs portent des champs supplémentaires. Inconnu : lesquels (détail des champs invalides ? horodatage ? chemin ?). Position par défaut : `status`, `code`, `message` partout ; tout champ ajouté ne doit pas apparaître dans les deux codes « non révélateurs ».

**Q-PLAT-02 — Identifiant de corrélation.** Aucune source ne décrit l'identifiant de corrélation demandé : nom de l'en-tête (par exemple `X-Request-Id`), format, réutilisation d'un identifiant fourni par le client, présence dans les corps d'erreur autres que les deux codes « non révélateurs ». Position par défaut : en-tête de réponse sur toutes les réponses, généré par le serveur, jamais dans les corps de l'EXI-PLAT-02.

**Q-PLAT-03 — Chemin du document OpenAPI servi.** La recette du socle d'origine lit « le document OpenAPI de l'API en fonctionnement », sans que le chemin soit donné. À fixer (et à rendre public ou non en production).

**Q-PLAT-04 — Taille maximale d'un corps JSON** et statut/code de dépassement (`413` attendu, code non défini). Non fixée par les sources.

**Q-PLAT-05 — Refus par défaut d'une route non déclarée : réponse exacte.** Les sources établissent que toute route doit être déclarée, qu'un contrôle mécanique compare la matrice observée aux fichiers de permissions et qu'aucune exception n'existe pour la production ; elles ne donnent pas la réponse d'une route non déclarée (`401` / `403 security.access_denied` retenu ici, peut-être `404` ou `500`). À confirmer.

**Q-PLAT-06 — Corps d'une réponse `404` de route inexistante** (code d'erreur éventuel, par exemple pour `DELETE /users/:id`). La recette ne vérifie que le statut. Et : un visiteur reçoit-il `401` ou `404` sur un chemin inexistant ? (La recette tolère les deux pour `/audit-logs`.)

**Q-PLAT-07 — Clés inconnues hors routes `PATCH`.** Les sources indiquent que la validation globale retire silencieusement les clés inconnues des autres corps (par exemple `POST /scopes` avec une clé en trop) et que seules les routes `PATCH` les refusent. Retenu : ignorées. À confirmer qu'il ne faut pas les refuser partout.

**Q-PLAT-08 — Contenu de `services` dans le point de santé** et condition exacte du `503` (base de données seulement ?). Non décrits.

**Q-PLAT-09 — Provenance divergente.** `rule-foundation-list-pagination`, `rule-foundation-admin-nav` et `rule-foundation-admin-screens-guard` sont `(inferred)` dans le résumé de module et dans les spécifications de pages, mais `(user)` dans la couverture de recette de la version `socle-groupes-perimetres` (la couverture du journal reprend `(inferred)` pour la pagination). Cette spécification retient `(inferred)`.

## Authentification

**Q-AUTH-01 — Connexion sans `Origin` et `returnToken: false`.** Le contrat dit qu'« une erreur est levée » ; statut et code non précisés.

**Q-AUTH-02 — Provenance des règles `rule-auth-login-email-password`, `rule-auth-login-error-message`, `rule-auth-session-persistence` et de l'étiquette `foundation-auth`.** Elles proviennent de la suite de recette d'origine figée, sans indication `(user)` / `(inferred)`. Notées « provenance non indiquée ».

**Q-AUTH-03 — Révocation à la déconnexion.** Le jeton est sans état ; la déconnexion expire le cookie mais ne révoque pas un jeton déjà émis (la recette ne l'exige pas). Faut-il une révocation côté serveur ?

**Q-AUTH-04 — Rôle figé dans le jeton.** Un changement de rôle ne prend effet qu'à la reconnexion (jusqu'à 24 h). Acceptable ?

**Q-AUTH-05 — Origines distinctes.** Le cookie `SameSite=Strict` suppose que studio et API partagent le même site ; des domaines distincts ne sont pas pris en charge. Le cookie est nommé et rattaché à l'hôte de l'`Origin` (non à l'hôte de l'API) : comportement à conserver tel quel pour la recette.

## Comptes

**Q-COMPTES-01 — Mot de passe borné en caractères.** 8 à 72 caractères ; bcrypt tronque au-delà de 72 octets, donc un mot de passe multi-octets long est tronqué silencieusement. Faut-il borner en octets ?

**Q-COMPTES-02 — Critère exact de validité d'une adresse e-mail.** Les sources renvoient à un validateur de bibliothèque sans en donner les règles ; la recette vérifie seulement des cas simples (`not-an-email` refusé, 254 caractères accepté). Le même critère doit servir à `POST /users`, à `POST /auth/login` et à l'import.

**Q-COMPTES-03 — Écran pour les utilisateurs ordinaires.** Ils peuvent lire leur compte et leurs groupes par l'API, mais aucun écran ne l'expose. Volontaire dans cette version.

## Groupes et périmètres

**Q-PERIM-01 — Une ligne rattachée à plusieurs périmètres**, ou des groupes et comptes filtrables par périmètre dans le journal : non prévus (`scope` = `null` pour comptes et groupes).

**Q-PERIM-02 — Mécanisme de règle par ligne non observable par la recette.** Aucune route du contrat ne lit de table rattachée à un périmètre ; la réécriture doit en fournir la preuve par ses propres tests. Le format de ces tests est libre.

## Journal d'audit

**Q-AUDIT-01 — Accord de « 0 ».** Les résumés utilisent le singulier pour 0 (« 0 membre », vu sur une capture). Pour un import confirmé sans ligne valide, le résumé attendu serait « Import de 0 compte depuis « … » » ; non vérifié par la recette.

**Q-AUDIT-02 — Verbe affiché pour `users:import-confirm`.** L'écran traduit seulement `create`, `update`, `delete` ; pour le suffixe `import-confirm`, il affiche le suffixe brut. Faut-il un libellé français (« Import ») ?

**Q-AUDIT-03 — Nom de la base de recette.** Le vidage complet du journal est toléré seulement dans la base de recette (actuellement reconnue par un nom se terminant par `_test`). Le critère exact de reconnaissance est à fixer avec l'environnement de recette.

## Import

**Q-IMPORT-01 — Comptes importés sans possibilité de connexion** (`rule-foundation-import-users-no-password`). Arbitrage humain en attente ; une fonctionnalité d'invitation ou de définition de mot de passe est la suite naturelle. Alternatives écartées : mot de passe initial commun, mot de passe affiché une fois, absence de secret (la connexion répondrait `404`).

**Q-IMPORT-02 — Une entrée de journal par import**, pas une par compte créé (la demande d'API initiale évoquait aussi des traces par compte, et un type d'objet `user-import` au lieu de `Import de comptes`). Retenu : une entrée, type `Import de comptes`, comme la recette.

**Q-IMPORT-03 — Entrée chiffrée dans un `.xlsx`.** Deux sections des sources se contredisent : `import.invalid_file_type` (classeur protégé) ou `import.unsafe_archive` (entrée chiffrée). La recette accepte les deux. À trancher.

**Q-IMPORT-04 — CSV sans ligne d'en-tête** : `import.missing_columns` ou `import.invalid_file_type` (la recette accepte les deux). Fichier `.csv` vide : `import.invalid_file_type` retenu.

**Q-IMPORT-05 — Confirmation d'un aperçu sans ligne valide** : autorisée par l'API (et tracée, empreinte mémorisée), interdite par l'écran. Cohérence voulue ?

**Q-IMPORT-06 — Analyses simultanées et délais.** Pas de limite au nombre d'analyses concurrentes ; chaque analyse a besoin d'un espace disque temporaire égal à la taille maximale ; un mandataire inverse placé devant l'API doit autoriser des requêtes de plusieurs minutes. Faut-il une limite ?

**Q-IMPORT-07 — `413` ou `400` pour un fichier trop gros.** La demande d'écran tolérait `400 import.file_too_large` « si le serveur ne permet pas 413 » ; la recette exige `413`. Retenu : `413`.

**Q-IMPORT-08 — Constantes de limites** (100 Mio, 1 000 000 lignes, 2 h, 1 000 caractères, limites d'archive) choisies pendant la fabrication et non par la demande d'origine. Modifiables sans changer la forme du contrat, mais la recette en dépend.

## Écrans

**Q-ECRANS-01 — Captures incohérentes.** Les captures des groupes et des périmètres n'affichent pas l'onglet « Journal » et celle des périmètres n'affiche pas la colonne « Actions » ; les spécifications de pages les prévoient. La spécification retient les spécifications de pages (captures probablement antérieures ou tronquées en largeur).

**Q-ECRANS-02 — Format des champs date.** Les champs « Du » / « Au » sont des sélecteurs de date natifs ; leur affichage dépend de la langue du navigateur (`mm/dd/yyyy` sur la capture). Faut-il forcer `JJ/MM/AAAA` ?

**Q-ECRANS-03 — Valeurs « 0 » et caractères de contrôle à l'écran.** La capture des périmètres montre des noms contenant des caractères de contrôle (données de tests de robustesse). L'API les accepte dans les noms de périmètres et de groupes ; faut-il les refuser ?
