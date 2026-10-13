# Demande à l'API : file de décisions du superviseur

Écran demandeur : File de décisions (et compteurs de l'Accueil). Besoin : lister les éléments qui attendent le superviseur, par type, lire ce qui permet de décider, enregistrer une décision motivée parmi celles que le type permet, et relire les décisions déjà prises.

## Opérations
Toutes les routes : garde de profil `supervisor`. Listes : `from` 0 à 2147483647, `size` 1 à 100 (défaut 10), `{ items, total }`.

| Méthode et chemin | Action déclarée | Rôles | Entrée (bornes comprises) | Réponses (codes et formes) |
|---|---|---|---|---|
| `GET /decision-queue/items` | `queue:list` | profil `supervisor` | `status` : `open` (défaut) \| `decided` ; `type` facultatif (un des dix types) ; `from`, `size` | `200 { items: QueueItemDto[], total }` ; `open` : du plus ancien au plus récent (`createdAt`, puis identifiant) ; `decided` : du plus récent décidé au plus ancien |
| `GET /decision-queue/counts` | `queue:counts` | profil `supervisor` | — | `200 { total: integer, byType: { contestation, amount_over_threshold, ladder_exhausted, unassigned_payment, accounting_gap, prescription_near, prescription_expired, alert, human_request, transfer_proposed }` (entiers, éléments ouverts) `}` |
| `POST /decision-queue/items/:id/decision` | `queue:decide` | profil `supervisor` | `id` uuid ; corps strict `{ decision: string (code, 1..50), reason: string (rogné, 1..1000), invoiceId?: uuid }` | `200 { item: QueueItemDto }` (état après décision) ; `400 api.validation.incoming_failed` (motif vide ou trop long, `invoiceId` absent pour `assign` ou présent pour un autre code) ; `404 repository.not_found` ; `409 queue.already_decided` ; `409 queue.decision_not_allowed` (code absent des décisions permises du type) ; `409 queue.invoice_not_open` (facture inconnue du portefeuille, soldée ou non ouverte) |

DTO :
- `QueueItemDto` = `{ id, type, status: 'open' \| 'decided', createdAt, caseId: uuid \| null, debtorId: string \| null, summary: string(1..300) /* français, rédigé par l'API */, details: { label: string(1..100), value: string(0..300) }[] /* au plus 20, français */, allowedDecisions: string[] /* codes, vide si décidé */, candidates: { invoiceId, caseId, debtorId, number, creditorSiren, balanceCents }[] /* au plus 50, seulement pour unassigned_payment ouvert, sinon vide */, decision: { code: string, reason: string, decidedAt, decidedBy: { id, email } \| null /* null : clôture automatique */ } \| null }`.
- Les types, leurs décisions permises et leurs libellés sont ceux de `referentiel-etats-et-transitions.md` §4.

Trace d'audit : `POST .../decision` est tracée (type d'objet « Élément de file », action `queue:decide`, identifiant = id de l'élément, résumé « Décision « <libellé de la décision> » sur un élément « <libellé du type> ». » sans le motif ; le motif est conservé dans la décision, relue par la file).

## Règles
- `rule-recouvrement-queue-contents` (user) : la file du superviseur reçoit : les contestations, les montants au-delà du seuil, les échelles épuisées, les paiements non affectés, les sorties comptables en écart, les prescriptions proches ou échues, les alertes (arrêt automatique, plafond d'encours, confirmation écrite refusée), les demandes d'intervention humaine et les transferts proposés ; le superviseur seul la lit et la tranche (`403 security.access_denied` pour les autres profils).
- `rule-recouvrement-queue-decision-motivated` (user) : chaque décision du superviseur est motivée (1 à 1 000 caractères) et journalisée : décision, motif, auteur, instant sont conservés ; elles alimentent aussi le journal d'audit du socle.
- `rule-recouvrement-queue-allowed-decisions` (inferred) : les décisions permises par type sont celles du tableau du référentiel (§4) ; une autre est refusée (`409 queue.decision_not_allowed`) ; l'API rend `allowedDecisions` pour que le studio n'en code aucune.
- `rule-recouvrement-queue-decided-final` (inferred) : un élément décidé ne change plus (`409 queue.already_decided`) ; deux décisions simultanées sur le même élément donnent une réussite et un `409`.
- `rule-recouvrement-queue-single-open` (inferred) : au plus un élément ouvert par type et objet visé (dossier, facture, paiement, sortie, lot) ; un événement répété (appel rejoué, import suivant) n'en crée pas de second.
- `rule-recouvrement-queue-effects` (inferred) : effets des décisions, dans la transaction de la décision, avec transitions journalisées : `acknowledge` et `keep` n'ont d'autre effet que de clore l'élément ; `authorize` mémorise le montant négociable autorisé (le dossier n'est plus mis en file pour le seuil tant que son montant négociable ne le dépasse pas) ; `transfer` et `approve_transfer` portent le dossier à `transferred` ; `reject_transfer` clôt l'élément et le cerveau ne reproduit pas la proposition tant que la règle appliquée au dossier est la même ; `resume` lève la suspension de la négociation ; `reapprove` remet la sortie à `approved` avec un compteur d'imports à 0 ; `assign` affecte le paiement à la facture indiquée (montant appliqué = minimum du paiement et du solde ; l'excédent éventuel redevient un paiement non affecté et ouvre un nouvel élément), lève le gel `unassigned_payment` des dossiers concernés dont aucun autre paiement ne justifie encore le gel, et relance l'évaluation des dossiers touchés.
- `rule-recouvrement-queue-unassigned-until-assigned` (user) : un paiement non affecté reste dans la file, et les dossiers qu'il gèle restent gelés, jusqu'à son affectation par le superviseur.
- `rule-recouvrement-queue-auto-close` (inferred) : un élément `accounting_gap` se clôt sans décision (`decision.code` = `auto_closed`, `decidedBy` nul) quand la sortie est constatée plus tard ; un élément `unassigned_payment` se clôt de même quand un import ultérieur de créances inclut le paiement dans les soldes (il n'est plus appliqué).
- `rule-recouvrement-queue-order` (inferred) : la file ouverte se lit du plus ancien au plus récent pour que rien ne vieillisse sans être vu.

## Compatibilité
Aucune opération existante modifiée. Les éléments sont créés par le cerveau, les imports et les outils des agents (autres demandes) ; aucune route de création ni de suppression n'est exposée. `specifications/permissions.yaml` : une ligne par opération.
