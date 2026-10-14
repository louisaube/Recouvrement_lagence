/** Labels of `referentiel-etats-et-transitions.md` §5-§7; an unknown code is shown as it is (rule-recouvrement-ui-formats). */
const lookup = (table: Record<string, string>) => (code: string) => table[code] ?? code

export const profileLabel = lookup({ supervisor: 'Superviseur', agent: 'Compte agent', litigation: 'Service litiges', indicators: 'Lecteur des indicateurs' })
export const channelLabel = lookup({ voice: 'Voix', email_sms: 'Courriel et SMS', mail: 'Courrier' })
export const natureLabel = lookup({ family: 'Famille', company: 'Entreprise' })
export const policyStatusLabel = lookup({ imported: 'Importée', active: 'Active', superseded: 'Remplacée' })
export const nextStepLabel = lookup({ external_collector: 'Recouvreur externe', litigation: 'Contentieux', assignment: 'Cession' })
export const documentLabel = lookup({ contract: 'Contrat', order: 'Commande', delivery_proof: 'Preuve de livraison' })
export const dailyActionLabel = lookup({ none: 'Aucune', reminder: 'Relance', proposal: 'Proposition', transfer_proposed: 'Transfert proposé' })
export const checkLabel = lookup({
  floor: 'Aucune offre sous le plancher de son segment',
  decreasing_concessions: 'Concessions décroissantes',
  counterparts: 'Chaque concession porte une contrepartie',
  schedule_limits: 'Échéanciers dans la durée maximale, sans frais ni intérêt pour une famille',
  segments_covered: 'Chaque segment des créances confirmées a une règle',
  witnesses: 'Dossiers témoins conformes aux décisions attendues',
})
export const importTypeLabel = lookup({ receivables: 'Créances', payments: 'Paiements', disputes: 'Litiges', contacts: 'Interlocuteurs', documents: 'Pièces' })

export const interlocutorRoleLabel = lookup({ accounts_payable: 'Comptabilité fournisseurs', buyer: 'Acheteur', approver: 'Valideur', payer: 'Payeur' })
export const orderTypeLabel = lookup({ reminder: 'Relance', proposal: 'Proposition', commitment_confirmation: "Confirmation d'engagement" })
export const orderStatusLabel = lookup({ planned: 'Prévu', blocked: 'Bloqué', cancelled: 'Annulé' })
export const batchStatusLabel = lookup({ blocked: 'Bloqué', ready: 'Prêt', replaced: 'Remplacé' })
export const batchCheckLabel = lookup({
  statement_fresh: 'Relevé bancaire frais',
  witnesses_replayed: 'Dossiers témoins rejoués sans écart',
  decision_share: 'Part de chaque type de décision dans la limite',
  no_duplicate_order: 'Aucun ordre en double (dossier, type, jour)',
})
export const exclusionReasonLabel = lookup({
  documents_missing: 'Pièce exigée absente',
  channel_suspended: 'Canal suspendu',
  channel_not_authorized: 'Canal non autorisé',
  no_contact: 'Aucun interlocuteur joignable',
  frozen: 'Dossier gelé',
  statement_stale: 'Relevé périmé',
  covered_by_outputs: 'Part couverte par une sortie comptable',
})

/** Types and decisions of the supervisor queue (`referentiel-etats-et-transitions.md` §4). rule-recouvrement-screen-queue-no-local-rules */
export const QUEUE_TYPES = [
  'contestation',
  'amount_over_threshold',
  'ladder_exhausted',
  'unassigned_payment',
  'accounting_gap',
  'prescription_near',
  'prescription_expired',
  'alert',
  'human_request',
  'transfer_proposed',
] as const
export const queueTypeLabel = lookup({
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
})
const queueDecisionTable = lookup({
  acknowledge: 'Prendre acte',
  authorize: 'Autoriser la négociation',
  transfer: "Transférer à l'étape suivante",
  keep: 'Maintenir le dossier',
  assign: 'Affecter à une facture',
  reapprove: 'Remettre en attente de constatation',
  resume: 'Rendre le dossier au cerveau',
  approve_transfer: 'Approuver le transfert',
  reject_transfer: 'Refuser le transfert',
  auto_closed: 'Clôture automatique',
})
/** rule-recouvrement-screen-queue-label-by-type: « Acquitter » for an alert, « Prendre acte » for any other type. */
export function queueDecisionLabel(code: string, type: string): string {
  return code === 'acknowledge' && type === 'alert' ? 'Acquitter' : queueDecisionTable(code)
}

/** « Compte agent · Voix » for an agent, the profile label otherwise. */
export function profileWithChannelLabel(profile: string, channel: string | null | undefined): string {
  return profile === 'agent' && channel ? `${profileLabel(profile)} · ${channelLabel(channel)}` : profileLabel(profile)
}
