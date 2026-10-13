# Demande à l'API : imports des cinq fichiers tableur, lettrage et rapport d'écarts

Écran demandeur : Imports (`imports-page-implementation-plan.md`). Besoin : déposer chacun des fichiers Créances, Paiements, Litiges, Interlocuteurs et Pièces, voir l'aperçu, les erreurs et le rapport d'écarts avec l'import précédent du même type, donner le feu vert (confirmation), connaître la fraîcheur du relevé bancaire. Le sixième fichier (Politique) a son propre parcours : `politiques-api-modification-request.md`.

Les imports reprennent le mécanisme du socle (`specifications/socle/60-import.md` : aperçu sans écriture métier conservé 2 heures et privé à son créateur, confirmation atomique et tracée, doublon de fichier refusé, fichiers piégés refusés, limites 100 Mio / 1 000 000 lignes, lecture en flux, erreurs paginées). Les dossiers `api/src/features/imports/**` étant gelés, la fonctionnalité `recovery-imports` déclare ses définitions d'import et ses routes dans un nouveau dossier, sur le modèle de `users-import.*`.

## Opérations
Toutes les routes : garde de profil `supervisor` (voir `profils-api-modification-request.md`). `{type}` est l'un de `receivables`, `payments`, `disputes`, `contacts`, `documents` (Créances, Paiements, Litiges, Interlocuteurs, Pièces). `{importId}` uuid. Les montants de l'API sont des entiers en centimes (`...Cents`), jamais des flottants. Toute date de l'API est `AAAA-MM-JJ` (`format: date`) ; tout instant est un date-heure ISO.

| Méthode et chemin | Action déclarée | Rôles | Entrée (bornes comprises) | Réponses (codes et formes) |
|---|---|---|---|---|
| `GET /recovery-imports/{type}/specification` | `recovery-imports:specification` | profil `supervisor` | `type` énuméré | `200 RecoveryImportSpecificationDto` = `ImportSpecificationDto` (`columns`, `maxFileSizeBytes` 104857600, `maxRows` 1000000, `acceptedExtensions` `[".xlsx", ".csv"]`) + `refusedOnFirstError: boolean` + `extraFields: [{ name: string(1..50), label: string(1..100), required: boolean, description: string(1..500) }]` (au plus 5) ; `400` type inconnu |
| `POST /recovery-imports/{type}/preview` | `recovery-imports:preview` | profil `supervisor` | `multipart/form-data` : partie `file` (.xlsx ou .csv) ; pour `receivables` une partie texte `controlTotal` obligatoire (voir `rule-recouvrement-receivables-control-total`) ; toute autre partie refusée | `200 RecoveryImportPreviewDto` = `ImportPreviewDto` (`importId`, `fileName`, `totalRows`, `validRows`, `errorRows`) + `accepted: boolean` + `computedTotalCents: integer \| null` + `controlTotalCents: integer \| null` ; `400 import.*` comme `POST /users/imports/preview` (`invalid_file_type`, `unsafe_archive`, `external_links`, `too_many_rows`, `empty_file`, `missing_columns`, `aborted`) ; `400 imports.control_total_required` ; `400 imports.control_total_invalid` ; `409 import.already_imported` ; `413 import.file_too_large` ; `401` ; `403` |
| `GET /recovery-imports/{type}/{importId}/errors` | `recovery-imports:errors` | profil `supervisor` | `from`, `size` | `200 ImportErrorsListResponseDto` (`items: { row, column, reason }[]`, `total`) ; `404 import.preview_not_found` |
| `GET /recovery-imports/{type}/{importId}/report` | `recovery-imports:report` | profil `supervisor` | — | `200 ImportReportDto` ; `404 import.preview_not_found` (aperçu inconnu, d'un autre superviseur, expiré ou consommé) ou `404 repository.not_found` (import confirmé inconnu) |
| `GET /recovery-imports/{type}/{importId}/report/items` | `recovery-imports:report-items` | profil `supervisor` | `category` : `new` \| `settled` \| `modified` \| `removed` ; `from`, `size` | `200 { items: ImportReportItemDto[], total }` triés par clé ; `404` comme ci-dessus |
| `POST /recovery-imports/{type}/{importId}/confirm` | `recovery-imports:confirm` | profil `supervisor` | — (aucun corps) | `200 RecoveryImportConfirmDto` = `{ createdCount, skippedCount, effects: { label: string(1..200), count: integer }[] }` (au plus 20 effets : dossiers créés, soldés, paiements affectés, paiements non affectés, éléments de file ouverts…) ; `404 import.preview_not_found` ; `409 import.already_imported` ; `409 imports.file_refused` (l'aperçu compte une erreur pour un type refusé en entier) ; `409 imports.stale_extraction` (un cliché plus récent a été confirmé entre-temps) |
| `GET /recovery-imports/history` | `recovery-imports:history` | profil `supervisor` | `type` facultatif ; `from`, `size` | `200 { items: RecoveryImportHistoryItemDto[], total }`, du plus récent au plus ancien |
| `GET /recovery-imports/status` | `recovery-imports:status` | profil `supervisor` | — | `200 RecoveryImportStatusDto` |

DTO :
- `ImportReportDto` = `{ type, importId, previous: { importId, fileName, confirmedAt } \| null, categories: { code: 'new' \| 'settled' \| 'modified' \| 'removed', label: string(1..100), rows: integer, cases: integer }[], notes: { code: string(1..50), label: string(1..200), count: integer }[] }` (libellés français rédigés par l'API, affichés tels quels).
- `ImportReportItemDto` = `{ key: string(1..200), debtorId: string(1..50) \| null, detail: string(1..300) }` (clé naturelle de la ligne ; détail français).
- `RecoveryImportHistoryItemDto` = `{ importId, type, fileName, confirmedAt, confirmedBy: { id, email }, totalRows, createdCount, skippedCount }`.
- `RecoveryImportStatusDto` = `{ statement: { lastStatementDate: date \| null, maxAgeDays: integer \| null, fresh: boolean }, receivablesExtractionDate: date \| null, lastConfirmed: { type, confirmedAt, fileName }[] }`. `fresh` est vrai si un relevé confirmé existe et si `aujourd'hui − lastStatementDate ≤ maxAgeDays` ; sans politique active `maxAgeDays` est `null` et `fresh` faux.

Pas de route de suppression d'aperçu : un aperçu expire au bout de 2 heures et est purgé par l'aperçu suivant, comme le socle.

Trace d'audit : `POST .../confirm` est tracée (action `recovery-imports:confirm`, types d'objet « Import de créances », « Import de paiements », « Import de litiges », « Import d'interlocuteurs », « Import de pièces » ; identifiant = `importId` ; résumé français sans valeur de cellule, par exemple « Import de créances confirmé : 1 250 lignes, 38 dossiers nouveaux, 12 soldés. »). L'aperçu n'est pas tracé (exempté, comme celui du socle).

## Format pivot des cinq fichiers
Les noms de colonnes sont comparés rognés et sans tenir compte de la casse (`rule-foundation-import-header-matching`). Les dates acceptent `AAAA-MM-JJ` et `JJ/MM/AAAA` (cellule date d'un classeur comprise). Les montants acceptent le point ou la virgule décimale, les espaces comme séparateur de milliers, au plus deux décimales ; stockés en centimes. Les raisons d'erreur sont en français, bornées à 500 caractères, et citent la valeur fautive avec `echo()`.

### Créances (`receivables`) : photographie complète du portefeuille
| `name` | Obligatoire | Règle |
|---|---|---|
| `type_piece` | oui | `facture` ou `avoir` |
| `numero` | oui | 1 à 50 caractères, sans caractère de contrôle |
| `entite_siren` | oui | SIREN de l'entité créancière, 9 chiffres |
| `debiteur_id` | oui | identifiant client du logiciel de facturation, 1 à 50 caractères |
| `debiteur_nature` | oui | `famille` ou `entreprise` |
| `debiteur_siren` | non | 9 chiffres ; obligatoire pour `entreprise`, vide pour `famille` |
| `payeur` | non | 1 à 100 caractères |
| `montant` | oui | facture : strictement positif ; avoir : strictement négatif ; valeur absolue au plus 10 000 000 000 |
| `solde` | oui | facture : de 0 à `montant` ; avoir : de `montant` à 0 |
| `date_facture` | oui | date |
| `echeance` | oui | date, égale ou postérieure à `date_facture` |
| `segment` | oui | `^[a-z0-9][a-z0-9_-]{0,49}$` |
| `canaux` | non | canaux autorisés parmi `voix`, `courriel_sms`, `courrier`, séparés par « ; » ; vide : aucun canal |
| `date_extraction` | oui | date d'extraction du cliché, identique sur toutes les lignes, pas dans le futur |
| `reference_sortie` | non | 1 à 30 caractères : identifiant stable d'une sortie comptable saisie dans l'outil comptable |

### Paiements (`payments`) : relevé bancaire
`reference` (oui, 1 à 100 caractères), `montant` (oui, strictement positif, au plus 10 000 000 000), `date_paiement` (oui, date, pas dans le futur), `date_releve` (oui, date, identique sur toutes les lignes, pas dans le futur).

### Litiges (`disputes`)
`numero` (oui, numéro de la facture, 1 à 50), `entite_siren` (non, 9 chiffres ; nécessaire si le numéro existe chez plusieurs entités), `motif` (oui, 1 à 500), `responsable` (oui, 1 à 100), `date_ouverture` (oui, date, pas dans le futur).

### Interlocuteurs (`contacts`)
`debiteur_id` (oui), `role` (oui : `comptabilite_fournisseurs`, `acheteur`, `valideur` pour une entreprise ; `payeur` pour une famille), `courriel` (non, au plus 254), `telephone` (non, au plus 30), `adresse_postale` (non, au plus 500).

### Pièces (`documents`)
`numero` (oui), `entite_siren` (non), `type` (oui : `contrat`, `commande`, `preuve_livraison`), `reference` (non, 1 à 100 : référence de la pièce dans l'outil source ; aucun document n'est transmis ni stocké).

## Règles
- `rule-recouvrement-import-pivot-format` (user) : les fichiers suivent le format pivot ci-dessus, indépendant de l'outil d'origine ; chacun passe par l'aperçu, la liste d'erreurs et la confirmation du mécanisme d'import.
- `rule-recouvrement-import-green-light` (user) : la confirmation par un superviseur vaut feu vert ; aucune donnée métier n'est écrite avant elle ; un autre profil reçoit `403 security.access_denied`.
- `rule-recouvrement-import-report` (user) : chaque aperçu produit un rapport d'écarts avec le dernier import confirmé du même type : pour les créances, dossiers nouveaux (débiteur absent du cliché précédent), soldés (présent avant, absent maintenant ou tous soldes nuls) et modifiés (présent des deux côtés, solde, facture ajoutée, retirée ou changée) ; pour les autres types, lignes nouvelles, disparues, modifiées par clé naturelle (paiements : `reference` ; litiges : entité + numéro ; interlocuteurs : débiteur + rôle + coordonnées ; pièces : entité + numéro + type). Sans import précédent, `previous` est `null` et tout est nouveau. Le rapport est calculé sans écriture métier.
- `rule-recouvrement-import-refuse-whole` (user) : les fichiers Créances et Paiements sont refusés en entier dès la première erreur : l'analyse s'arrête à la première erreur (`errorRows` = 1, une seule entrée d'erreur), `accepted` est faux et la confirmation répond `409 imports.file_refused`. Une erreur qui porte sur le fichier entier (total de contrôle, date d'extraction, relevé trop ancien) est attribuée à la ligne 1 (en-tête) et à la colonne concernée. Les trois autres types sont importés par les seules lignes valides, comme le socle (`rule-foundation-import-confirm-valid-only`).
- `rule-recouvrement-money-cents` (inferred) : tout montant de l'API est un entier en centimes, avec `minimum` et `maximum` déclarés au contrat (au plus 10 000 000 000 en valeur absolue pour un fichier) ; les cellules sont converties sans arrondi (plus de deux décimales : erreur).
- `rule-recouvrement-receivables-duplicate-number` (user) : un couple (`entite_siren`, `numero`) en double dans le fichier est une erreur (« Numéro déjà présent à la ligne N pour cette entité. »).
- `rule-recouvrement-receivables-control-total` (user) : le superviseur saisit, à l'import, le total de contrôle (solde du compte clients à la date d'extraction) dans la partie `controlTotal`, texte `^-?[0-9 ]{1,15}([.,][0-9]{1,2})?$` (espaces ignorés) converti en centimes ; absent `400 imports.control_total_required`, illisible `400 imports.control_total_invalid`. La somme des `solde` du fichier (avoirs négatifs) différente du total saisi à un centime près (écart nul exigé) est l'erreur bloquante de la ligne 1, colonne `solde` : « Le total des soldes (X) diffère du total de contrôle saisi (Y). ». `computedTotalCents` et `controlTotalCents` sont rendus par l'aperçu.
- `rule-recouvrement-receivables-extraction-date` (inferred) : `date_extraction` identique sur toutes les lignes ; antérieure à celle du dernier cliché confirmé : erreur (la confirmation concurrente est aussi contrôlée : `409 imports.stale_extraction`).
- `rule-recouvrement-debtor-siren` (user) : le SIREN du débiteur est obligatoire pour une entreprise (9 chiffres) et absent pour une famille ; le SIREN de l'entité créancière est obligatoire sur chaque pièce.
- `rule-recouvrement-receivables-case-grouping` (inferred) : un dossier regroupe les factures et avoirs ouverts d'un même `debiteur_id` ; toutes les lignes d'un débiteur portent la même nature, le même SIREN de débiteur et le même segment, sinon erreur (« Le segment diffère de celui de la ligne N pour ce débiteur. ») ; le segment du dossier est celui de ses lignes.
- `rule-recouvrement-receivables-snapshot` (inferred) : la confirmation remplace le portefeuille par le cliché : factures créées, soldes mis à jour, factures absentes du cliché clôturées (solde nul), dossiers créés, soldés ou rouverts (`referentiel-etats-et-transitions.md`), puis lettrage des paiements postérieurs rejoué, constat des sorties comptables, évaluation de la prescription ; le tout atomique avec la trace.
- `rule-recouvrement-payments-columns` (inferred) : colonnes de Paiements ci-dessus ; une `reference` en double dans le fichier est une erreur ; une référence déjà confirmée dans un relevé précédent est ignorée à la confirmation (`skippedCount`).
- `rule-recouvrement-statement-fresh` (user) : un relevé dont `date_releve` est plus ancienne que `aujourd'hui − fraîcheur maximale de la politique active` est refusé en entier (erreur de la ligne 1, colonne `date_releve` : « Relevé trop ancien : date du relevé <date>, fraîcheur maximale <n> jours. »). Tant qu'aucun relevé confirmé n'est frais (`GET /recovery-imports/status` : `fresh` faux), aucune offre n'est rendue aux agents et aucun ordre d'envoi n'est prévu (`outils-agents`, `lot-du-jour`). Sans politique active, le contrôle de fraîcheur est sauté à l'import et `fresh` reste faux.
- `rule-recouvrement-lettrage-after-extraction` (user) : seuls les paiements dont `date_paiement` est strictement postérieure à la `date_extraction` du dernier cliché confirmé sont appliqués ; les autres sont enregistrés comme « déjà dans les soldes » sans effet.
- `rule-recouvrement-lettrage-order` (user) : un paiement appliqué est affecté dans cet ordre : (1) sa référence contient le numéro d'une seule facture ouverte (correspondance sur mot entier, sans tenir compte de la casse) ; (2) sinon son montant égale le solde d'une seule facture ouverte du portefeuille ; (3) sinon il est non affecté. Les avoirs ne reçoivent pas de paiement.
- `rule-recouvrement-lettrage-excess` (user) : si le montant dépasse le solde de la facture trouvée à l'étape 1, la facture est soldée à hauteur de son solde et l'excédent devient un paiement non affecté (nouvelle ligne rattachée au paiement d'origine).
- `rule-recouvrement-unassigned-payment-freeze` (user) : un paiement non affecté ouvre un élément de file `unassigned_payment` et gèle (gel `unassigned_payment`) les dossiers dont une facture ouverte ou dont le solde total égale son montant, jusqu'à son affectation par le superviseur. Le lettrage est rejoué à chaque confirmation de Créances ou de Paiements ; une affectation du superviseur est conservée.
- `rule-recouvrement-disputes-import-freeze` (user) : chaque ligne valide du fichier Litiges ouvre un litige (origine `import`) et gèle la facture ; facture inconnue : erreur de ligne ; numéro ambigu entre entités sans `entite_siren` : erreur de ligne.
- `rule-recouvrement-disputes-import-additive` (inferred) : le fichier Litiges ajoute des litiges et n'en clôt jamais ; une facture déjà en litige ouvert est comptée dans `skippedCount`. Seul le service litiges clôt un litige.
- `rule-recouvrement-contacts-columns` (inferred) : colonnes d'Interlocuteurs ci-dessus ; un rôle incompatible avec la nature du débiteur est une erreur de ligne ; un débiteur inconnu est une erreur de ligne ; une ligne sans aucune coordonnée est une erreur ; une ligne identique (débiteur, rôle, trois coordonnées) répétée est un doublon. La confirmation remplace l'ensemble des interlocuteurs en conservant l'identifiant de ceux dont (débiteur, rôle, coordonnées) sont inchangés.
- `rule-recouvrement-contact-invalid-suspends-channel` (user) : une coordonnée de format invalide n'est pas une erreur de ligne mais suspend le canal concerné pour cet interlocuteur : `courriel` invalide (syntaxe de l'adresse de `POST /users`) suspend `email_sms` ; `telephone` invalide (après retrait des espaces, points, tirets et parenthèses : `^\+?[0-9]{8,15}$`) suspend `voice` et `email_sms` ; `adresse_postale` invalide (aucune suite de 5 chiffres) suspend `mail`. Une coordonnée vide n'est pas invalide : le canal est seulement indisponible. Un interlocuteur est joignable sur un canal si ce canal n'est pas suspendu et si au moins une coordonnée utile est renseignée (`voice` : téléphone ; `email_sms` : courriel ou téléphone ; `mail` : adresse). Le rapport signale le nombre d'interlocuteurs à canal suspendu (note `suspended_channels`).
- `rule-recouvrement-documents-columns` (inferred) : colonnes de Pièces ci-dessus ; facture inconnue ou numéro ambigu : erreur de ligne ; (facture, type) répété : doublon. La confirmation remplace l'index complet.
- `rule-recouvrement-import-audited` (inferred) : la confirmation est tracée, l'aperçu non ; aucun contenu de cellule, aucune coordonnée, aucun identifiant client n'apparaît dans le résumé.

## Compatibilité
- Opérations du socle (`/users/imports/*`) inchangées. `ImportPreviewDto`, `ImportErrorsListResponseDto` sont réutilisés ; `RecoveryImportSpecificationDto`, `RecoveryImportPreviewDto`, `ImportReportDto`, `ImportReportItemDto`, `RecoveryImportConfirmDto`, `RecoveryImportHistoryItemDto`, `RecoveryImportStatusDto` sont nouveaux.
- L'analyseur multipart du socle (`api/src/features/imports/multipart.ts`, gelé) ne lit que la partie `file` : la partie texte `controlTotal` exige un analyseur propre à la fonctionnalité ou une évolution du socle ; sinon l'agent de fabrication ouvre `OPEN: contract recovery-imports preview: partie controlTotal absente de l'analyseur du socle` dans `DISPUTES.md`.
- Tables nouvelles (clichés de portefeuille, factures, paiements, affectations, litiges, interlocuteurs, pièces, historique) : voir le plan du module ; le contrat de données de la base est étendu par ajout seulement.
- `specifications/permissions.yaml` : une ligne par opération ci-dessus, `allow: []` avec garde de profil.
