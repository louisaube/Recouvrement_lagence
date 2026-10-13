# 60 — Import de fichiers Excel / CSV

Le socle fournit un **mécanisme d'import réutilisable** et l'applique à l'**import en masse de comptes** par les administrateurs. Lecture des classeurs `.xlsx` : bibliothèque publique `@maleus/xlsx` (licence MIT), imposée par la demande d'origine, qui lit les classeurs en flux.

Routes de l'import de comptes (toutes réservées au rôle `admin`) :

| Route | Code d'action | Rôle |
|---|---|---|
| `GET /users/imports/specification` | `users:import-specification` | colonnes, formats et limites attendus |
| `POST /users/imports/preview` | `users:import-preview` | analyse d'un fichier, sans aucune écriture métier → aperçu |
| `GET /users/imports/:importId/errors` | `users:import-errors` | liste paginée des erreurs d'un aperçu |
| `POST /users/imports/:importId/confirm` | `users:import-confirm` | enregistrement des lignes valides (tracé) |

Tables (`out/data-contract.md`) : `base.import_previews` (un aperçu par fichier analysé ; une fois confirmé, mémoire permanente « ce fichier a été importé »), `base.import_preview_rows` (lignes retenues en attente de confirmation), `base.import_preview_errors` (erreurs). Ces tables sont communes à toutes les fonctionnalités : une fonctionnalité n'ajoute aucune table pour son import.

## 1. Déroulé observable

1. **Spécification** — `GET /users/imports/specification` → `200 { columns: [{ name, required, description }], maxFileSizeBytes, maxRows, acceptedExtensions }`.
2. **Aperçu** — `POST /users/imports/preview`, corps `multipart/form-data` avec une seule partie fichier nommée `file` → **`200`** `{ importId, fileName, totalRows, validRows, errorRows, expiresAt }`. Rien n'est écrit hors des tables d'import.
3. **Erreurs** — `GET /users/imports/:importId/errors?from=&size=` → `200 { errors: [{ row, column, reason }], total }`.
4. **Confirmation** — `POST /users/imports/:importId/confirm`, sans corps → **`200`** `{ importId, createdCount, skippedCount, fileName }`.

Ordre des contrôles à l'aperçu : authentification et rôle → forme multipart → taille (pendant la réception) → « déjà importé » (empreinte connue dès le dernier octet reçu) → nature réelle du contenu → limites d'archive et liaisons externes → en-tête → lignes. Un fichier piégé est donc refusé avant qu'aucune ligne ne soit lue.

## 2. Règles du mécanisme

### `rule-foundation-import-declared-columns` (user) — La fonctionnalité déclare ses colonnes, le socle fait le reste
Une fonctionnalité qui veut un import déclare uniquement : sa clé (nom de la fonctionnalité), ses colonnes attendues (nom, obligatoire ou non, description française, règle de validation de chaque cellule renvoyant une valeur normalisée ou une raison en français), éventuellement une clé d'unicité dans le fichier, des contrôles groupés contre la base, l'enregistrement d'un lot de lignes valides, si ses lignes sont rattachées à un périmètre, et les rôles autorisés sur ses routes. Tout le reste est fourni par le socle : réception, limites, sécurité, lecture en flux, aperçu, liste des erreurs, détection des doublons, mémoire des fichiers importés, confirmation atomique, trace d'audit, nettoyage. La route de spécification liste les colonnes déclarées. Détails : `90-capacites-pour-le-metier.md`.

### `rule-foundation-import-formats` (user) — Formats `.xlsx` et `.csv`
- Seuls `.xlsx` et `.csv` sont acceptés (`acceptedExtensions` = `[".xlsx", ".csv"]`), extension insensible à la casse (`.XLSX` accepté). `.pdf`, `.txt`, sans extension, `.xls`, `.xlsm`, `.ods` : `400 import.invalid_file_type`.
- CSV : séparateur `,` ou `;` détecté sur la ligne d'en-tête (celui qui apparaît le plus hors guillemets, `;` en cas d'égalité) ; marque d'ordre d'octets UTF-8 tolérée ; fins de ligne CRLF ou LF ; guillemets RFC 4180 (guillemets doublés, retours à la ligne dans un champ entre guillemets).
- Forme de l'envoi : corps non multipart, partie `file` absente, deux fichiers, fichier envoyé sous un autre nom de champ, champ texte de plus de 1 Kio : `400 api.validation.incoming_failed`.
- Nom de fichier retenu (`fileName`) : nom de base seulement (`../../etc/passwd.csv` → `passwd.csv`), caractères de contrôle et nuls remplacés par une espace (jamais une erreur), rogné, coupé à 255 caractères en conservant l'extension ; vide → `fichier.<ext>`.
- Le sélecteur du studio est limité à `.xlsx,.csv`.

### `rule-foundation-import-content-sniffing` (inferred) — La nature du fichier est jugée sur son contenu
L'extension doit correspondre au contenu ; le nom et le type MIME déclarés ne suffisent pas.
- `.xlsx` : une archive ZIP contenant la description des types de contenu et une partie classeur.
- `.csv` : texte UTF-8 valide (BOM toléré), sans octet nul, et qui n'est pas une archive ZIP, un document OLE ni un PDF.
Répondent `400 import.invalid_file_type` : PDF renommé, texte renommé en `.xlsx`, classeur renommé en `.csv`, gzip renommé en `.csv`, classeur tronqué ou corrompu, document OLE (ancien `.xls`) renommé en `.xlsx`, CSV avec octet nul ou UTF-8 invalide, fichier de zéro octet, ZIP sans classeur, CSV sans aucune ligne d'en-tête. Un classeur protégé par mot de passe (entrée chiffrée) est refusé (`import.invalid_file_type` ou `import.unsafe_archive`, voir Q-IMPORT-03). Des octets aléatoires ne produisent jamais de 500.

### `rule-foundation-import-trapped-files-refused` (user) — Fichiers piégés refusés avec un message clair
Archive malveillante, liaisons ou formules externes, taille excessive, nombre de lignes excessif sont refusés avec le code dédié (400 ou 413, jamais 500), **sans rien conserver** (aucune ligne d'aperçu, aucun fichier temporaire). Le studio affiche un message clair en français pour chaque code (`70-ecrans.md`).

### `rule-foundation-import-archive-limits` (inferred) — Limites d'archive
Un `.xlsx` est refusé avec `400 import.unsafe_archive` si :
- il contient plus de 1 000 entrées ;
- un nom d'entrée est absolu, contient `..`, une barre oblique inverse, un octet nul, dépasse 255 caractères, ou duplique un autre nom (sans tenir compte de la casse) ;
- il utilise le format ZIP64 ou contient une entrée chiffrée (voir Q-IMPORT-03) ;
- la taille décompressée totale déclarée dépasse 1 Gio, ou une entrée de plus de 1 Mio décompressée a un taux de compression supérieur à 100:1 (bombe de décompression) ;
- les octets **réellement** décompressés (comptés pendant la décompression, les tailles déclarées pouvant mentir) dépassent la taille déclarée de l'entrée ou 1 Gio au total ;
- il contient du code de macro ou toute autre archive ou binaire imbriqué ;
- une partie XML contient une déclaration `<!DOCTYPE` ou `<!ENTITY` (bombe d'entités).

### `rule-foundation-import-external-links-refused` (inferred) — Liaisons et formules externes refusées
Un `.xlsx` est refusé avec `400 import.external_links` s'il contient : une partie de liaisons externes, des connexions de données ou tables de requête, des objets incorporés (OLE), une relation de cible externe dont le type n'est pas un lien hypertexte, ou une formule qui référence un autre classeur (`[1]Feuil1!A1`, `'C:\x\[a.xlsx]S'!A1`), une URL ou un chemin réseau, ou un échange dynamique (`DDE(`, `cmd|' /c calc'!A1`). Sont **acceptés** : les liens hypertextes (jamais suivis) et les formules internes ordinaires, dont seule la **valeur en cache** est lue (une formule n'est jamais évaluée). Dans un `.csv`, un texte ressemblant à une formule est du texte ordinaire.

### `rule-foundation-import-limits` (inferred) — Limites
Exposées par la route de spécification :
- `maxFileSizeBytes` = **104 857 600** (100 Mio) : au-delà, `413 import.file_too_large` (un fichier de 100 Mio + 1 octet est refusé) ; contrôlé **pendant la réception** ; un `Content-Length` déclaré supérieur à la limite + 1 Mio (par exemple 5 Gio annoncés sans corps) est refusé en `413` immédiatement, sans rien lire ; au-delà de la limite le reste du corps est ignoré et la connexion coupée au plus tard au double de la limite.
- `maxRows` = **1 000 000** lignes de données (lignes non vides après l'en-tête) : la ligne 1 000 001 provoque `400 import.too_many_rows`.
- En-tête valide sans aucune ligne de données : `400 import.empty_file`.

Limites internes : 1 000 caractères conservés par cellule (une cellule plus longue est en erreur « Valeur trop longue (1 000 caractères au maximum). »), 1 000 colonnes lues par ligne, aperçu valable 2 heures.

### `rule-foundation-import-header-matching` (inferred) — Lecture de l'en-tête
- L'en-tête est la **ligne 1** de la **première feuille** du classeur (ordre du classeur, masquée ou non), ou le premier enregistrement du CSV ; les autres feuilles sont ignorées.
- Noms comparés après rognage et sans tenir compte de la casse (`" EMAIL "` = `email`) ; `e-mail` n'est **pas** `email`.
- Colonnes dans n'importe quel ordre ; colonnes en trop ignorées ; en-tête répété : sa première occurrence est utilisée.
- Colonne obligatoire absente, ou première ligne vide : `400 import.missing_columns`.

### `rule-foundation-import-cell-normalisation` (inferred) — Lecture des cellules
- Chaque cellule est lue comme du texte, rognée ; une cellule vide ou blanche est « absente ».
- Nombres, booléens (`TRUE` / `FALSE`) et dates : le texte de la valeur en cache ; formule : sa valeur en cache ; cellule en erreur (`#REF!`, `#N/A`) : son texte, qui échoue à la validation de sa colonne.
- Les lignes entièrement vides sont ignorées (non comptées) mais **gardent leur numéro** : `row` est toujours le numéro de ligne affiché par un tableur (en-tête = ligne 1), en `.xlsx` comme en `.csv` (une erreur après trois lignes vides signale le vrai numéro).

### `rule-foundation-import-two-steps` (user) — Deux temps : aperçu puis confirmation
- L'aperçu n'écrit **aucune** donnée métier : les tables cibles (pour les comptes : `users`, `credentials`, `group_users`, `groups`) sont identiques avant et après, y compris pour un fichier refusé ; seul un état temporaire est conservé (ligne `base.import_previews` au statut `previewed`, expirant environ 2 heures plus tard).
- La liste des erreurs et la spécification n'écrivent rien.
- La confirmation est la **seule** opération qui écrit des données métier.
- Côté studio, aucun appel de confirmation n'a lieu avant le clic explicite.

### `rule-foundation-import-preview-content` (user) — Contenu de l'aperçu
- `totalRows` = `validRows` + `errorRows` (lignes de données non vides) ; `errorRows` compte des **lignes** (une ligne compte une fois quel que soit son nombre d'erreurs) ; `importId` identifie l'aperçu ; `fileName` est le nom retenu ; `expiresAt` est la fin de validité.
- Liste des erreurs : une entrée par (ligne, colonne fautive) avec `row` (≥ 2), `column` (nom de colonne déclaré, 1 à 100 caractères), `reason` (texte français, 1 à 500 caractères) ; une ligne à plusieurs colonnes fautives donne plusieurs entrées ; tri par ligne croissante puis dans l'ordre des colonnes déclarées ; `total` = nombre d'**entrées** (pas de lignes).

### `rule-foundation-import-errors-paginated` (inferred) — Erreurs paginées
`from` de 0 à 2147483647 (défaut 0), `size` de 1 à 100 (défaut 10), au plus 100 entrées par page. 1 000 erreurs se lisent en 10 pages sans trou ni doublon ; `from=2147483647` donne une page vide. `400 api.validation.incoming_failed` : `size` 0, 101, `abc`, `1.5` ; `from` −1, 2147483648, `abc` ; paramètre répété ; caractère nul ; `importId` mal formé.

### `rule-foundation-import-in-file-duplicates` (inferred) — Doublons dans le fichier
Quand la fonctionnalité déclare une clé d'unicité, la **première** ligne qui porte une valeur de clé reste valide pour cette clé et les suivantes sont en erreur, que la première soit par ailleurs valide ou non (une première ligne au rôle invalide reste « la première » ; la suivante est en erreur de doublon). Valable sur 100 000 doublons. Pour les comptes, la clé est l'e-mail exact (deux casses différentes = deux lignes valides) ; raison : « Adresse déjà présente à la ligne {N} du fichier : seule la première occurrence est retenue. ».

### `rule-foundation-import-reason-texts` (inferred) — Raisons en français, sans fuite
Chaque `reason` est une phrase française d'au plus 500 caractères, qui contient au plus la valeur fautive, débarrassée des caractères de contrôle et coupée à 100 caractères avec « … ». Jamais de pile d'appel, de requête SQL, de chemin de fichier ni de donnée d'un autre compte au-delà de la valeur de la cellule. Une adresse trop longue n'est pas recopiée.

### `rule-foundation-import-no-double` (user) — Un fichier n'est pas importé deux fois
- Un fichier dont l'empreinte (SHA-256 des octets reçus) a déjà été **confirmée** pour la même fonctionnalité est refusé avec `409 import.already_imported`, à l'aperçu comme à la confirmation, même renvoyé sous un autre nom ou par un autre administrateur.
- Un aperçu seul ne bloque rien : deux aperçus du même fichier sans confirmation répondent `200` tous deux.
- « Même fichier » = mêmes octets : un octet modifié, ou le même contenu dans l'autre format, est un autre fichier (`200`).
- Une seconde confirmation du même aperçu, ou la confirmation d'un second aperçu d'un fichier déjà confirmé : `409`, rien n'est créé.
- Deux confirmations **simultanées** (du même aperçu, ou de deux aperçus du même fichier) : exactement un `200` et un `409`, les lignes ne sont créées qu'une fois. La garantie tient sous concurrence au niveau de la base (unicité sur la fonctionnalité et l'empreinte des aperçus confirmés).
- La mémoire est **par fonctionnalité** : un fichier confirmé pour une fonctionnalité reste importable pour une autre.
- Pas de forçage dans cette version.

### `rule-foundation-import-preview-expires` (inferred) — Aperçu temporaire
Un aperçu vit 2 heures (`expiresAt` ≈ création + 2 h). Un aperçu expiré, inconnu ou encore en cours d'analyse répond la même `404 import.preview_not_found` sur la liste des erreurs et la confirmation. Les aperçus expirés non confirmés (y compris ceux restés « en cours d'analyse » après un arrêt brutal) sont supprimés avec leurs lignes et erreurs, au plus tard lors d'un aperçu suivant (purge progressive, une vingtaine par appel). Côté studio, un aperçu expiré renvoie au dépôt avec un message explicite.

### `rule-foundation-import-preview-owner` (inferred) — Aperçu privé à son créateur
Seul l'administrateur qui a créé un aperçu peut lister ses erreurs ou le confirmer. Un autre administrateur reçoit **la même** réponse `404 import.preview_not_found` que pour un identifiant inconnu (corps identique à l'octet près, EXI-PLAT-02), rien n'est créé, et le créateur peut toujours confirmer ensuite. Ces deux cas sont les tests « cross-owner » de `permissions.yaml`.

### `rule-foundation-import-confirm-valid-only` (user) — Seules les lignes valides sont enregistrées
La confirmation n'enregistre que les lignes valides de l'aperçu ; les lignes en erreur ne sont jamais écrites ni comptées dans `skippedCount`. `createdCount` = lignes écrites. Un aperçu sans ligne valide peut être confirmé par l'API (`200`, `createdCount` 0, tracé, empreinte mémorisée) ; le studio, lui, l'interdit (`rule-foundation-import-confirm-needs-valid-rows`).

### `rule-foundation-import-confirm-revalidates` (inferred) — Revalidation à la confirmation
L'état peut changer entre l'aperçu et la confirmation. Chaque lot est revérifié à l'enregistrement : une ligne devenue impossible pour une raison ordinaire (compte créé entre-temps avec le même e-mail, groupe disparu) n'est pas écrite et est comptée dans `skippedCount`, sans faire échouer l'import ni laisser de compte sans ses appartenances. En revanche, un refus d'autorisation (périmètre devenu inaccessible pour une fonctionnalité à périmètres) arrête toute la confirmation avec le `403` habituel (`scopes.access_denied` / `scopes.read_only`) et annule tout.

### `rule-foundation-import-confirm-atomic` (inferred) — Confirmation atomique
La confirmation forme une seule transaction avec sa trace d'audit : lignes métier, nettoyage des lignes en attente, passage au statut « confirmé » (donc mémoire de l'empreinte) et entrée de journal sont validés ensemble ou pas du tout. Après un échec (par exemple une insertion refusée par la base au milieu), il n'existe ni compte, ni secret, ni entrée de journal, l'aperçu reste `previewed` et peut être confirmé à nouveau avant expiration. Après succès : lignes en attente et erreurs supprimées ; la ligne `base.import_previews` est conservée **définitivement** au statut `confirmed` avec `created_count`, `skipped_count` et `confirmed_at`.

### `rule-foundation-import-large-files` (user) — Très gros fichiers, mémoire bornée
Des fichiers de plusieurs centaines de milliers de lignes s'importent sans erreur 500 ni dépassement mémoire : la recette analyse un `.csv` de 300 000 lignes et un `.xlsx` de 200 000 lignes avec 5 % d'erreurs (comptes exacts, erreurs paginées, confirmation, `409` au renvoi) et un fichier de 100 000 doublons. Garanties :
- le fichier n'est **jamais** chargé entièrement en mémoire, ni à la réception, ni à la lecture : il est reçu en flux vers un stockage temporaire, puis lu en flux, ligne par ligne, avec contre-pression ;
- les lignes sont traitées par lots (de l'ordre de 1 000) et le résultat de l'analyse est conservé en base, pas en mémoire ; la mémoire du serveur reste à peu près constante quelle que soit la taille du fichier ;
- une analyse ne tient pas de verrou durable sur les tables métier (elle ne fait que les lire) ;
- l'analyse est une seule requête synchrone qui peut durer plusieurs minutes ; le studio prévient l'utilisateur.
Ordre de grandeur visé : 500 000 lignes analysées en moins de 2 minutes.

### `rule-foundation-import-temp-cleanup` (inferred) — Rien ne traîne
Le fichier temporaire reçu est supprimé dans tous les cas (succès, refus, abandon par le client, redémarrage : les fichiers temporaires anciens sont supprimés au démarrage). Une analyse refusée ou interrompue supprime son aperçu (aucune ligne d'aperçu ne subsiste). Si le client ferme la connexion pendant l'analyse, celle-ci s'arrête et rien n'est conservé.

### `rule-foundation-import-preview-not-traced` (inferred) — L'aperçu n'est pas tracé
L'analyse (aperçu) n'écrit que de l'état technique temporaire et ne laisse aucune entrée au journal. C'est une exemption **par nature** (toute route d'aperçu d'import), pas une liste de chemins ; en contrepartie, toute fonctionnalité qui a une route d'aperçu doit avoir une route de confirmation tracée, et un contrôle avant livraison le vérifie.

### `rule-foundation-import-audited` (user) — L'import laisse une trace
Seule la confirmation est tracée, avec **une** entrée par import : action `users:import-confirm`, type d'objet `Import de comptes`, `objectId` = `importId`, `scope` = `null`, résumé « Import de {n} compte(s) depuis « {fileName} » » (« Import de 2 comptes depuis « comptes.xlsx » », « Import de 1 compte depuis « un.csv » »), auteur = l'appelant. Aucune entrée pour une confirmation refusée (401, 403, 404, 409). Ni e-mail, ni contenu de cellule, ni empreinte dans le journal. Le dialogue de confirmation du studio mentionne la trace.

### `rule-foundation-import-respects-scopes` (user) — L'import respecte les périmètres
Pour une fonctionnalité dont les lignes sont rattachées à un périmètre :
- avant toute analyse, un administrateur limité à la lecture seule ou à aucun accès sur la route reçoit le `403` habituel (`scopes.read_only` / `scopes.access_denied`), avant qu'aucun octet ne soit analysé ;
- à l'aperçu, une ligne visant un périmètre inconnu **ou** non atteint est une ligne **en erreur**, avec la même raison dans les deux cas (« Périmètre inconnu ou non autorisé : « {v} ». ») pour ne pas révéler l'existence des périmètres ;
- les contrôles de l'aperçu ne lisent que des lignes de périmètres atteints ;
- à la confirmation, les écritures suivent la règle par ligne (`rule-foundation-scope-row-filter`) ; un périmètre devenu inaccessible entre-temps annule toute la confirmation en `403` (`rule-foundation-import-confirm-revalidates`).
L'import de comptes n'est pas rattaché à un périmètre (seul le rôle `admin` est exigé). Non observable par la recette ; à prouver par les tests propres de la réécriture.

## 3. Application : import de comptes

### `rule-foundation-import-users-admin-only` (user) — Réservé aux administrateurs
Les quatre routes répondent `403 security.access_denied` à un utilisateur ordinaire et `401` à un visiteur ou à un jeton invalide. Le rôle est vérifié avant les paramètres, et **aucun octet du corps n'est lu** pour un appelant refusé (un corps annoncé de 5 Gio reçoit `401`/`403` immédiatement). Le point d'entrée du studio n'existe que sur l'écran d'administration des utilisateurs.

### `rule-foundation-import-users-columns` (user) — Colonnes `email`, `role`, `groupes`
La spécification renvoie, dans cet ordre :

| `name` | `required` | `description` |
|---|---|---|
| `email` | `true` | « Adresse e-mail du compte (254 caractères maximum). » |
| `role` | `true` | « Rôle du compte : user ou admin. » |
| `groupes` | `false` | « Noms de groupes existants séparés par « ; ». Laisser vide pour aucun groupe. » |

avec `maxFileSizeBytes` = 104857600, `maxRows` = 1000000, `acceptedExtensions` = `[".xlsx", ".csv"]`. La colonne facultative peut être absente ou vide.

### `rule-foundation-import-users-email` (inferred) — Colonne `email`
Valeur rognée, de 1 à 254 caractères (254 valide, 255 en erreur), adresse e-mail syntaxiquement valide (même critère que `POST /users`), **conservée telle que saisie** (pas de mise en minuscules : `A@x.fr` et `a@x.fr` sont deux comptes, cohérent avec l'unicité exacte et la connexion exacte). Une adresse déjà utilisée par un compte existant est en erreur ; une adresse répétée dans le fichier suit `rule-foundation-import-in-file-duplicates`.

### `rule-foundation-import-users-role` (inferred) — Colonne `role`
Valeur rognée strictement égale à `user` ou `admin` (en minuscules) : ` admin ` est valide ; `Admin`, `ADMIN`, toute autre valeur ou une cellule vide sont en erreur. Pas de valeur par défaut.

### `rule-foundation-import-users-groups` (inferred) — Colonne `groupes`
Cellule découpée sur `;`, chaque nom rogné, segments vides ignorés (`a;;b; `) ; cellule vide = aucun groupe. Les noms se comparent sans tenir compte de la casse (`équipe a` trouve `Équipe A`). Noms inconnus : **une seule** entrée pour la colonne, citant au plus 5 noms suivis de « … » ; même groupe cité deux fois (quelle que soit la casse) : une entrée ; au plus 100 groupes par cellule (100 acceptés, 101 en erreur). À la confirmation, les appartenances sont écrites ; un groupe disparu entre-temps rend la ligne ignorée (`skippedCount`).

### Raisons exactes de l'import de comptes
`{v}` = valeur fautive nettoyée et coupée ; `{N}` = numéro de la première ligne.

| Colonne | Cause | Raison |
|---|---|---|
| `email` | absente | « L'adresse e-mail est obligatoire. » |
| `email` | invalide | « « {v} » n'est pas une adresse e-mail valide. » |
| `email` | plus de 254 caractères | « L'adresse e-mail dépasse 254 caractères. » (valeur non recopiée) |
| `email` | déjà utilisée | « Un compte existe déjà avec l'adresse « {v} ». » |
| `email` | répétée dans le fichier | « Adresse déjà présente à la ligne {N} du fichier : seule la première occurrence est retenue. » |
| `role` | absent | « Le rôle est obligatoire (user ou admin). » |
| `role` | autre valeur | « Rôle « {v} » inconnu : attendu « user » ou « admin ». » |
| `groupes` | un nom inconnu | « Groupe inexistant : « {v} ». » |
| `groupes` | plusieurs noms inconnus | « Groupes inexistants : « {v1} », « {v2} »… » (5 noms au plus, « … » au-delà) |
| `groupes` | cité deux fois | « Le groupe « {v} » est cité plusieurs fois. » |
| `groupes` | plus de 100 noms | « Trop de groupes dans la cellule (100 au maximum). » |
| toute colonne | cellule de plus de 1 000 caractères | « Valeur trop longue (1 000 caractères au maximum). » |

### `rule-foundation-import-users-no-password` (inferred) — Les comptes importés ne peuvent pas encore se connecter
Le fichier ne contient pas de mot de passe et aucun n'est inventé ni communiqué. Chaque compte importé reçoit une ligne `base.credentials` (`type = 'token'`) contenant l'empreinte bcrypt (coût 10) d'un secret aléatoire que personne ne connaît. Le compte existe (liste, rôle, groupes, journal) mais la connexion répond `401 security.invalid_credentials` (et non `404`) quel que soit le mot de passe essayé, pour un compte `user` comme `admin`. Aucun secret lisible n'est stocké. Choix en attente d'arbitrage (Q-IMPORT-01) : une fonctionnalité future de définition de mot de passe remplacera ce secret.

À la confirmation, rôle et e-mail sont écrits exactement tels que validés.

## 4. Règles d'écran de l'import
`rule-foundation-import-no-client-parsing`, `rule-foundation-import-client-precheck`, `rule-foundation-import-confirm-needs-valid-rows` et `rule-foundation-import-cancel-analysis` sont décrites dans `70-ecrans.md` (§ Importer des utilisateurs).

## 5. Hors périmètre de cette version
Export des erreurs, modèle de fichier à télécharger, historique des imports, forçage d'un fichier déjà importé, traitement en arrière-plan avec progression, limite du nombre d'analyses simultanées.
