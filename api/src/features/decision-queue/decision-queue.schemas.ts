import { z } from 'zod'
import { paginationQuerySchema } from '../../platform/validation/common'
import { instantString, integer, listOf, uuidField } from '../recovery-common/schemas'
import { QUEUE_TYPES } from './decision-queue.tables'

const queueTypeSchema = z.enum(QUEUE_TYPES).meta({ id: 'QueueTypeDto', description: 'Type of an item of the queue of the supervisor' })

/** rule-recouvrement-queue-order: `open` (default) reads oldest first, `decided` the most recently decided first. */
export const queueItemsQuerySchema = paginationQuerySchema.extend({
  status: z.enum(['open', 'decided']).default('open').meta({ description: 'Open items (default) or decided ones' }),
  type: queueTypeSchema.optional().meta({ description: 'Only the items of this type' }),
})
export type QueueItemsQuery = z.infer<typeof queueItemsQuerySchema>

const detailSchema = z
  .object({
    label: z.string().min(1).max(100).meta({ description: 'Label of the detail (1 to 100 characters)' }),
    value: z.string().max(300).meta({ description: 'Value of the detail (at most 300 characters)' }),
  })
  .meta({ id: 'QueueItemDetailDto' })

const candidateSchema = z
  .object({
    invoiceId: uuidField('Invoice ID'),
    caseId: uuidField('Case ID'),
    debtorId: z.string().min(1).max(100).meta({ description: 'Customer identifier' }),
    number: z.string().min(1).max(50).meta({ description: 'Invoice number' }),
    creditorSiren: z.string().regex(/^[0-9]{9}$/).meta({ description: 'SIREN of the creditor entity' }),
    balanceCents: integer(0, 'Balance in cents'),
  })
  .meta({ id: 'QueueCandidateDto' })

const decisionSchema = z
  .object({
    code: z.string().min(1).max(50).meta({ description: 'Code of the decision (`auto_closed` for an automatic closing)' }),
    reason: z.string().max(1000).meta({ description: 'Reason of the decision (empty for an automatic closing)' }),
    decidedAt: instantString('Instant of the decision'),
    decidedBy: z
      .object({ id: uuidField('Account ID'), email: z.string().meta({ description: 'E-mail of the account' }) })
      .nullable()
      .meta({ description: 'Author of the decision; null for an automatic closing' }),
  })
  .meta({ id: 'QueueDecisionDto' })

export const queueItemSchema = z
  .object({
    id: uuidField('Item ID'),
    type: queueTypeSchema,
    status: z.enum(['open', 'decided']).meta({ description: 'The item is open or decided' }),
    createdAt: instantString('Creation instant'),
    caseId: uuidField('Case ID').nullable(),
    debtorId: z.string().min(1).max(100).nullable().meta({ description: 'Customer identifier of the case, if any' }),
    summary: z.string().min(1).max(300).meta({ description: 'Summary of the item (French)' }),
    details: z.array(detailSchema).max(20).meta({ description: 'What allows to decide (French, at most 20)' }),
    allowedDecisions: z.array(z.string().min(1).max(50)).max(10).meta({ description: 'Codes of the decisions the type allows; empty once decided' }),
    candidates: z.array(candidateSchema).max(50).meta({ description: 'Invoices a payment can be assigned to (open unassigned payment only)' }),
    decision: decisionSchema.nullable(),
  })
  .meta({ id: 'QueueItemDto' })
export const queueItemsResponseSchema = listOf(queueItemSchema, 'QueueItemsResponseDto', 'Items of the page')

export const queueCountsResponseSchema = z
  .object({
    total: integer(0, 'Number of open items'),
    byType: z
      .object({
        contestation: integer(0, 'Open items of type contestation'),
        amount_over_threshold: integer(0, 'Open items of type amount_over_threshold'),
        ladder_exhausted: integer(0, 'Open items of type ladder_exhausted'),
        unassigned_payment: integer(0, 'Open items of type unassigned_payment'),
        accounting_gap: integer(0, 'Open items of type accounting_gap'),
        prescription_near: integer(0, 'Open items of type prescription_near'),
        prescription_expired: integer(0, 'Open items of type prescription_expired'),
        alert: integer(0, 'Open items of type alert'),
        human_request: integer(0, 'Open items of type human_request'),
        transfer_proposed: integer(0, 'Open items of type transfer_proposed'),
      })
      .meta({ id: 'QueueCountsByTypeDto', description: 'Open items by type' }),
  })
  .meta({ id: 'QueueCountsResponseDto' })
