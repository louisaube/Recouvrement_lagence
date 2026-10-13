# 90 — Capacités offertes aux fonctionnalités métier

Le socle sera étendu par des fonctionnalités métier (une crèche, un site, des inscriptions…). Ce document dit ce qu'un auteur de fonctionnalité doit pouvoir **déclarer**, et ce que le socle **garantit** en retour. La forme concrète de ces déclarations (syntaxe, emplacement) est libre ; les garanties et contraintes ne le sont pas. Une fonctionnalité métier ne modifie pas le socle : elle s'y branche.

Chaque capacité doit être démontrée par des tests propres à la réécriture, avec une fonctionnalité fictive présente seulement en environnement de test (tables créées par les tests, jamais livrées ; routes sous `/test/`, absentes du contrat ; EXI-PLAT-12), puisque le socle ne livre aucune table métier.

## 1. Déclarer le régime d'accès d'une route

**L'auteur déclare**, pour chaque route : publique, ou authentifiée avec un code d'action `<fonctionnalité>:<verbe>` (unique, stable, en anglais, 1 à 100 caractères) et les rôles admis (`user`, `admin` ou les deux) ; facultativement, l'accès d'un administrateur aux périmètres sur cette route : complet (défaut), lecture seule, ou aucun.

**Le socle garantit** :
- l'authentification (jeton porteur ou cookie de session) et le contrôle de rôle avant tout traitement, toute validation et toute lecture du corps : `401` (visiteur, jeton invalide) et `403 security.access_denied` (rôle non admis) ;
- le **refus par défaut** : une route sans déclaration n'est jamais servie, dans aucun environnement (EXI-PLAT-11), et l'oubli est détecté avant livraison ;
- l'accès aux périmètres de l'appelant (`rule-foundation-admin-scope-access`, `rule-foundation-scope-fail-closed`) est établi pour la durée de la requête ;
- la matrice observée correspond à celle déclarée dans `permissions.yaml` (la fonctionnalité y ajoute ses lignes).

**Contraintes** : une règle de propriété (« seulement son propre objet ») s'exprime par un contrôle qui s'exécute avant la validation des paramètres et avant toute recherche, et qui répond `403` (ou `404` indiscernable si la règle l'exige) sans révéler l'existence de l'objet ; elle est prouvée par des tests « cross-owner » déclarés dans `permissions.yaml`.

## 2. Rattacher une table à un périmètre

**L'auteur déclare** que sa table porte une colonne de code de périmètre (colonne `scope_code`, texte non nul, référence vers `base.scopes(code)`, suppression et modification du code référencé refusées par la base), et qu'elle est accédée par le mécanisme de périmètre du socle.

**Le socle garantit**, sans que la fonctionnalité écrive de filtre (`rule-foundation-scope-row-filter`) :
- lectures (liste, détail, comptage, recherche) limitées aux lignes des périmètres atteints ; une ligne hors périmètre est indiscernable d'une ligne inexistante (`404 repository.not_found`) ;
- modifications et suppressions limitées aux lignes atteintes, unitaires comme en masse ;
- créations et changements de périmètre vers un périmètre non atteint refusés (`403 scopes.access_denied`), rien n'étant écrit ;
- insertion-ou-mise-à-jour qui ne modifie jamais une ligne d'un périmètre non atteint et ne change jamais le code de périmètre par ce biais ;
- appartenances relues à chaque requête (effet immédiat d'un changement de groupe) ;
- utilisateur sans groupe : rien en lecture, tout refusé en écriture (`rule-foundation-user-no-group-no-data`) ;
- administrateur : tout par défaut ; lecture seule (`403 scopes.read_only` à l'écriture) ou aucun accès (lectures vides, `403 scopes.access_denied`) si la route le déclare ; code inconnu → `400`, jamais 500 (`rule-foundation-admin-scope-access`) ;
- hors requête (tâche planifiée, script) : aucune ligne tant que l'accès n'est pas déclaré explicitement pour ce traitement (`rule-foundation-scope-fail-closed`) ;
- la table est refusée au démarrage si elle est déclarée « rattachée » sans colonne de code de périmètre.

**Contraintes** :
- une requête écrite à la main (jointure, agrégat) qui contourne le mécanisme n'est **pas** filtrée automatiquement : son auteur doit y appliquer explicitement la condition de périmètre fournie par le socle ;
- le nom de colonne est imposé (`scope_code`) ; une ligne est rattachée à **un seul** périmètre ;
- pas de notion d'entreprise ou de locataire (`rule-foundation-no-multi-company`).

## 3. Déclarer qu'une route est tracée

**L'auteur déclare**, sur chaque route d'écriture : le libellé français du type d'objet (choisi une fois, jamais renommé), et une description calculée à partir de la requête et du **résultat** de l'action : identifiant de l'objet (1 à 100 caractères), résumé français, code de périmètre visé (ou aucun). Le code d'action est repris du régime d'accès.

**Le socle garantit** (`rule-foundation-audit-declarative-route`, `rule-foundation-audit-trace-content`) :
- une entrée par appel réussi, avec l'auteur (identifiant et e-mail copiés), l'instant à la milliseconde, le code d'action, le type, l'identifiant, le périmètre et le résumé ;
- l'atomicité (`rule-foundation-audit-atomic-with-action`) : l'entrée et les données de l'action sont validées ensemble ou pas du tout, y compris si la description ou la réponse est invalide ; un conflit d'unicité à l'intérieur de l'action reste un `409` propre ;
- la normalisation du résumé (espaces et caractères de contrôle réduits, coupe à 500 caractères avec « … ») et son affichage en texte brut ;
- l'inaltérabilité (`rule-foundation-audit-immutable`, `rule-foundation-audit-db-append-only`) et la survie à la suppression de l'auteur ;
- l'apparition automatique de la nouvelle action et du nouveau type dans l'écran et ses filtres ;
- le contrôle avant livraison : toute route `POST`/`PUT`/`PATCH`/`DELETE` non tracée et non exemptée fait échouer la livraison en la nommant ;
- une route déclarée tracée sans régime authentifié échoue en `500 audit.misconfigured` avant tout traitement ; une description hors bornes annule l'action en `500 audit.invalid_descriptor` (erreurs de construction, à détecter par les tests de la fonctionnalité).

**Contraintes** :
- le résumé est construit à partir de la réponse et des **noms** des champs envoyés, jamais des valeurs brutes du corps : aucun mot de passe, jeton, empreinte ni contenu de fichier (`rule-foundation-audit-summary-no-secret`) ;
- le périmètre renseigné est le code de la ligne visée pour une table rattachée à un périmètre (`rule-foundation-audit-scope-field`) ; le verbe d'une suppression est `delete` (affiché « Suppression ») ;
- les lectures ne sont jamais tracées ; une écriture qui ne crée ni ne modifie de donnée métier ou d'administration doit être explicitement exemptée avec sa raison.

## 4. Déclarer un import

**L'auteur déclare** (`rule-foundation-import-declared-columns`) :
- une clé de fonctionnalité (1 à 50 caractères), qui sert aussi à la mémoire des fichiers importés ;
- les colonnes attendues : nom (1 à 100 caractères), obligatoire ou non, description française (1 à 500), et la règle de chaque cellule (valeur normalisée, ou raison française) ;
- facultativement une clé d'unicité dans le fichier (et la raison de doublon citant la première ligne) ;
- facultativement des contrôles contre la base **par lot** (jamais une requête par ligne), qui produisent des erreurs (ligne, colonne, raison) ;
- l'enregistrement d'un lot de lignes valides, qui renvoie le nombre de lignes créées et ignorées ;
- si les lignes sont rattachées à un périmètre ;
- ses quatre routes (spécification, aperçu, erreurs, confirmation) sur le modèle de `/users/imports/…`, avec ses rôles admis et les objets génériques du contrat (`ImportSpecificationDto`, `ImportPreviewDto`, `ImportErrorsListResponseDto`, `ImportRowErrorDto`, `ImportConfirmResponseDto`) ;
- côté studio, seulement l'accès à ses quatre routes, le nom de ses objets (« compte » / « comptes ») et un lien de sortie : le parcours d'écran (dépôt, aperçu, confirmation, messages) est fourni par le socle.

**Le socle garantit** :
- **aperçu sans écriture métier** (`rule-foundation-import-two-steps`), conservé 2 heures, privé à son créateur (`rule-foundation-import-preview-expires`, `rule-foundation-import-preview-owner`) ;
- **confirmation** qui n'écrit que les lignes valides (`rule-foundation-import-confirm-valid-only`), atomique avec sa trace (`rule-foundation-import-confirm-atomic`), revalidée (`rule-foundation-import-confirm-revalidates`) ;
- **doublon de fichier** : un même fichier (mêmes octets) n'est confirmé qu'une fois par fonctionnalité, même en concurrence (`rule-foundation-import-no-double`) ;
- **doublons internes** détectés selon la clé déclarée (`rule-foundation-import-in-file-duplicates`) ;
- **fichiers piégés** refusés avant toute lecture de ligne, avec un code dédié et sans rien conserver : nature réelle vérifiée, bombes et archives suspectes, liaisons et formules externes, taille et nombre de lignes (`rule-foundation-import-trapped-files-refused`, `-content-sniffing`, `-archive-limits`, `-external-links-refused`) ;
- **limites** : 100 Mio, 1 000 000 lignes, 1 000 caractères par cellule, exposées par la route de spécification (`rule-foundation-import-limits`) ;
- **lecture en flux** : réception en flux vers un stockage temporaire, lecture ligne à ligne (`@maleus/xlsx` pour `.xlsx`), traitement par lots, résultat stocké en base ; mémoire constante quelle que soit la taille ; pas de verrou durable sur les tables métier pendant l'analyse ; arrêt de l'analyse si le client se déconnecte ; aucun fichier temporaire résiduel (`rule-foundation-import-large-files`, `rule-foundation-import-temp-cleanup`) ;
- **lecture homogène** des en-têtes et des cellules (`rule-foundation-import-header-matching`, `rule-foundation-import-cell-normalisation`) et numéros de ligne de tableur ;
- **raisons** propres et bornées (`rule-foundation-import-reason-texts`), liste des erreurs paginée (`rule-foundation-import-errors-paginated`) ;
- **périmètres** respectés pour une fonctionnalité rattachée (`rule-foundation-import-respects-scopes`) ;
- **trace** : l'aperçu n'est pas tracé, la confirmation l'est obligatoirement (`rule-foundation-import-preview-not-traced`, `rule-foundation-import-audited`) ; une fonctionnalité qui a une route d'aperçu sans route de confirmation tracée échoue au contrôle avant livraison.

**Contraintes** : aucune table propre à l'import ; le résumé de la trace de confirmation est déclaré sur la route de confirmation (comme toute route tracée) ; les règles de validation des colonnes vivent uniquement côté API (le studio n'en code aucune).

## 5. Exiger le contrat fidèle

**L'auteur s'engage** à déclarer dans le contrat OpenAPI de ses routes chaque borne que l'API applique (minimum, maximum, longueurs, motifs, formats uuid et date-heure, nombre maximal d'éléments, `nullable`) et le schéma exact de chaque réponse.

**Le socle garantit** et **vérifie avant livraison** (EXI-PLAT-04, EXI-PLAT-09, EXI-PLAT-15) :
- le document OpenAPI est généré à partir des routes réellement servies et exposé par l'API ;
- toute différence incompatible avec le contrat de référence échoue, sauf si elle est listée et justifiée dans `contract-changes.yaml` ;
- un test de robustesse fondé sur le contrat ne doit obtenir ni 500, ni réponse hors schéma, sur aucune route (ce qui suppose les bornes déclarées, les doublons détectés en `409` et les caractères nuls refusés) ;
- la matrice des droits observée est comparée à `permissions.yaml` ;
- le client typé utilisé par le studio et la recette est régénéré à partir du contrat après chaque changement d'API.

**Contraintes** : les codes d'erreur sont des chaînes stables `<domaine>.<raison>` ; un nouveau code est ajouté, jamais renommé ; les routes de test ne figurent pas dans le contrat.

## 6. Remplacer l'accueil et ajouter des pages

Une fonctionnalité ajoute ses pages protégées dans la mise en page commune (garde de session, en-tête, gestion des échecs d'API `rule-foundation-api-failure-handling`, pagination `rule-foundation-list-pagination`) et peut remplacer la page d'accueil (`rule-foundation-home-replaceable`). Le nom de l'application (« Monappli » par défaut) est un paramètre à changer à la création d'une application.
