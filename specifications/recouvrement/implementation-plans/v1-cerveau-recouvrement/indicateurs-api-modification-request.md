# Demande à l'API : indicateurs agrégés

Écran demandeur : Indicateurs. Besoin : afficher les cinq indicateurs, chacun en deux termes, sans note agrégée, par segment, version de politique et version d'agent, au superviseur et au lecteur des indicateurs. Aucune donnée nominative n'est rendue.

## Opérations
Garde de profil : `supervisor` ou `indicators` (l'un ou l'autre). Les autres profils et les comptes sans profil : `403 security.access_denied` ; visiteur `401`.

| Méthode et chemin | Action déclarée | Rôles | Entrée (bornes comprises) | Réponses (codes et formes) |
|---|---|---|---|---|
| `GET /indicators` | `indicators:list` | profils `supervisor`, `indicators` | `segment` (1 à 50) ; `policyVersionId` uuid ; `agentVersion` (`^[A-Za-z0-9._-]{1,50}$`) ; `from` et `to` (dates, `from` ≤ `to`) ; `rowFrom` (0 à 2147483647), `rowSize` (1 à 100, défaut 25) | `200 { rows: IndicatorRowDto[], total: integer }` triées par `segment`, puis `policyVersion.versionDate` décroissante, puis `agentVersion` (valeur nulle en dernier) ; `400` bornes invalides ou `from` > `to` |
| `GET /indicators/filters` | `indicators:filters` | profils `supervisor`, `indicators` | — | `200 { segments: string[], policyVersions: { id, label, versionDate }[], agentVersions: string[] }` |

DTO : `IndicatorRowDto` = `{ segment: string, policyVersion: { id, label } \| null, agentVersion: string \| null, collected: { collectedCents: integer, dueCents: integer }, commitments: { heldCount: integer, takenCount: integer }, discounts: { grantedCents: integer, dueCents: integer }, complaints: { complaintCount: integer, actionCount: integer }, errors: { errorCount: integer, reviewedCount: integer } }`. Aucun ratio, aucun pourcentage, aucune note : deux termes par indicateur.

Aucune trace d'audit (lecture).

## Règles
- `rule-recouvrement-indicators-five` (user) : cinq indicateurs, chacun en deux termes : encaissé / dû à l'horizon ; engagements tenus / pris ; remises accordées / dû ; réclamations / actions ; erreurs / décisions relues.
- `rule-recouvrement-indicators-dimensions` (user) : chaque ligne est un triplet (segment, version de politique, version d'agent) ; une dimension sans objet (aucun agent, aucune politique) vaut `null` ; les termes d'une ligne sont des sommes (centimes) ou des comptes.
- `rule-recouvrement-indicators-no-score` (user) : aucune note agrégée, aucune moyenne pondérée, aucun ratio calculé par l'API.
- `rule-recouvrement-indicators-aggregate-only` (user) : le lecteur des indicateurs n'obtient que ces deux routes : tout autre route de recouvrement lui répond `403 security.access_denied` ; les lignes ne contiennent ni identifiant client, ni SIREN, ni coordonnée, ni numéro de facture.
- `rule-recouvrement-indicator-collected` (inferred) : encaissé / dû à l'horizon : pour les dossiers dont l'horizon de leur règle (date de première apparition + `horizonDays`) est atteint, dû = somme des soldes de leurs factures à leur première apparition, encaissé = paiements affectés à ces factures entre cette date et l'horizon ; rattaché au segment du dossier, à la version de politique active à la première apparition et à la version d'agent de la dernière conversation ouverte avant l'horizon (sinon `null`) ; daté de l'horizon.
- `rule-recouvrement-indicator-commitments` (inferred) : engagements tenus / pris : pris = engagements inscrits, tenus = engagements au statut `held` ; rattachés à la politique active et à la version d'agent à l'inscription ; datés de l'inscription.
- `rule-recouvrement-indicator-discounts` (inferred) : remises accordées / dû : sur les engagements tenus, accordées = somme des remises (`discountCents`) et dû = somme des montants négociables à l'inscription de ces engagements ; mêmes rattachements ; datés du constat de l'engagement tenu.
- `rule-recouvrement-indicator-complaints` (inferred) : réclamations / actions : réclamations = réclamations signalées ; actions = conversations ouvertes plus ordres d'envoi des lots prêts (ces derniers sans version d'agent) ; rattachées au segment du dossier, à la politique active à l'instant et à la version d'agent de l'appel (ordres : `null`) ; datées de l'événement.
- `rule-recouvrement-indicator-errors` (inferred) : erreurs / décisions relues : relues = relectures données, erreurs = relectures dont l'action du superviseur diffère de celle du cerveau ; rattachées au segment du dossier, à la politique de la décision relue, sans version d'agent (`null`) ; datées de la relecture.
- `rule-recouvrement-indicators-period` (inferred) : `from` et `to` (bornes incluses, jours civils Europe/Paris) portent sur la date de chaque indicateur ci-dessus ; absents : tout l'historique.

## Compatibilité
Aucune opération existante modifiée. `specifications/permissions.yaml` : deux lignes, `allow: []` avec garde de profil (`supervisor` ou `indicators`).
