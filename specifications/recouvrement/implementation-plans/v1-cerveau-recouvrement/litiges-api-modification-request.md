# Demande à l'API : litiges et contestations

Écran demandeur : Litiges. Besoin : le service litiges voit les factures en litige, les contestations et les dossiers concernés, ouvre un litige et le clôt, ce qui gèle ou dégèle la facture. Rien d'autre : ni la fiche complète du dossier, ni les décisions du cerveau, ni la politique.

## Opérations
Garde de profil `litigation` sur toutes les routes (le superviseur n'y a pas accès : `403 security.access_denied`). Listes : `from`, `size` (1 à 100, défaut 10), `{ items, total }`.

| Méthode et chemin | Action déclarée | Rôles | Entrée (bornes comprises) | Réponses (codes et formes) |
|---|---|---|---|---|
| `GET /disputes` | `disputes:list` | profil `litigation` | `status` : `open` (défaut) \| `closed` \| `all` ; `origin` : `import` \| `contestation` \| `service` ; `search` (1 à 50 : numéro de facture ou identifiant client, sous-chaîne sans casse) ; `from`, `size` | `200 { items: DisputeDto[], total }` ; ouverts : du plus ancien `openedAt` au plus récent ; clos : du plus récent `closedAt` |
| `GET /disputes/:id` | `disputes:get` | profil `litigation` | `id` uuid | `200 { dispute: DisputeDetailDto }` ; `404 repository.not_found` ; `400` |
| `GET /disputes/invoices` | `disputes:invoice-search` | profil `litigation` | `number` (1 à 50, préfixe sans casse) obligatoire ; `from`, `size` | `200 { items: DisputeInvoiceDto[], total }` (factures ouvertes, solde > 0), triées par numéro |
| `POST /disputes` | `disputes:open` | profil `litigation` | corps strict `{ invoiceId: uuid, reason: string (rogné, 1..500), owner: string (rogné, 1..100) }` | `201 { dispute: DisputeDetailDto }` ; `400` ; `404 repository.not_found` (facture inconnue ou non ouverte) ; `409 disputes.already_open` (litige ouvert existant sur cette facture) |
| `POST /disputes/:id/close` | `disputes:close` | profil `litigation` | `id` uuid ; corps strict `{ note: string (rogné, 1..500) }` | `200 { dispute: DisputeDetailDto }` ; `400` ; `404` ; `409 disputes.already_closed` |

DTO :
- `DisputeInvoiceDto` = `{ id, number, creditorSiren, debtorId, balanceCents, frozen: boolean }`.
- `DisputeDto` = `{ id, status: 'open' \| 'closed', origin: 'import' \| 'contestation' \| 'service', invoiceNumber, creditorSiren, balanceCents, debtorId, caseId, caseState, reason: string, owner: string, openedAt, closedAt \| null }`.
- `DisputeDetailDto` = `DisputeDto` + `{ invoice: DisputeInvoiceDto, case: { id, debtorId, nature, state, openInvoices: integer, frozenInvoices: integer }, closeNote: string \| null, closedBy: { id, email } \| null, openedBy: { id, email } \| null /* nul : import ou agent */, contestation: { id, channel, conversationId: string, statedAt, text: string } \| null }`. `reason` est le motif de l'import, de la contestation ou de l'ouverture ; `owner` le responsable.

Trace d'audit : `open` et `close` sont tracées (type d'objet « Litige », actions `disputes:open` et `disputes:close`, identifiant = id du litige ; résumés « Litige ouvert sur la facture <numéro>. » et « Litige clos sur la facture <numéro>. », sans motif ni note).

## Règles
- `rule-recouvrement-disputes-litigation-only` (user) : le service litiges voit les factures en litige, les contestations et les dossiers concernés (résumé du dossier : identifiant client, nature, état, nombre de factures ouvertes et gelées), ouvre et clôt un litige, rien d'autre ; il ne lit ni la fiche dossier, ni les décisions, ni la politique, ni les indicateurs (`403 security.access_denied` sur ces routes).
- `rule-recouvrement-dispute-open-freezes` (user) : un litige ouvert gèle sa facture : la facture sort du montant négociable ; l'événement est une transition du dossier si toutes ses factures ouvertes sont gelées (état `frozen`, cause `dispute_opened`).
- `rule-recouvrement-dispute-close-unfreezes` (user) : la clôture dégèle la facture si aucun autre litige ouvert ne la vise ; le dossier est réévalué ; si le litige est né d'une contestation et qu'aucun autre litige né de cette contestation n'est ouvert, le gel de dossier `contestation` est levé (cause `freeze_released`).
- `rule-recouvrement-dispute-one-open-per-invoice` (inferred) : au plus un litige ouvert par facture (index unique partiel de la base) ; l'import Litiges compte une facture déjà en litige ouvert comme ignorée ; une contestation sur une facture déjà en litige n'en crée pas de second mais rattache la contestation au litige existant.
- `rule-recouvrement-dispute-contestation-origin` (user) : une contestation exprimée dans une conversation crée un litige (origine `contestation`) par facture visée, avec le texte de la contestation en `contestation.text` (au plus 1 000 caractères), à l'intention du service litiges.
- `rule-recouvrement-dispute-no-delete` (inferred) : un litige clos n'est ni rouvert ni supprimé ; un nouveau litige s'ouvre sur la même facture si besoin.
- `rule-recouvrement-dispute-text-plain` (inferred) : motifs, notes et textes de contestation sont du texte brut ; le studio ne les interprète jamais comme du HTML.

## Compatibilité
Aucune opération existante modifiée. `specifications/permissions.yaml` : une ligne par opération, garde de profil `litigation`.
