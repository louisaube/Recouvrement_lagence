# 70 — Écrans du studio

Le studio est une application web en français. Ce document décrit chaque écran : chemin, accès, éléments, textes exacts, états et parcours. Les textes entre « » sont à reproduire à l'identique. La présentation visuelle (couleurs, typographie) est libre tant que la structure et les textes sont respectés ; les captures de `in/captures/` montrent l'aspect de référence (barre d'en-tête bleue, titre de page à gauche, boutons d'action à droite, tableaux dans des cartes).

## 1. Carte des écrans

| Chemin | Écran | Accès |
|---|---|---|
| `/connexion` | Connexion | public (un utilisateur connecté est redirigé) |
| `/` | Accueil | connecté |
| `/utilisateurs` | Utilisateurs | administrateur |
| `/utilisateurs/import` | Importer des utilisateurs | administrateur |
| `/groupes` | Groupes | administrateur |
| `/perimetres` | Périmètres | administrateur |
| `/journal` | Journal d'audit | administrateur |
| tout autre chemin | redirection vers `/` | — |

Les futures fonctionnalités métier ajoutent leurs pages protégées à côté de l'accueil et remplacent l'accueil.

## 2. Règles transverses du studio

### `rule-foundation-french-ui` (user) — Tout en français
Tous les textes du studio sont en français : écran de connexion, mise en page, écrans d'administration, journal, import, messages d'erreur, libellés de pagination (« Lignes par page : », « 1–10 sur 27 »). Les raisons d'erreur d'import et les résumés du journal, rédigés en français par l'API, sont affichés tels quels ; aucun message technique de l'API n'est jamais affiché.

### `rule-foundation-protected-redirect` (user) — Redirection vers la connexion
Toute page protégée ouverte sans session redirige (en remplaçant l'entrée d'historique) vers `/connexion?redirection=<chemin + paramètres, encodés>`. Côté API, le signal est `GET /auth/current-user` qui répond `200 {}` sans session. Exemple : `/` → `/connexion?redirection=%2F` ; un lien filtré du journal revient, après connexion, au même lien filtré.

### `rule-foundation-no-protected-flash` (inferred) — Pas de contenu protégé avant vérification
Tant que `GET /auth/current-user` n'a pas répondu, l'écran affiche seulement un indicateur de chargement plein écran avec « Chargement… » ; aucun contenu protégé n'est rendu avant que la session soit vérifiée.

### `rule-foundation-session-persists` (user) — rappel
Au chargement de l'application, la session est restaurée par `GET /auth/current-user` (cookie envoyé avec les requêtes), sans nouvelle saisie. Voir `20-authentification-session.md`.

### `rule-foundation-session-expired` (inferred) — rappel
`{}`, `401` ou une erreur réseau à cet appel signifient « non connecté ». Voir `20-authentification-session.md`.

### `rule-foundation-api-unreachable` (inferred) — API injoignable
Si l'API est injoignable au chargement, l'utilisateur est considéré comme non connecté et une page protégée redirige vers `/connexion`.

### `rule-foundation-api-failure-handling` (inferred) — Gestion des échecs d'API
Sur tous les écrans connectés :
- `401` en cours d'utilisation = fin de session : état local effacé, retour à l'écran de connexion ;
- `403` : « Action non autorisée. » ;
- autres échecs (réseau, 5xx, codes non prévus) : « Une erreur est survenue. Veuillez réessayer. », avec un bouton « Réessayer » pour les listes ;
- `400` dans un formulaire, sauf message dédié : « Données invalides. Vérifiez les champs. » ;
- aucun message technique de l'API n'est affiché.

### `rule-foundation-list-pagination` (inferred) — rappel d'écran
Les listes d'administration sont paginées côté serveur : 10, 25 ou 50 lignes par page, 10 par défaut ; libellés « Lignes par page : » et « <début>–<fin> sur <total> ». Les listes de choix des formulaires (groupes, membres, périmètres) sont chargées en entier.

### `rule-foundation-role-label` (inferred) — Libellés des rôles
`admin` s'affiche « Administrateur », `user` « Utilisateur » (en-tête, liste des utilisateurs, formulaires) ; un rôle inconnu s'affiche tel quel. L'API renvoie `user` / `admin` (`GET /auth/current-user`).

### États de liste communs
- Chargement : indicateur de progression.
- Erreur : message d'échec (voir `rule-foundation-api-failure-handling`) et bouton « Réessayer ».
- Vide : texte propre à chaque liste (ci-dessous).

### Garde des écrans d'administration

### `rule-foundation-admin-screens-guard` (inferred) — « Accès refusé »
Un utilisateur ordinaire qui ouvre une adresse d'administration (`/utilisateurs`, `/utilisateurs/import`, `/groupes`, `/perimetres`, `/journal`) voit, dans la mise en page commune et sans changement d'adresse, l'écran :
- titre « Accès refusé » ;
- texte « Vous n'avez pas les droits nécessaires pour consulter cette page. » ;
- bouton « Retour à l'accueil » (vers `/`).
Aucun appel aux routes d'administration n'est fait. C'est une commodité : la sécurité repose sur l'API (`403` / `401`). (Capture `recette-user-_utilisateurs.png`.)

## 3. Connexion — `/connexion`

Public, sans la mise en page commune. Carte centrée étroite.

### `rule-foundation-login-screen` (user) — Écran de connexion
Éléments, de haut en bas : le nom de l'application (« Monappli ») en surtitre, le titre « Connexion », le champ « Adresse e-mail » (focus initial, saisie automatique « nom d'utilisateur »), le champ « Mot de passe » (masqué, saisie automatique « mot de passe actuel »), la zone d'alerte d'erreur (rôle d'alerte, au-dessus du bouton), le bouton « Se connecter » (« Connexion en cours… » et désactivé pendant l'envoi). Aucun élément « se souvenir de moi ».

### `rule-foundation-login-single-error` (user) — rappel d'écran
Tout échec — 401, 400, erreur réseau, 5xx, ou session non établie après la connexion (cookie non conservé) — affiche le seul message « Identifiants incorrects. ». Le message reste quand on modifie un champ et est remplacé à la soumission suivante.

### `rule-foundation-login-submit-guard` (inferred) — Garde de soumission
Un e-mail ou un mot de passe vide n'envoie aucune requête et affiche « Identifiants incorrects. ». Aucune seconde soumission tant qu'une est en cours.

### Parcours de connexion
Envoi `POST /auth/login { email (rogné), password, returnToken: false }` (cookie posé par l'API), puis `GET /auth/current-user`, puis navigation (remplacement d'historique).

### `rule-foundation-login-redirect-home` (inferred) — Destination après connexion
Après succès, l'utilisateur va à la valeur de `?redirection=` si c'est un chemin interne sûr, sinon à `/`. Sont rejetés (→ `/`) : une valeur ne commençant pas par `/`, commençant par `//` ou `/\`, contenant des caractères de contrôle, ou égale à `/connexion` (pour éviter une boucle).

### `rule-foundation-login-already-connected` (inferred) — Déjà connecté
Un utilisateur connecté qui ouvre `/connexion` est redirigé vers la même destination sûre (`/` par défaut). Pendant la vérification de session, l'écran de chargement s'affiche.

### `rule-foundation-no-self-signup` / `rule-foundation-no-password-reset` (user) — rappel d'écran
Aucun lien de création de compte ; aucun lien ni formulaire « mot de passe oublié ».

## 4. Mise en page commune (toutes les pages connectées)

### `rule-foundation-layout-header` (user) — En-tête commun
Barre d'en-tête avec, à gauche, le nom de l'application « Monappli » (lien vers `/`) ; à droite, l'e-mail de l'utilisateur connecté (tronqué avec « … » s'il est long), une pastille de rôle (« Administrateur » / « Utilisateur ») et le bouton « Se déconnecter » (icône seule, avec un nom accessible, sous 600 px de large). Les données viennent de `GET /auth/current-user` (`{ id, email, role }`). Le rôle n'est pas revérifié pendant la session. Contenu des pages centré, largeur maximale d'environ 1 200 px.

### `rule-foundation-admin-nav` (inferred) — Onglets d'administration
Pour les administrateurs seulement, une seconde barre sous l'en-tête porte les onglets (navigation nommée « Administration ») : « Utilisateurs » (`/utilisateurs`), « Groupes » (`/groupes`), « Périmètres » (`/perimetres`), « Journal » (`/journal`). L'onglet actif suit le début du chemin (« Utilisateurs » reste actif sur `/utilisateurs/import` ; « Journal » quels que soient les paramètres) ; aucun onglet actif sur les autres pages. Les onglets défilent horizontalement sur petit écran. Un utilisateur ordinaire a l'en-tête sans onglets.

### `rule-foundation-logout` (inferred) — rappel d'écran
« Se déconnecter » appelle `POST /auth/logout`, efface l'état local et ramène à `/connexion` (remplacement d'historique), même si l'appel échoue. Voir `20-authentification-session.md`.

## 5. Accueil — `/`

### `rule-foundation-home-welcome` (user) — « Bienvenue » et e-mail
Après connexion (sans destination mémorisée), l'utilisateur arrive sur une page qui affiche le titre « Bienvenue » puis, sur une ligne séparée, son e-mail (présent aussi dans l'en-tête, volontairement). (Capture `recette-admin-_.png`.)

### `rule-foundation-home-replaceable` (user) — Page provisoire
La page n'a aucune fonctionnalité : ni carte, illustration, menu, bouton, lien ni champ ; elle n'appelle aucune route (elle lit l'utilisateur déjà chargé). Les versions métier la remplaceront.

## 6. Utilisateurs — `/utilisateurs` (administrateur)

Capture `recette-admin-_utilisateurs.png`. Règles API : `30-comptes.md`.

### `rule-foundation-users-admin-screen` (user) — Écran des utilisateurs
- En-tête de page : titre « Utilisateurs » ; à droite, bouton secondaire « Importer des utilisateurs » (icône de dépôt de fichier, lien vers `/utilisateurs/import`) et bouton principal « Nouvel utilisateur » (passent sous le titre sous 600 px).
- Tableau, colonnes : « Adresse e-mail » (tronquée au-delà d'environ 300 px, valeur complète en infobulle), « Rôle » (« Utilisateur » / « Administrateur »), « Groupes » (une pastille par groupe, « Aucun groupe » si vide), « Actions » (bouton icône « Modifier », nom accessible « Modifier l'utilisateur <e-mail> »). Pagination. Pas de suppression, désactivation ni recherche.
- Liste vide : « Aucun utilisateur. ».
- Données : `GET /users?from=&size=` (trié par e-mail).

**Dialogue de création** (« Nouvel utilisateur ») : champs « Adresse e-mail », « Mot de passe » (masqué, aide « 8 caractères minimum. »), « Rôle » (liste, « Utilisateur » par défaut), « Groupes » (choix multiple, aucun par défaut, options = tous les groupes, aide « Un utilisateur sans groupe ne voit aucune donnée rattachée à un périmètre. »), boutons « Annuler » et « Enregistrer ». Validation locale sans appel : e-mail non vide, ≤ 254 caractères, contenant un `@` entouré de texte ; mot de passe de 8 à 72 caractères ; rôle choisi. Envoi `POST /users { email, password, role, groupIds }`.

**Dialogue de modification** (bouton « Modifier ») : e-mail en lecture seule, pas de champ mot de passe, « Rôle » et « Groupes » modifiables. Envoi `PATCH /users/:id { role, groupIds }` uniquement (le mot de passe n'est jamais envoyé).

Succès : dialogue fermé, liste rechargée (première page après une création), notification « Utilisateur créé. » / « Utilisateur modifié. ». Échecs (dialogue ouvert, saisies conservées, mot de passe compris) : `409 users.email_already_exists` → « Cette adresse e-mail est déjà utilisée. » sous le champ e-mail ; `409 users.cannot_change_own_role` → « Vous ne pouvez pas modifier votre propre rôle. » ; `400` → « Données invalides. Vérifiez les champs. » ; autres selon `rule-foundation-api-failure-handling`. Échec du chargement des groupes : alerte « Impossible de charger les groupes. » avec « Réessayer », « Enregistrer » désactivé.

La liste n'est pas rechargée automatiquement après un import ; elle l'est à la réouverture de `/utilisateurs`.

### `rule-foundation-user-own-role-locked` (inferred) — rappel d'écran
Sur la ligne de l'administrateur connecté, le champ « Rôle » est désactivé avec l'aide « Vous ne pouvez pas modifier votre propre rôle. ».

### `rule-foundation-user-no-group-no-data` (user) — rappel d'écran
Le formulaire rappelle sous « Groupes » qu'un utilisateur sans groupe ne voit aucune donnée rattachée à un périmètre.

## 7. Importer des utilisateurs — `/utilisateurs/import` (administrateur)

Capture `recette-admin-_utilisateurs_import.png`. Règles API : `60-import.md`. L'écran repose sur un parcours d'import générique réutilisable par toute fonctionnalité (seuls les appels API, le nom des objets — « compte » / « comptes » — et le lien de sortie changent).

### Structure
- Bouton retour « Utilisateurs » (flèche, vers `/utilisateurs`) et titre « Importer des utilisateurs » (le retour passe au-dessus du titre sous 600 px).
- Dans une carte, un indicateur de trois étapes : « Dépôt du fichier », « Aperçu », « Confirmation » (vertical sous 600 px). Étape 1 pendant le dépôt et l'analyse, 2 après l'analyse, 3 pendant et après la confirmation.
- Pas de paramètre d'adresse : un rechargement revient au dépôt ; quitter la page abandonne simplement un aperçu (rien d'irréversible avant la confirmation, aucune garde de navigation).

### Étape 1 — Dépôt
- Zone de dépôt en pointillés (hauteur ≥ 160 px) : icône de fichier, « Glissez un fichier .xlsx ou .csv ici », bouton « Choisir un fichier » (champ fichier caché limité à `.xlsx,.csv`, nom accessible « Fichier à importer »). Surlignée pendant un glisser-déposer ; grisée et inactive pendant l'analyse et la confirmation. Un seul fichier : si plusieurs sont déposés, seul le premier est retenu avec le message « Un seul fichier à la fois : seul « <nom> » a été retenu. ». Le champ est réinitialisé après chaque sélection (on peut redéposer le même fichier).
- Panneau « Colonnes attendues » : « La première ligne du fichier doit contenir les noms de colonnes ci-dessous. Formats acceptés : .xlsx et .csv, maximum 100 Mo et 1 000 000 lignes. » (valeurs issues de la spécification, nombres au format français) ; tableau « Colonne » / « Obligatoire » (« Oui » / « Non ») / « Description » avec les descriptions renvoyées par l'API. Échec du chargement : « Impossible de charger les colonnes attendues. » avec « Réessayer » ; le dépôt reste possible.
- Alerte d'erreur au-dessus de la zone pour un fichier refusé.
- Pendant l'analyse : barre de progression indéterminée, « Analyse du fichier en cours… Pour un très gros fichier, cela peut prendre plusieurs minutes. Ne fermez pas cette page. » et bouton « Annuler ».

### `rule-foundation-import-client-precheck` (inferred) — Contrôles locaux avant envoi
Avant tout envoi, sans lire le contenu : extension autre que `.xlsx`/`.csv` (insensible à la casse) → « Format non pris en charge. Déposez un fichier .xlsx ou .csv. » ; fichier de 0 octet → « Le fichier est vide. » ; taille supérieure à `maxFileSizeBytes` → « Le fichier est trop volumineux (maximum N Mo). ». Un fichier refusé localement n'est pas envoyé. Un fichier accepté lance **immédiatement** l'analyse (pas de bouton d'envoi séparé). Si la spécification n'a pas pu être chargée, le contrôle de taille est sauté (l'API tranche).

### `rule-foundation-import-no-client-parsing` (inferred) — Le navigateur ne lit pas le fichier
Le fichier est transmis tel quel dans un envoi `multipart/form-data` (partie `file`), sans que le navigateur en lise ni en analyse le contenu ; l'écran affiche le résultat de l'API.

### Messages de refus à l'analyse
(`N` vient de la spécification ; si elle n'a pas pu être chargée, la parenthèse est omise.) Après un refus, l'écran revient au dépôt et le fichier est oublié.

| Réponse | Message |
|---|---|
| `400 import.invalid_file_type` | « Ce fichier n'est ni un classeur .xlsx ni un fichier .csv valide. » |
| `400 import.unsafe_archive` | « Fichier refusé : l'archive contenue dans ce classeur est jugée dangereuse (taille décompressée excessive ou structure suspecte). » |
| `400 import.external_links` | « Fichier refusé : il contient des formules ou des liaisons vers des fichiers externes. Remplacez-les par des valeurs puis réessayez. » |
| `413` ou `import.file_too_large` | « Le fichier est trop volumineux (maximum N Mo). » |
| `400 import.too_many_rows` | « Le fichier contient trop de lignes (maximum N lignes). » |
| `400 import.empty_file` | « Le fichier ne contient aucune ligne de données. » |
| `400 import.missing_columns` | « Colonnes manquantes ou illisibles. Vérifiez la première ligne du fichier : elle doit contenir les colonnes attendues ci-dessous. » |
| `409 import.already_imported` | « Ce fichier a déjà été importé. Un même fichier ne peut pas être importé deux fois. » |
| autre `400` | « Données invalides. Vérifiez les champs. » |
| 401 / 403 / autres | `rule-foundation-api-failure-handling` |

### `rule-foundation-import-cancel-analysis` (inferred) — Annuler une analyse
« Annuler » interrompt la requête d'analyse et ramène au dépôt **sans message d'erreur**. Côté API, la fermeture de la connexion arrête l'analyse et rien n'est conservé (aucun aperçu). Une réponse tardive d'une analyse abandonnée est ignorée.

### Étape 2 — Aperçu
- Résumé : nom du fichier ; « Lignes lues : T », « Lignes valides : V » (couleur de succès), « Lignes en erreur : E » (couleur d'erreur si E > 0), nombres au format français (`1 250 000`) ; mention fixe « Rien n'a encore été enregistré. » ; puis une alerte :
  - E = 0 : « Aucune erreur : toutes les lignes seront importées. » ;
  - V > 0 et E > 0 : « Seules les V lignes valides seront importées. Les E lignes en erreur seront ignorées : corrigez le fichier et déposez-le à nouveau pour les importer. » ;
  - V = 0 : « Aucune ligne valide. Corrigez le fichier et déposez-le à nouveau. ».
  La date d'expiration n'est pas affichée.
- Tableau « Lignes en erreur » (seulement si E > 0) : colonnes « Ligne », « Colonne », « Raison » ; en-tête fixe, hauteur maximale ≈ 480 px avec défilement ; pagination serveur 10 / 25 / 50 ; une ligne à plusieurs colonnes fautives occupe plusieurs lignes du tableau ; la raison est le texte français de l'API, affiché tel quel. Échec de chargement : « Réessayer ». `404 import.preview_not_found` : retour au dépôt avec « L'aperçu a expiré ou n'existe plus. Déposez à nouveau le fichier. ».

### Étape 3 — Confirmation
- Boutons « Importer N compte(s) » (N = lignes valides) et « Choisir un autre fichier » (retour au dépôt, état vidé).
- Dialogue « Confirmer l'import » : « N compte(s) seront créés. M ligne(s) en erreur seront ignorées et ne seront pas importées. Cette action est tracée au journal d'audit. » (la deuxième phrase seulement si M > 0) ; boutons « Annuler » et « Confirmer l'import ». Pendant l'envoi : boutons désactivés, « Import en cours… ».
- Une série de clics n'envoie qu'**une** requête de confirmation et garde le succès.
- Résultat : alerte de succès « N compte(s) créé(s). » ; si `skippedCount` > 0, alerte d'avertissement « M ligne(s) valide(s) à l'aperçu n'ont pas pu être enregistrées (par exemple parce qu'un compte a été créé entre-temps). » ; boutons « Importer un autre fichier » et lien « Retour aux utilisateurs » (`/utilisateurs`).
- Échecs (dialogue fermé, aperçu conservé, alerte au-dessus) : `404 import.preview_not_found` → « L'aperçu a expiré ou n'existe plus. Déposez à nouveau le fichier. » avec le bouton « Déposer un fichier » (retour au dépôt) ; `409 import.already_imported` → message de doublon, même bouton ; autres → message générique avec « Réessayer » qui relance la confirmation.

### `rule-foundation-import-confirm-needs-valid-rows` (inferred) — Rien à importer
Quand l'aperçu ne compte aucune ligne valide, le bouton d'import est désactivé avec le texte « Aucune ligne valide : rien à importer. ».

### Rappels de règles d'import visibles à l'écran
`rule-foundation-import-formats`, `-two-steps`, `-preview-content`, `-confirm-valid-only`, `-no-double`, `-trapped-files-refused`, `-large-files`, `-users-columns`, `-users-admin-only` (écran protégé par la garde d'administrateur ; point d'entrée seulement sur l'écran Utilisateurs), `-audited` (mention dans le dialogue), `-preview-expires`, `-errors-paginated` : voir `60-import.md`.

## 8. Groupes — `/groupes` (administrateur)

Capture `recette-admin-_groupes.png`. Règles API : `40-groupes-perimetres.md`.

### `rule-foundation-groups-admin-screen` (user) — Écran des groupes
- Titre « Groupes », bouton « Nouveau groupe ».
- Tableau : « Nom », « Membres » (« Aucun membre », « 1 membre », « N membres »), « Périmètres » (une pastille par périmètre affichant le code, nom du périmètre en infobulle), « Actions » (« Modifier », nom accessible « Modifier le groupe <nom> »). Pagination. Pas de suppression.
- Liste vide : « Aucun groupe pour le moment. Créez le premier groupe. ».
- Données : `GET /groups?from=&size=` (trié par nom sans tenir compte de la casse).

### `rule-foundation-group-definition` (user) — rappel d'écran
Dialogue de création / modification : « Nom », « Membres » (choix multiple, option = e-mail, « Aucun utilisateur » quand rien ne correspond), « Périmètres » (choix multiple, option « <code> — <nom> », pastille = code ; aide « Au moins un périmètre. »), alerte d'erreur, « Annuler » / « Enregistrer ». Le dialogue charge tous les comptes et tous les périmètres à l'ouverture (champs désactivés pendant le chargement ; échec : « Impossible de charger les utilisateurs et les périmètres. » avec « Réessayer », « Enregistrer » désactivé). En modification, le dialogue est prérempli et envoie toujours les trois champs (`PATCH /groups/:id { name, userIds, scopeIds }`), qui remplacent les valeurs actuelles. « Annuler » ou Échap ferment sans appel ni confirmation.

### `rule-foundation-group-needs-scope` (user) — rappel d'écran
Validation locale sans appel : nom obligatoire après rognage, ≤ 100 caractères ; au moins un périmètre. S'il n'existe aucun périmètre : « Aucun périmètre n'existe encore. Créez-en depuis l'écran Périmètres. » avec un lien vers `/perimetres`.

Succès : dialogue fermé, liste rechargée (première page après une création), notification « Groupe créé. » / « Groupe modifié. ». Échecs (dialogue ouvert, saisies conservées) : `409 groups.name_already_exists` → « Ce nom de groupe est déjà utilisé. » sous le nom ; `400` → « Données invalides. Vérifiez les champs. » ; autres selon `rule-foundation-api-failure-handling`.

## 9. Périmètres — `/perimetres` (administrateur)

Capture `recette-admin-_perimetres.png`. Règles API : `40-groupes-perimetres.md`.

### `rule-foundation-scopes-admin-screen` (user) — Écran des périmètres
- Titre « Périmètres », bouton « Nouveau périmètre » (empilés sous 600 px).
- Tableau : « Code », « Nom », « Actions » (« Modifier », nom accessible « Modifier le périmètre <code> »). Pagination. Pas de suppression.
- Liste vide : « Aucun périmètre pour le moment. Créez le premier périmètre. ».
- Données : `GET /scopes?from=&size=` (trié par code).

Dialogue (plein écran sous 600 px) : champs « Code » et « Nom », alerte d'erreur, « Annuler » / « Enregistrer » (« Enregistrement… » et désactivé pendant l'envoi).
- Création : aide sous « Code » : « Lettres minuscules, chiffres, tirets et tirets bas (50 caractères maximum). Le code ne pourra plus être modifié. ». Envoi `POST /scopes { code, name }` (rognés).
- Modification : « Code » en lecture seule avec l'aide « Le code ne peut pas être modifié. ». Envoi `PATCH /scopes/:id { name }`.

### `rule-foundation-scope-code-format` (inferred) — rappel d'écran
Validation locale sans appel : code et nom obligatoires après rognage ; code conforme à `^[a-z0-9][a-z0-9_-]{0,49}$`, sinon « Le code ne doit contenir que des lettres minuscules, chiffres, tirets et tirets bas. » (aucune mise en minuscules automatique) ; nom ≤ 100 caractères.

Succès : dialogue fermé, page courante rechargée (première page après une création), notification « Périmètre créé. » / « Périmètre modifié. ». Échecs (dialogue ouvert, saisies conservées) : `409 scopes.code_already_exists` → « Ce code est déjà utilisé. » sous le champ code ; `400` → « Données invalides. Vérifiez les champs. » ; `401` → fin de session ; `403` → « Action non autorisée. » ; autre → « Une erreur est survenue. Veuillez réessayer. ».

## 10. Journal d'audit — `/journal` (administrateur)

Capture `recette-admin-_journal.png`. Écran en lecture seule. Règles API : `50-journal-audit.md`.

### `rule-foundation-audit-french-screen` (user) — rappel d'écran
- Titre « Journal d'audit » et bouton « Copier le lien » (empilés sous 600 px).
- Carte de filtres (3 colonnes au-dessus de 900 px, 2 dès 600 px, 1 en dessous ; libellés toujours visibles) :
  - « Auteur » : choix unique avec saisie, option = e-mail, « Aucun auteur » quand rien ne correspond ;
  - « Action » : liste, première option « Toutes », option = verbe français et code (« Modification — groups:update ») ;
  - « Type d'objet » : liste, « Tous » ;
  - « Périmètre » : liste, « Tous », option = code ;
  - « Du » et « Au » : champs date natifs ;
  - bouton « Réinitialiser les filtres » (désactivé sans filtre actif).
  Les contrôles sont désactivés pendant le chargement des valeurs. Échec du chargement des valeurs : avertissement « Impossible de charger les valeurs des filtres. » avec « Réessayer » ; la liste reste lisible.
- Tableau, colonnes : « Date » (`JJ/MM/AAAA HH:mm:ss`, fuseau du navigateur, valeur ISO conservée en attribut machine), « Auteur » (e-mail enregistré dans l'entrée), « Action » (pastille avec le verbe français — « Création » pour `create`, « Modification » pour `update`, « Suppression » pour `delete`, le suffixe brut sinon — et le code en texte secondaire), « Objet » (type d'objet, identifiant en police à chasse fixe en texte secondaire, tronqué, valeur complète en infobulle), « Périmètre » (code ou « — »), « Résumé » (texte brut, jamais interprété comme du HTML). Pas de colonne d'actions ; ordre de l'API (plus récent d'abord), non modifiable ; défilement horizontal sous 600 px. Pagination 10 / 25 / 50.
- Liste vide : « Aucune action n'a encore été tracée. » sans filtre actif ; « Aucune entrée ne correspond à ces filtres. » avec filtres.
- Erreurs de liste : `401` → fin de session ; `403` → « Action non autorisée. » ; autre → « Une erreur est survenue. Veuillez réessayer. » avec « Réessayer ».
- Données : `GET /audit-logs` (seuls les filtres non vides sont envoyés) et `GET /audit-logs/filters` (chargé une fois à l'ouverture).

### `rule-foundation-audit-shareable-filter` (user) — Partager un filtre par lien
L'état des filtres est porté par l'adresse : paramètres `auteur` (uuid), `action`, `type`, `perimetre`, `du` et `au` (`AAAA-MM-JJ`). Paramètres vides omis ; autres paramètres d'adresse conservés ; page et taille de page non portées. Modifier un contrôle met à jour l'adresse (remplacement pour les dates, nouvelle entrée d'historique pour les autres) et recharge à partir de la première page ; ouvrir un lien restaure les mêmes filtres (après connexion si besoin, via `?redirection=`). « Copier le lien » copie l'adresse courante, puis notification « Lien copié. » ; en cas d'échec ou sans presse-papiers : « Copie impossible. Copiez l'adresse depuis la barre du navigateur. ».

### `rule-foundation-audit-period-inclusive-days` (inferred) — Période en jours entiers
« Du » et « Au » sont des jours civils entiers, bornes incluses, dans le fuseau du navigateur : `du` → `occurredFrom` = 00:00:00.000 de ce jour, `au` → `occurredTo` = 23:59:59.999, envoyés en ISO UTC. « Du » postérieur à « Au » met les deux champs en erreur avec « La date de début doit précéder la date de fin. », affiche ce message à la place des résultats et n'envoie aucun appel.

### `rule-foundation-audit-url-sanitized` (inferred) — Paramètres d'adresse assainis
Une valeur d'adresse invalide est ignorée et retirée de l'adresse : date invalide (`du=abc`, 31 février, année hors 1001–9998), `auteur` non uuid, texte plus long que ce qu'accepte l'API (`action` et `type` 100, `perimetre` 50) ou contenant un caractère nul. Une valeur valide inconnue des listes reste affichée et appliquée (un auteur inconnu s'affiche par son identifiant). Aucune valeur d'adresse n'est interprétée comme du HTML.

### Rappels
`rule-foundation-audit-admin-only` (onglet réservé, « Accès refusé » pour un utilisateur, aucun appel au journal), `rule-foundation-audit-immutable` (aucune commande de modification, suppression ou export), `rule-foundation-audit-survives-author-deletion` (e-mail enregistré affiché tel quel ; auteur toujours sélectionnable), `rule-foundation-audit-declarative-route` (une nouvelle route tracée apparaît sans modification de l'écran), `rule-foundation-audit-filters`, `-filters-combine`, `-newest-first`, `-filter-options-from-journal`, `-summary-no-secret`, `-reads-not-traced` : voir `50-journal-audit.md`.

## 11. Écarts constatés sur les captures
Les captures de `in/captures/` ont été prises à des moments différents : `recette-admin-_groupes.png` et `recette-admin-_perimetres.png` ne montrent pas l'onglet « Journal », et la capture des périmètres ne montre pas la colonne « Actions ». La spécification ci-dessus (quatre onglets, colonne « Actions » présente) fait foi ; voir Q-ECRANS-01. Les champs date affichent le format du navigateur (`mm/dd/yyyy` sur la capture) : voir Q-ECRANS-02.
