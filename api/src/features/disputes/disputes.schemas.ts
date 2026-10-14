import { z } from 'zod'
import { idParamsSchema, paginationQuerySchema, uuidFormat } from '../../platform/validation/common'
import { caseStateSchema, natureSchema } from '../cases/cases.schemas'
import { instantString, integer, listOf, uuidField } from '../recovery-common/schemas'
import { DISPUTE_ORIGINS } from './disputes.tables'

const originSchema = z.enum(DISPUTE_ORIGINS).meta({ id: 'DisputeOriginDto', description: 'Origin of the dispute: import, contestation (conversation) or service (opened by the litigation service)' })

/** rule-recouvrement-disputes-litigation-only. `status` defaults to the open disputes. */
export const disputesListQuerySchema = paginationQuerySchema.extend({
  status: z.enum(['open', 'closed', 'all']).default('open').meta({ description: 'Open disputes (default), closed ones or all' }),
  origin: originSchema.optional().meta({ description: 'Only the disputes of this origin' }),
  search: z.string().min(1).max(50).optional().meta({ description: 'Invoice number or customer identifier, case-insensitive substring (1 to 50 characters)' }),
})
export type DisputesListQuery = z.infer<typeof disputesListQuerySchema>

export const disputeParamsSchema = idParamsSchema
export type DisputeParams = z.infer<typeof disputeParamsSchema>

export const disputeInvoicesQuerySchema = paginationQuerySchema.extend({
  number: z.string().min(1).max(50).meta({ description: 'Beginning of the invoice number, case-insensitive (1 to 50 characters)' }),
})
export type DisputeInvoicesQuery = z.infer<typeof disputeInvoicesQuerySchema>

export const disputeInvoiceSchema = z
  .object({
    id: uuidField('Invoice ID'),
    number: z.string().min(1).max(50).meta({ description: 'Invoice number' }),
    creditorSiren: z.string().regex(/^[0-9]{9}$/).meta({ description: 'SIREN of the creditor entity' }),
    debtorId: z.string().min(1).max(100).meta({ description: 'Customer identifier' }),
    balanceCents: integer(0, 'Balance in cents'),
    frozen: z.boolean().meta({ description: 'The invoice carries an active freeze' }),
  })
  .meta({ id: 'DisputeInvoiceDto' })
export const disputeInvoicesResponseSchema = listOf(disputeInvoiceSchema, 'DisputeInvoicesResponseDto', 'Open invoices of the page, sorted by number')

export const disputeSchema = z
  .object({
    id: uuidField('Dispute ID'),
    status: z.enum(['open', 'closed']).meta({ description: 'The dispute is open or closed' }),
    origin: originSchema,
    invoiceNumber: z.string().min(1).max(50).meta({ description: 'Number of the invoice in dispute' }),
    creditorSiren: z.string().regex(/^[0-9]{9}$/).meta({ description: 'SIREN of the creditor entity' }),
    balanceCents: integer(0, 'Balance of the invoice in cents'),
    debtorId: z.string().min(1).max(100).meta({ description: 'Customer identifier' }),
    caseId: uuidField('Case ID'),
    caseState: caseStateSchema,
    reason: z.string().min(1).max(500).meta({ description: 'Reason of the dispute (plain text)' }),
    owner: z.string().min(1).max(100).meta({ description: 'Person in charge (plain text)' }),
    openedAt: instantString('Opening instant'),
    closedAt: instantString('Closing instant').nullable(),
  })
  .meta({ id: 'DisputeDto' })
export const disputesListResponseSchema = listOf(disputeSchema, 'DisputesListResponseDto', 'Disputes of the page')

const accountRefSchema = z.object({ id: uuidFormat().meta({ description: 'Account ID' }), email: z.string().meta({ description: 'E-mail of the account' }) })

export const disputeDetailSchema = disputeSchema
  .extend({
    invoice: disputeInvoiceSchema,
    case: z.object({
      id: uuidField('Case ID'),
      debtorId: z.string().min(1).max(100).meta({ description: 'Customer identifier' }),
      nature: natureSchema,
      state: caseStateSchema,
      openInvoices: integer(0, 'Open invoices of the case'),
      frozenInvoices: integer(0, 'Open invoices of the case that carry a freeze'),
    }),
    closeNote: z.string().min(1).max(500).nullable().meta({ description: 'Note of the closing (plain text)' }),
    closedBy: accountRefSchema.nullable().meta({ description: 'Who closed the dispute' }),
    openedBy: accountRefSchema.nullable().meta({ description: 'Who opened the dispute (null: import or agent)' }),
    contestation: z
      .object({
        id: uuidField('Contestation ID'),
        channel: z.string().min(1).max(50).meta({ description: 'Channel of the conversation' }),
        conversationId: z.string().min(1).max(100).meta({ description: 'Conversation of the contestation' }),
        statedAt: instantString('Instant of the contestation'),
        text: z.string().min(1).max(1000).meta({ description: 'Text of the contestation (plain text)' }),
      })
      .nullable()
      .meta({ description: 'The contestation behind the dispute (origin contestation)' }),
  })
  .meta({ id: 'DisputeDetailDto' })
export const disputeResponseSchema = z.object({ dispute: disputeDetailSchema }).meta({ id: 'DisputeResponseDto' })
