import type { QueueType } from './decision-queue.tables'

/** Decisions allowed by type (referentiel-etats-et-transitions §4, rule-recouvrement-queue-allowed-decisions). */
export const ALLOWED_DECISIONS: Record<QueueType, string[]> = {
  contestation: ['acknowledge'],
  amount_over_threshold: ['authorize', 'transfer'],
  ladder_exhausted: ['keep', 'transfer'],
  unassigned_payment: ['assign'],
  accounting_gap: ['reapprove'],
  prescription_near: ['acknowledge', 'transfer'],
  prescription_expired: ['acknowledge', 'transfer'],
  alert: ['acknowledge'],
  human_request: ['resume', 'transfer'],
  transfer_proposed: ['approve_transfer', 'reject_transfer'],
}

/** French labels of the types of item (referential §4), used by the journal of the audit. */
export const QUEUE_TYPE_LABELS: Record<QueueType, string> = {
  contestation: 'Contestation',
  amount_over_threshold: 'Montant au-delà du seuil',
  ladder_exhausted: 'Échelle épuisée',
  unassigned_payment: 'Paiement non affecté',
  accounting_gap: 'Sortie comptable en écart',
  prescription_near: 'Prescription proche',
  prescription_expired: 'Prescription échue',
  alert: 'Alerte',
  human_request: "Demande d'intervention humaine",
  transfer_proposed: 'Transfert proposé',
}

/** French labels of the decisions (referential §4). */
const DECISION_LABELS: Record<string, string> = {
  acknowledge: 'Prendre acte',
  authorize: 'Autoriser la négociation',
  transfer: "Transférer à l'étape suivante",
  keep: 'Maintenir le dossier',
  assign: 'Affecter à une facture',
  reapprove: 'Remettre en attente de constatation',
  resume: 'Rendre le dossier au cerveau',
  approve_transfer: 'Approuver le transfert',
  reject_transfer: 'Refuser le transfert',
}

/** `acknowledge` reads « Acquitter » on an alert (referential §4). */
export const decisionLabel = (type: QueueType, code: string): string =>
  type === 'alert' && code === 'acknowledge' ? 'Acquitter' : (DECISION_LABELS[code] ?? code)
