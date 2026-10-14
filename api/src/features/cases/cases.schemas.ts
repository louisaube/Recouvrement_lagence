import { z } from 'zod'
import { idParamsSchema, paginationQuerySchema } from '../../platform/validation/common'
import { centsInteger, dateString, instantString, integer, listOf, uuidField } from '../recovery-common/schemas'
import { CASE_STATES, FREEZE_CODES, INVOICE_KINDS, NATURES } from './cases.tables'

const SIREN = /^[0-9]{9}$/

export const caseStateSchema = z.enum(CASE_STATES).meta({ id: 'CaseStateDto', description: 'State of a case (referential of the states)' })
export const natureSchema = z.enum(NATURES).meta({ id: 'DebtorNatureDto', description: 'Nature of the debtor' })
const freezeCodeSchema = z.enum(FREEZE_CODES).meta({ id: 'FreezeCodeDto', description: 'Code of a freeze' })

/** rule-recouvrement-cases-supervisor-only. All filters are optional; `search` is a literal substring, case-insensitive. */
export const casesListQuerySchema = paginationQuerySchema.extend({
  state: caseStateSchema.optional().meta({ description: 'State of the case' }),
  nature: natureSchema.optional().meta({ description: 'Nature of the debtor' }),
  segment: z.string().min(1).max(50).optional().meta({ description: 'Segment of the debtor (1 to 50 characters)' }),
  creditor: z
    .string()
    .refine((v) => SIREN.test(v), 'Must be a SIREN of 9 digits')
    .optional()
    .meta({ description: 'SIREN of a creditor entity (9 digits)' }),
  search: z.string().min(1).max(50).optional().meta({ description: 'Part of the customer identifier, case-insensitive (1 to 50 characters)' }),
})
export type CasesListQuery = z.infer<typeof casesListQuerySchema>

export const caseSummarySchema = z
  .object({
    id: uuidField('Case ID'),
    debtorId: z.string().min(1).max(50).meta({ description: 'Customer identifier of the debtor' }),
    nature: natureSchema,
    segment: z.string().min(1).max(50).meta({ description: 'Segment of the debtor' }),
    creditors: z.array(z.string().meta({ description: 'SIREN of a creditor entity' })).max(1000).meta({ description: 'Creditor entities of the case, sorted' }),
    state: caseStateSchema,
    negotiableCents: integer(0, 'Negotiable amount in cents (rule-recouvrement-negotiable-amount)'),
    openBalanceCents: integer(0, 'Sum of the balances of the open invoices, in cents'),
    openInvoices: integer(0, 'Number of open invoices', 2147483647),
    maxDaysLate: integer(0, 'Greatest number of days late of an open invoice', 2147483647),
    updatedAt: instantString('Last change of the case'),
  })
  .meta({ id: 'CaseSummaryDto' })
export type CaseSummaryDto = z.infer<typeof caseSummarySchema>

export const casesListResponseSchema = listOf(caseSummarySchema, 'CasesListResponseDto', 'Cases of the page')

export const casesFiltersResponseSchema = z
  .object({
    segments: z.array(z.string().meta({ description: 'Segment' })).max(100000).meta({ description: 'Segments present in the cases, sorted' }),
    creditors: z.array(z.string().meta({ description: 'SIREN' })).max(100000).meta({ description: 'Creditor SIREN present in the cases, sorted' }),
  })
  .meta({ id: 'CasesFiltersResponseDto' })

export const invoiceSchema = z
  .object({
    id: uuidField('Invoice ID'),
    kind: z.enum(INVOICE_KINDS).meta({ id: 'InvoiceKindDto', description: 'Invoice or credit note' }),
    number: z.string().meta({ description: 'Invoice number' }),
    creditorSiren: z.string().meta({ description: 'SIREN of the creditor entity' }),
    amountCents: centsInteger('Amount in cents'),
    balanceCents: centsInteger('Current balance in cents (negative for a credit note)'),
    invoiceDate: dateString('Invoice date'),
    dueDate: dateString('Due date'),
    daysLate: integer(0, 'Days late (0 when not due or not open)', 2147483647),
    frozen: z.boolean().meta({ description: 'The invoice carries an active freeze' }),
    freezeCodes: z.array(freezeCodeSchema).max(3).meta({ description: 'Codes of the active freezes that concern the invoice' }),
    prescription: z.enum(['none', 'near', 'expired']).meta({ id: 'PrescriptionDto', description: 'Prescription status' }),
    prescriptionDate: dateString('Prescription date').nullable(),
    coveredByOutputsCents: integer(0, 'Part covered by accounting outputs not yet noted, in cents'),
    negotiable: z.boolean().meta({ description: 'The balance enters the negotiable amount' }),
  })
  .meta({ id: 'InvoiceDto' })

export const freezeSchema = z
  .object({
    code: freezeCodeSchema,
    scope: z.enum(['invoice', 'case']).meta({ id: 'FreezeScopeDto', description: 'Scope of the freeze' }),
    invoiceNumber: z.string().nullable().meta({ description: 'Number of the invoice (scope invoice)' }),
    since: instantString('Start of the freeze'),
    reference: z.string().min(1).max(100).meta({ description: 'Reason of the dispute, reference of the payment' }),
  })
  .meta({ id: 'FreezeDto' })

const installmentSchema = z.object({ dueDate: dateString('Due date'), amountCents: integer(0, 'Amount in cents') })

export const unlockedOfferSchema = z
  .object({
    id: uuidField('Offer ID'),
    unlockedAt: instantString('Instant the offer was unlocked'),
    status: z.enum(['current', 'superseded', 'accepted', 'revoked']).meta({ description: 'Status of the offer' }),
    totalCents: integer(0, 'Total to pay, in cents'),
    discountCents: integer(0, 'Discount granted, in cents'),
    installments: z.array(installmentSchema).max(60).meta({ description: 'Installments' }),
    counterpart: z
      .object({
        type: z.string().meta({ description: 'Type of counterpart' }),
        deadlineDate: dateString('Deadline').nullable(),
        firstPaymentCents: integer(0, 'First payment in cents').nullable(),
      })
      .nullable()
      .meta({ description: 'Counterpart asked for the offer' }),
    conversationId: z.string().nullable().meta({ description: 'Conversation that unlocked the offer' }),
  })
  .meta({ id: 'UnlockedOfferDto' })

export const commitmentSchema = z
  .object({
    id: uuidField('Commitment ID'),
    createdAt: instantString('Registration instant'),
    status: z.enum(['pending', 'held', 'broken']).meta({ description: 'Status of the commitment' }),
    offerId: uuidField('Offer ID'),
    totalCents: integer(0, 'Total, in cents'),
    discountCents: integer(0, 'Discount, in cents'),
    paymentMethod: z.string().meta({ description: 'Payment method' }),
    installments: z
      .array(z.object({ dueDate: dateString('Due date'), amountCents: integer(0, 'Amount in cents'), paidCents: integer(0, 'Paid in cents') }))
      .max(60)
      .meta({ description: 'Installments' }),
    channel: z.string().meta({ description: 'Channel of the agent' }),
    agentVersion: z.string().meta({ description: 'Version of the agent' }),
    conversationId: z.string().meta({ description: 'Conversation' }),
  })
  .meta({ id: 'CommitmentDto' })

/** Accounting output of a case; the table and its routes come with the lot of the outputs. */
export const ledgerOutputSchema = z
  .object({
    id: uuidField('Output ID'),
    kind: z.string().meta({ description: 'Kind of output' }),
    status: z.string().meta({ description: 'Status of the output' }),
    amountCents: centsInteger('Amount in cents'),
    reference: z.string().nullable().meta({ description: 'Output reference' }),
  })
  .meta({ id: 'LedgerOutputDto' })

export const caseDetailSchema = caseSummarySchema
  .extend({
    debtorSiren: z.string().nullable().meta({ description: 'SIREN of the debtor (company only)' }),
    invoices: z.array(invoiceSchema).max(100000).meta({ description: 'Invoices and credit notes of the case' }),
    freezes: z.array(freezeSchema).max(100000).meta({ description: 'Active freezes' }),
    unlockedOffers: z.array(unlockedOfferSchema).max(1000).meta({ description: 'Offers unlocked' }),
    commitments: z.array(commitmentSchema).max(1000).meta({ description: 'Commitments' }),
    ledgerOutputs: z.array(ledgerOutputSchema).max(10000).meta({ description: 'Accounting outputs' }),
    openQueueItems: z
      .array(z.object({ id: uuidField('Item ID'), type: z.string().meta({ description: 'Type of the item' }) }))
      .max(1000)
      .meta({ description: 'Open items of the queue about the case' }),
    activePolicy: z
      .object({ id: uuidField('Policy version ID'), label: z.string().meta({ description: 'Label' }) })
      .nullable()
      .meta({ description: 'Active policy version' }),
  })
  .meta({ id: 'CaseDetailDto' })

export const caseResponseSchema = z.object({ case: caseDetailSchema }).meta({ id: 'CaseResponseDto' })

export const caseIdParamsSchema = idParamsSchema
export type CaseIdParams = z.infer<typeof caseIdParamsSchema>

export const casePageQuerySchema = paginationQuerySchema
export type CasePageQuery = z.infer<typeof casePageQuerySchema>

const nameValue = z.object({
  name: z.string().min(1).max(100).meta({ description: 'Name' }),
  value: z.string().max(500).meta({ description: 'Value' }),
})

export const decisionSchema = z
  .object({
    id: uuidField('Decision ID'),
    decidedAt: instantString('Instant of the decision'),
    kind: z
      .enum(['daily_action', 'offer', 'commitment_check', 'threshold', 'prescription', 'exposure_ceiling'])
      .meta({ id: 'DecisionKindDto', description: 'Kind of decision' }),
    outcome: z.string().min(1).max(100).meta({ description: 'Outcome' }),
    ruleId: z.string().min(1).max(100).nullable().meta({ description: 'Rule applied' }),
    policyVersion: z
      .object({ id: uuidField('Policy version ID'), label: z.string().meta({ description: 'Label' }) })
      .nullable()
      .meta({ description: 'Policy version in force' }),
    probability: z.number().min(0).max(1).meta({ description: 'Probability of the decision (1 while the table is deterministic)' }),
    inputs: z.array(nameValue).max(200).meta({ description: 'Complete inputs of the decision' }),
    internalReason: z.array(nameValue).max(200).meta({ description: 'Internal reason, readable by the supervisor only' }),
    batchId: uuidField('Batch').nullable(),
  })
  .meta({ id: 'DecisionDto' })
export const decisionsListResponseSchema = listOf(decisionSchema, 'DecisionsListResponseDto', 'Decisions of the page, most recent first')

export const stateTransitionSchema = z
  .object({
    at: instantString('Instant of the transition'),
    from: caseStateSchema.nullable(),
    to: caseStateSchema,
    cause: z.string().min(1).max(50).meta({ description: 'Cause of the transition' }),
    actor: z.string().min(1).max(200).meta({ description: 'Actor of the transition' }),
    reference: z.string().nullable().meta({ description: 'Business reference' }),
  })
  .meta({ id: 'StateTransitionDto' })
export const stateHistoryResponseSchema = listOf(stateTransitionSchema, 'StateHistoryResponseDto', 'Transitions of the page, most recent first')

export const invoicesSearchQuerySchema = paginationQuerySchema.extend({
  number: z.string().min(1).max(50).meta({ description: 'Beginning of the invoice number, case-insensitive (1 to 50 characters)' }),
})
export type InvoicesSearchQuery = z.infer<typeof invoicesSearchQuerySchema>

export const invoiceRefSchema = z
  .object({
    id: uuidField('Invoice ID'),
    caseId: uuidField('Case ID'),
    debtorId: z.string().meta({ description: 'Customer identifier' }),
    number: z.string().meta({ description: 'Invoice number' }),
    creditorSiren: z.string().meta({ description: 'SIREN of the creditor entity' }),
    balanceCents: integer(1, 'Balance in cents'),
    frozen: z.boolean().meta({ description: 'The invoice carries an active freeze' }),
  })
  .meta({ id: 'InvoiceRefDto' })
export const invoicesSearchResponseSchema = listOf(invoiceRefSchema, 'InvoicesSearchResponseDto', 'Open invoices of the page')
