import { z } from 'zod'
import { idParamsSchema, paginationQuerySchema } from '../../platform/validation/common'
import { accountRefSchema, dateString, instantString, integer, listOf, uuidField } from '../recovery-common/schemas'
import { BATCH_STATUSES, ORDER_KINDS, ORDER_STATUSES } from './batches.tables'
import { DECISION_TYPES, MAX_PROBLEM_LENGTH, MAX_PROBLEMS, MAX_REASON_LENGTH } from './batches.constants'

const CHANNELS = ['voice', 'email_sms', 'mail'] as const
const ROLES = ['accounts_payable', 'buyer', 'approver', 'payer'] as const
const EXCLUSION_REASONS = [
  'documents_missing',
  'channel_suspended',
  'channel_not_authorized',
  'no_contact',
  'frozen',
  'statement_stale',
  'covered_by_outputs',
] as const
const CHECK_CODES = ['statement_fresh', 'witnesses_replayed', 'decision_share', 'no_duplicate_order'] as const

export const batchStatusSchema = z.enum(BATCH_STATUSES).meta({ id: 'BatchStatusDto', description: 'Status of a daily batch' })
export const orderKindSchema = z.enum(ORDER_KINDS).meta({ id: 'OrderTypeDto', description: 'Type of a send order' })
export const orderStatusSchema = z.enum(ORDER_STATUSES).meta({ id: 'OrderStatusDto', description: 'Status of a send order' })
const channelSchema = z.enum(CHANNELS).meta({ id: 'OrderChannelDto', description: 'Channel of a send order' })

export const batchCheckSchema = z
  .object({
    code: z.enum(CHECK_CODES).meta({ description: 'Code of the check' }),
    status: z.enum(['passed', 'failed']).meta({ description: 'Result of the check' }),
    problems: z
      .array(z.string().min(1).max(MAX_PROBLEM_LENGTH).meta({ description: 'Problem found, in French' }))
      .max(MAX_PROBLEMS)
      .meta({ description: 'Problems found (at most 50)' }),
  })
  .meta({ id: 'BatchCheckDto' })
export type BatchCheckDto = z.infer<typeof batchCheckSchema>

export const decisionShareSchema = z
  .object({
    type: z.enum(DECISION_TYPES).meta({ description: 'Type of decision' }),
    count: integer(0, 'Number of decisions of this type in the batch', 2147483647),
    shareBp: integer(0, 'Share of the decided cases, in basis points', 10000),
    mode: z.enum(['fixed_cap', 'statistical']).meta({ description: 'Fixed cap of the policy before ten previous batches, statistical after' }),
    capBp: integer(0, 'Fixed cap of the type, in basis points (fixed_cap mode)', 10000).nullable(),
    meanBp: z.number().nullable().meta({ description: 'Mean share of the previous batches, in basis points (statistical mode)' }),
    sigmaBp: z.number().nullable().meta({ description: 'Standard deviation of the population of the previous batches (statistical mode)' }),
    thresholdBp: z.number().nullable().meta({ description: 'Three standard deviations (statistical mode)' }),
    exceeded: z.boolean().meta({ description: 'The share blocks the batch' }),
  })
  .meta({ id: 'DecisionShareDto' })
export type DecisionShareDto = z.infer<typeof decisionShareSchema>

export const batchExclusionSchema = z
  .object({
    reason: z.enum(EXCLUSION_REASONS).meta({ description: 'Reason why the cases received no order' }),
    count: integer(0, 'Number of cases excluded for this reason', 2147483647),
  })
  .meta({ id: 'BatchExclusionDto' })

export const batchOrderCountSchema = z
  .object({ type: orderKindSchema, count: integer(0, 'Number of orders of this type', 2147483647) })
  .meta({ id: 'BatchOrderCountDto' })

export const dailyBatchSummarySchema = z
  .object({
    id: uuidField('Batch ID'),
    date: dateString('Date of the batch'),
    status: batchStatusSchema,
    preparedBy: accountRefSchema.meta({ description: 'Supervisor who prepared the batch' }),
    createdAt: instantString('Preparation instant'),
    caseCount: integer(0, 'Number of cases decided', 2147483647),
    orderCount: integer(0, 'Number of orders of the batch', 2147483647),
    failedChecks: integer(0, 'Number of checks in failure', 4),
    releasedBy: accountRefSchema.nullable().meta({ description: 'Supervisor who released a blocked batch (null for an automatic release)' }),
    releasedAt: instantString('Release instant').nullable(),
  })
  .meta({ id: 'DailyBatchSummaryDto' })

export const dailyBatchDetailSchema = dailyBatchSummarySchema
  .extend({
    checks: z.array(batchCheckSchema).max(4).meta({ description: 'The four checks' }),
    shares: z.array(decisionShareSchema).max(4).meta({ description: 'Share of each type of decision' }),
    excluded: z.array(batchExclusionSchema).max(7).meta({ description: 'Cases that received no order, by reason' }),
    ordersByType: z.array(batchOrderCountSchema).max(3).meta({ description: 'Orders by type' }),
    releaseReason: z.string().min(1).max(MAX_REASON_LENGTH).nullable().meta({ description: 'Reason of the release decision' }),
    replacedBy: uuidField('Batch that replaced this one').nullable(),
    policyVersion: z
      .object({ id: uuidField('Policy version ID'), label: z.string().min(1).max(100).meta({ description: 'Label of the version' }) })
      .nullable()
      .meta({ description: 'Version of the policy that decided the batch' }),
  })
  .meta({ id: 'DailyBatchDetailDto' })
export type DailyBatchDetailDto = z.infer<typeof dailyBatchDetailSchema>

export const orderConditionSchema = z
  .object({
    name: z.string().min(1).max(100).meta({ description: 'Name of the condition' }),
    value: z.string().max(300).meta({ description: 'Value of the condition (amount, due date, offer)' }),
  })
  .meta({ id: 'OrderConditionDto' })

export const orderSchema = z
  .object({
    id: uuidField('Order ID'),
    type: orderKindSchema,
    status: orderStatusSchema,
    caseId: uuidField('Case ID'),
    debtorId: z.string().min(1).max(50).meta({ description: 'Customer identifier' }),
    interlocutorId: uuidField('Interlocutor ID'),
    interlocutorRole: z.enum(ROLES).meta({ description: 'Role of the interlocutor' }),
    channel: channelSchema,
    conditions: z.array(orderConditionSchema).meta({ description: 'Amounts, due dates, offer: never a drafted text' }),
    blockReason: z.string().min(1).max(300).nullable().meta({ description: 'Why the order is blocked' }),
    orderDate: dateString('Date of the order'),
    batchId: uuidField('Batch ID').nullable(),
  })
  .meta({ id: 'OrderDto' })
export type OrderDto = z.infer<typeof orderSchema>

export const batchesListQuerySchema = paginationQuerySchema
export type BatchesListQuery = z.infer<typeof batchesListQuerySchema>
export const batchesListResponseSchema = listOf(dailyBatchSummarySchema, 'DailyBatchesListResponseDto', 'Batches of the page')

export const batchParamsSchema = idParamsSchema
export type BatchParams = z.infer<typeof batchParamsSchema>

export const batchResponseSchema = z.object({ batch: dailyBatchDetailSchema }).meta({ id: 'DailyBatchResponseDto' })

export const batchOrdersQuerySchema = paginationQuerySchema.extend({
  type: orderKindSchema.optional().meta({ description: 'Only the orders of this type' }),
  channel: channelSchema.optional().meta({ description: 'Only the orders of this channel' }),
})
export type BatchOrdersQuery = z.infer<typeof batchOrdersQuerySchema>
export const batchOrdersResponseSchema = listOf(orderSchema, 'BatchOrdersListResponseDto', 'Orders of the page')

/** rule-recouvrement-batch-blocked-release-by-decision: the reason is trimmed, 1 to 1000 characters, the body strict. */
export const releaseBatchBodySchema = z
  .strictObject({
    reason: z
      .string()
      .trim()
      .min(1)
      .max(MAX_REASON_LENGTH)
      .meta({ description: 'Reason of the decision (1 to 1000 characters once trimmed)' }),
  })
  .meta({ id: 'ReleaseBatchParamsDto', additionalProperties: undefined })
export type ReleaseBatchBody = z.infer<typeof releaseBatchBodySchema>
