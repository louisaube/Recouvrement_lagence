import { decimalOf, OfferFigures } from '../brain/offers'
import { CHANNEL_ORDER, ROLE_ORDER } from './batches.constants'

export type Channel = (typeof CHANNEL_ORDER)[number]
export type OrderKind = 'reminder' | 'proposal'
export type ExclusionReason =
  | 'documents_missing'
  | 'channel_suspended'
  | 'channel_not_authorized'
  | 'no_contact'
  | 'frozen'
  | 'statement_stale'
  | 'covered_by_outputs'

export interface InvoiceFact {
  id: string
  number: string
  balanceCents: number
  dueDate: string
  /** Channels the invoice is open to. */
  channels: string[]
  /** Types of supporting documents present in the index of the invoice. */
  documents: string[]
}

export interface ContactFact {
  id: string
  role: string
  email: string | null
  phone: string | null
  postalAddress: string | null
  suspendedChannels: string[]
}

export interface Condition {
  name: string
  value: string
}

export type Recipient =
  | { ok: true; channel: Channel; contact: ContactFact; invoices: InvoiceFact[] }
  | { ok: false; reason: Extract<ExclusionReason, 'documents_missing' | 'channel_suspended' | 'channel_not_authorized' | 'no_contact'> }

/** Does the contact hold a coordinate that serves the channel (suspended or not)? */
const hasCoordinate = (c: ContactFact, channel: Channel): boolean => {
  if (channel === 'voice') return c.phone !== null
  if (channel === 'email_sms') return c.email !== null || c.phone !== null
  return c.postalAddress !== null
}

/** The first by role (referential §6) then by identifier. */
const byRoleThenId = (a: ContactFact, b: ContactFact): number =>
  ROLE_ORDER.indexOf(a.role as never) - ROLE_ORDER.indexOf(b.role as never) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

/**
 * rule-recouvrement-batch-order-eligibility (user), rule-recouvrement-batch-channel-order (inferred),
 * rule-recouvrement-documents-required-blocks-reminder (user).
 * `invoices` are the negotiable invoices of the case. A reminder leaves out the invoices whose required document is
 * missing from the index (none left: `documents_missing`). A channel is used if a remaining invoice authorizes it and an
 * interlocutor is reachable on it (a valid coordinate, channel not suspended: rule-recouvrement-contact-invalid-suspends-channel);
 * the first channel in the order voice, email_sms, mail wins, then the first interlocutor by role and identifier.
 */
export function chooseRecipient(
  kind: OrderKind,
  invoices: InvoiceFact[],
  contacts: ContactFact[],
  requiredDocuments: readonly string[],
): Recipient {
  const usable = kind === 'reminder' ? invoices.filter((i) => requiredDocuments.every((d) => i.documents.includes(d))) : invoices
  if (usable.length === 0) return { ok: false, reason: 'documents_missing' }

  const authorized = CHANNEL_ORDER.filter((ch) => usable.some((i) => i.channels.includes(ch)))
  const sorted = [...contacts].sort(byRoleThenId)
  for (const channel of authorized) {
    const contact = sorted.find((c) => hasCoordinate(c, channel) && !c.suspendedChannels.includes(channel))
    if (contact) return { ok: true, channel, contact, invoices: usable.filter((i) => i.channels.includes(channel)) }
  }
  if (authorized.some((ch) => sorted.some((c) => hasCoordinate(c, ch)))) return { ok: false, reason: 'channel_suspended' }
  const elsewhere = CHANNEL_ORDER.some((ch) => !authorized.includes(ch) && sorted.some((c) => hasCoordinate(c, ch) && !c.suspendedChannels.includes(ch)))
  return { ok: false, reason: elsewhere ? 'channel_not_authorized' : 'no_contact' }
}

/**
 * rule-recouvrement-batch-orders-structured (user): a reminder carries, for each invoice aimed at, the amount due and the
 * due date. Name-value pairs only, never a drafted text.
 */
export function reminderConditions(invoices: InvoiceFact[]): Condition[] {
  return invoices.flatMap((i) => [
    { name: `Facture ${i.number} : montant dû (EUR)`, value: decimalOf(i.balanceCents) },
    { name: `Facture ${i.number} : échéance`, value: i.dueDate },
  ])
}

/** rule-recouvrement-batch-orders-structured (user): a proposal carries the conditions of the anchor, the first offer of the ladder. */
export function proposalConditions(offer: OfferFigures): Condition[] {
  const conditions: Condition[] = [
    { name: 'Type d’offre', value: offer.kind === 'schedule' ? 'Échéancier' : 'Paiement comptant' },
    { name: 'Somme à régler (EUR)', value: decimalOf(offer.totalCents) },
    { name: 'Remise (EUR)', value: decimalOf(offer.discountCents) },
    { name: 'Premier versement avant le', value: offer.firstPaymentDate },
  ]
  if (offer.delayFeeCents > 0) conditions.push({ name: 'Frais de délai inclus (EUR)', value: decimalOf(offer.delayFeeCents) })
  if (offer.kind === 'schedule') {
    offer.instalments.forEach((p, k) => conditions.push({ name: `Échéance ${k + 1}`, value: `${p.dueDate} : ${decimalOf(p.amountCents)}` }))
  }
  return conditions
}
