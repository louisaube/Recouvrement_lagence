/**
 * The only numeric constants of the lot of the day (rule-recouvrement-policy-no-business-value-in-code): the parameters
 * that the request writes in clear for the automatic stop, the unit of the basis points, and the order of the channels.
 * Every other figure (thresholds, caps, delays) comes from the active policy.
 */

/** rule-recouvrement-batch-auto-stop: "plus de trois écarts-types". The comparison is made on squares (9 variances). */
export const SIGMA_FACTOR = 3
/** rule-recouvrement-batch-auto-stop: "la moyenne sur les 20 derniers lots précédents". */
export const HISTORY_SIZE = 20
/** rule-recouvrement-batch-auto-stop: "dès qu'il en existe au moins 10". */
export const HISTORY_MIN = 10
/** A share is expressed in basis points (10 000 = the whole batch). */
export const BASIS_POINTS = 10_000

/** rule-recouvrement-batch-channel-order (inferred): the first eligible channel in this order is chosen. */
export const CHANNEL_ORDER = ['voice', 'email_sms', 'mail'] as const
/** Referential §6: the interlocutor is the first by role in this order, then by identifier. */
export const ROLE_ORDER = ['accounts_payable', 'buyer', 'approver', 'payer'] as const
/** The four types of decision whose share is checked (referential §6, daily action). */
export const DECISION_TYPES = ['none', 'reminder', 'proposal', 'transfer_proposed'] as const

/** Bounds of the contract of the DTOs. */
export const MAX_PROBLEMS = 50
export const MAX_PROBLEM_LENGTH = 300
export const MAX_REASON_LENGTH = 1000
