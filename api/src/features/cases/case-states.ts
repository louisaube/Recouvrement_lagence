import { CASE_STATES, CaseState } from './cases.tables'

export { CASE_STATES }
export type { CaseState }

/** Frozen / final states. */
export const FINAL_STATES: CaseState[] = ['transferred', 'settled']

/** Causes of a freeze (referential §2). */
export const FREEZE_CAUSES = ['contestation', 'dispute_opened', 'unassigned_payment', 'all_invoices_frozen'] as const

/** rule-recouvrement-case-state-queue-types: the only types of item that put a case in the queue of the supervisor. */
export const QUEUE_STOPPING_TYPES = ['amount_over_threshold', 'ladder_exhausted', 'human_request', 'transfer_proposed'] as const

export interface Transition {
  from: CaseState | null
  to: CaseState
  causes: readonly string[]
}

const LIVE: CaseState[] = ['open', 'negotiating', 'committed']

/**
 * rule-recouvrement-case-state-referential: the transitions allowed by `referentiel-etats-et-transitions.md` §2. A
 * transition that is not in this table is never produced (the state service raises an internal error instead).
 * Two readings of the table by the precedence of §1: a case in the supervisor queue that receives a freeze goes to
 * `frozen` with the cause of the freeze (frozen has the higher precedence), and a frozen case whose freeze falls goes
 * back to the state of precedence, the queue included (`freeze_released`).
 */
export const TRANSITIONS: Transition[] = [
  { from: null, to: 'open', causes: ['import'] },
  { from: 'settled', to: 'open', causes: ['import'] },
  { from: 'open', to: 'negotiating', causes: ['offer_unlocked'] },
  { from: 'negotiating', to: 'committed', causes: ['commitment_registered'] },
  { from: 'committed', to: 'open', causes: ['commitment_broken', 'commitment_held'] },
  { from: 'committed', to: 'settled', causes: ['commitment_held', 'balance_cleared'] },
  ...LIVE.map((from): Transition => ({ from, to: 'frozen', causes: FREEZE_CAUSES })),
  { from: 'supervisor_queue', to: 'frozen', causes: FREEZE_CAUSES },
  ...(['open', 'negotiating', 'committed', 'supervisor_queue'] as CaseState[]).map(
    (to): Transition => ({ from: 'frozen', to, causes: ['freeze_released'] }),
  ),
  ...LIVE.map((from): Transition => ({ from, to: 'supervisor_queue', causes: ['queue_item_opened'] })),
  ...LIVE.map((to): Transition => ({ from: 'supervisor_queue', to, causes: ['queue_item_decided'] })),
  ...(['supervisor_queue', ...LIVE] as CaseState[]).map((from): Transition => ({ from, to: 'transferred', causes: ['transfer_approved'] })),
  ...(['open', 'negotiating', 'frozen', 'supervisor_queue'] as CaseState[]).map(
    (from): Transition => ({ from, to: 'settled', causes: ['balance_cleared'] }),
  ),
]

export function allowedCauses(from: CaseState | null, to: CaseState): string[] {
  return TRANSITIONS.filter((t) => t.from === from && t.to === to).flatMap((t) => [...t.causes])
}

/** What the state of a case is made of (read from the tables, never cached). */
export interface CaseFacts {
  current: CaseState
  /** At least one invoice (not a credit note) with a positive balance. */
  hasOpenInvoice: boolean
  /** An active freeze of case scope: its codes. */
  caseFreezeCodes: string[]
  /** Every open invoice carries an active freeze of its own. */
  allOpenInvoicesFrozen: boolean
  /** An open item of the queue that stops the negotiation. */
  stoppedByQueue: boolean
  /** An engagement in progress (written by the lot of the agent tools). */
  pendingCommitment: boolean
  /** An offer unlocked and not revoked (written by the lot of the agent tools). */
  activeOffer: boolean
}

/**
 * rule-recouvrement-case-state-referential, precedence of §1: settled, transferred, frozen, supervisor_queue,
 * committed, negotiating, open. `transferred` never leaves (no transition starts from it).
 */
export function deriveState(facts: CaseFacts): CaseState {
  if (facts.current === 'transferred') return 'transferred'
  if (!facts.hasOpenInvoice) return 'settled'
  if (facts.caseFreezeCodes.length > 0 || facts.allOpenInvoicesFrozen) return 'frozen'
  if (facts.stoppedByQueue) return 'supervisor_queue'
  if (facts.pendingCommitment) return 'committed'
  if (facts.activeOffer) return 'negotiating'
  return 'open'
}

export class InternalStateError extends Error {
  constructor(from: CaseState | null, to: CaseState) {
    super(`The transition ${from ?? '(creation)'} -> ${to} is not in the referential of the states`)
    this.name = 'InternalStateError'
  }
}
