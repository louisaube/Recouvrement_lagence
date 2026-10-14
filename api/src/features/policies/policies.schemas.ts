import { z } from 'zod'
import { idParamsSchema, paginationQuerySchema, uuidFormat } from '../../platform/validation/common'
import { CASE_STATES } from '../cases/cases.tables'
import { dateString, instantString, integer, listOf, uuidField } from '../recovery-common/schemas'
import { POLICY_STATUSES } from './policies.tables'

// ---------------------------------------------------------------------------------------------------------------------
// The policy file (pivot format, rule-recouvrement-policy-format). Internal: it is read from a JSON upload and never
// appears in the OpenAPI document. Every key is strict, every bound is the one of the specification.
// ---------------------------------------------------------------------------------------------------------------------

const DATE = /^\d{4}-\d{2}-\d{2}$/
const SEGMENT = /^[a-z0-9][a-z0-9_-]{0,49}$/
const AGENT_VERSION = /^[A-Za-z0-9._-]{1,50}$/
const PAYMENT_METHOD = /^[a-z][a-z0-9_]{0,29}$/

export const POLICY_ACTIONS = ['none', 'reminder', 'proposal', 'transfer_proposed'] as const
export const NEXT_STEP_KINDS = ['external_collector', 'litigation', 'assignment'] as const
export const COUNTERPART_TYPES = ['firm_date', 'first_payment', 'direct_debit'] as const
export const REQUIRED_DOCUMENTS = ['contract', 'order', 'delivery_proof'] as const

const whole = (min: number, max: number) => z.number().int().min(min).max(max)
const basisPoints = whole(0, 10_000)

const counterpartFile = z.strictObject({
  type: z.enum(COUNTERPART_TYPES),
  deadlineDays: whole(1, 365).optional(),
  firstPaymentBp: whole(1, 10_000).optional(),
})

const rungFile = z
  .strictObject({
    offerKind: z.enum(['lump_sum', 'schedule']),
    valueBp: basisPoints,
    payByDays: whole(0, 365),
    installments: z.strictObject({ count: whole(2, 60), intervalDays: whole(1, 365) }).optional(),
    delayFeeBp: basisPoints.default(0),
    counterpart: counterpartFile.optional(),
  })
  .superRefine((rung, ctx) => {
    if (rung.offerKind === 'schedule' && !rung.installments) {
      ctx.addIssue({ code: 'custom', path: ['installments'], message: 'installments is required for a schedule offer' })
    }
    if (rung.offerKind === 'lump_sum' && rung.installments) {
      ctx.addIssue({ code: 'custom', path: ['installments'], message: 'installments must be absent for a lump_sum offer' })
    }
  })

const ruleFile = z.strictObject({
  segment: z.string().regex(SEGMENT),
  nature: z.enum(['family', 'company']),
  horizonDays: whole(1, 3650),
  nextStep: z.strictObject({ kind: z.enum(NEXT_STEP_KINDS), expectedValueBp: basisPoints }),
  ladder: z.array(rungFile).min(1).max(20),
  maxScheduleDays: whole(0, 3650),
  thresholdCents: whole(0, 10_000_000_000),
  requiredDocuments: z.array(z.enum(REQUIRED_DOCUMENTS)).max(3),
  limitation: z.strictObject({
    delayDays: whole(1, 36_500),
    startsFrom: z.enum(['invoice_date', 'due_date']),
    alertDays: whole(0, 36_500),
  }),
})

const globalFile = z.strictObject({
  statementMaxAgeDays: whole(0, 3650),
  ledgerMaxImports: whole(1, 100),
  reviewSampleSize: whole(1, 10_000),
  paymentMethods: z.array(z.string().regex(PAYMENT_METHOD)).min(1).max(20),
  decisionTypeCapsBp: z.strictObject({
    none: basisPoints,
    reminder: basisPoints,
    proposal: basisPoints,
    transfer_proposed: basisPoints,
  }),
  exposureCeilings: z
    .array(
      z.strictObject({
        agentVersion: z.union([z.literal('*'), z.string().regex(AGENT_VERSION)]),
        segment: z.union([z.literal('*'), z.string().regex(SEGMENT)]),
        maxCents: whole(0, Number.MAX_SAFE_INTEGER),
      }),
    )
    .max(500),
})

const witnessInput = z.strictObject({
  segment: z.string().regex(SEGMENT),
  nature: z.enum(['family', 'company']),
  state: z.enum(CASE_STATES),
  daysLateMax: whole(0, 2_147_483_647),
  negotiableCents: whole(0, Number.MAX_SAFE_INTEGER),
})

const witnessFile = z.strictObject({
  id: z.string().min(1).max(50),
  description: z.string().min(1).max(200),
  input: witnessInput,
  expected: z.strictObject({ action: z.enum(POLICY_ACTIONS), rule: z.string().min(1).max(100) }),
})

export const policyFileSchema = z.strictObject({
  label: z.string().min(1).max(100),
  versionDate: z
    .string()
    .regex(DATE)
    .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v), 'Not a calendar date'),
  decision: z.record(z.string(), z.unknown()),
  parameters: z.strictObject({
    global: globalFile,
    rules: z
      .array(ruleFile)
      .min(1)
      .max(1000)
      .refine((rules) => new Set(rules.map((r) => `${r.segment}/${r.nature}`)).size === rules.length, 'rules: one rule per segment and nature pair'),
  }),
  witnesses: z
    .array(witnessFile)
    .min(1)
    .max(200)
    .refine((list) => new Set(list.map((w) => w.id)).size === list.length, 'witnesses: ids must be unique'),
})

export type PolicyFile = z.infer<typeof policyFileSchema>
export type PolicyRuleFile = PolicyFile['parameters']['rules'][number]
export type PolicyRungFile = PolicyRuleFile['ladder'][number]
export type PolicyWitnessFile = PolicyFile['witnesses'][number]

// ---------------------------------------------------------------------------------------------------------------------
// Contract (OpenAPI)
// ---------------------------------------------------------------------------------------------------------------------

export const policyStatusSchema = z.enum(POLICY_STATUSES).meta({ id: 'PolicyStatusDto', description: 'Status of a policy version' })

const accountRef = z.object({ id: uuidField('Account ID'), email: z.string().meta({ description: 'E-mail of the account' }) })

export const policyVersionSchema = z
  .object({
    id: uuidField('Version ID'),
    label: z.string().min(1).max(100).meta({ description: 'Label of the version' }),
    versionDate: dateString('Date of the version'),
    status: policyStatusSchema,
    fileHash: z.string().length(64).meta({ description: 'SHA-256 of the file, hexadecimal' }),
    importedBy: accountRef.meta({ description: 'Supervisor who imported the file' }),
    importedAt: instantString('Import instant'),
    activatedBy: accountRef.nullable().meta({ description: 'Supervisor who activated the version' }),
    activatedAt: instantString('Activation instant').nullable(),
    checksPassed: z.boolean().nullable().meta({ description: 'Result of the six checks at the import (imported versions only)' }),
  })
  .meta({ id: 'PolicyVersionDto' })
export type PolicyVersionDto = z.infer<typeof policyVersionSchema>

export const policyCheckSchema = z
  .object({
    code: z
      .enum(['floor', 'decreasing_concessions', 'counterparts', 'schedule_limits', 'segments_covered', 'witnesses'])
      .meta({ id: 'PolicyCheckCodeDto', description: 'Code of the check' }),
    passed: z.boolean().meta({ description: 'The check passes' }),
    problems: z.array(z.string().min(1).max(300).meta({ description: 'Problem found' })).max(50).meta({ description: 'Problems found (empty when passed)' }),
  })
  .meta({ id: 'PolicyCheckDto' })
export type PolicyCheckDto = z.infer<typeof policyCheckSchema>

const actionRule = z.object({
  action: z.string().meta({ description: 'Action' }),
  rule: z.string().meta({ description: 'Rule identifier' }),
})

export const policyWitnessResultSchema = z
  .object({
    id: z.string().min(1).max(50).meta({ description: 'Witness ID' }),
    description: z.string().min(1).max(200).meta({ description: 'Description' }),
    expected: actionRule.meta({ description: 'Expected result' }),
    obtained: actionRule.nullable().meta({ description: 'Result given by the engine (null when it failed)' }),
    passed: z.boolean().meta({ description: 'The engine gives exactly the expected result' }),
  })
  .meta({ id: 'PolicyWitnessResultDto' })
export type PolicyWitnessResultDto = z.infer<typeof policyWitnessResultSchema>

export const policyRungSchema = z
  .object({
    rank: integer(1, 'Rank of the offer in the ladder (1 is the most favourable)', 20),
    offerKind: z.enum(['lump_sum', 'schedule']).meta({ description: 'Kind of offer' }),
    valueBp: integer(0, 'Sum to pay, in basis points of the negotiable amount', 10000),
    payByDays: integer(0, 'Days before the first payment', 365),
    installments: z
      .object({ count: integer(2, 'Number of installments', 60), intervalDays: integer(1, 'Days between installments', 365) })
      .nullable()
      .meta({ description: 'Installments (schedule offers)' }),
    delayFeeBp: integer(0, 'Fee or interest on a delay, in basis points', 10000),
    counterpart: z
      .object({
        type: z.enum(COUNTERPART_TYPES).meta({ description: 'Type of counterpart' }),
        deadlineDays: integer(1, 'Days to the deadline (firm_date)', 365).nullable(),
        firstPaymentBp: integer(1, 'First payment in basis points (first_payment)', 10000).nullable(),
      })
      .nullable()
      .meta({ description: 'Counterpart asked for the offer' }),
  })
  .meta({ id: 'PolicyRungDto' })

export const policyRuleSchema = z
  .object({
    segment: z.string().meta({ description: 'Segment' }),
    nature: z.enum(['family', 'company']).meta({ description: 'Nature of the debtor' }),
    horizonDays: integer(1, 'Horizon in days', 3650),
    nextStep: z.object({
      kind: z.enum(NEXT_STEP_KINDS).meta({ description: 'Kind of next step' }),
      expectedValueBp: integer(0, 'Expected value of the next step (the floor), in basis points', 10000),
    }),
    ladder: z.array(policyRungSchema).max(20).meta({ description: 'Offers, from the most to the least favourable' }),
    maxScheduleDays: integer(0, 'Longest duration of a schedule', 3650),
    thresholdCents: integer(0, 'Negotiable amount above which the negotiation stops, in cents', 10_000_000_000),
    requiredDocuments: z.array(z.enum(REQUIRED_DOCUMENTS)).max(3).meta({ description: 'Supporting documents required' }),
    limitation: z.object({
      delayDays: integer(1, 'Days of the limitation period', 36500),
      startsFrom: z.enum(['invoice_date', 'due_date']).meta({ description: 'Starting point of the period' }),
      alertDays: integer(0, 'Days before the end of the period that raise the alert', 36500),
    }),
  })
  .meta({ id: 'PolicyRuleDto' })

export const policyGlobalSchema = z
  .object({
    statementMaxAgeDays: integer(0, 'Oldest accepted bank statement, in days', 3650),
    ledgerMaxImports: integer(1, 'Receivable imports after which an approved output not noted becomes a gap', 100),
    reviewSampleSize: integer(1, 'Size of a review sample', 10000),
    paymentMethods: z.array(z.string().meta({ description: 'Payment method code' })).min(1).max(20).meta({ description: 'Payment methods' }),
    decisionTypeCapsBp: z.object({
      none: integer(0, 'Cap of the share in a batch, in basis points', 10000),
      reminder: integer(0, 'Cap of the share in a batch, in basis points', 10000),
      proposal: integer(0, 'Cap of the share in a batch, in basis points', 10000),
      transfer_proposed: integer(0, 'Cap of the share in a batch, in basis points', 10000),
    }),
    exposureCeilings: z
      .array(
        z.object({
          agentVersion: z.string().meta({ description: 'Version of the agent, or *' }),
          segment: z.string().meta({ description: 'Segment, or *' }),
          maxCents: integer(0, 'Ceiling in cents'),
        }),
      )
      .max(500)
      .meta({ description: 'Exposure ceilings' }),
  })
  .meta({ id: 'PolicyGlobalDto' })

export const policyVersionDetailSchema = policyVersionSchema
  .extend({
    global: policyGlobalSchema,
    rules: z.array(policyRuleSchema).max(1000).meta({ description: 'Rules, by segment then nature' }),
    checks: z.array(policyCheckSchema).max(6).meta({ description: 'The six checks, recomputed at the reading' }),
    witnesses: z.array(policyWitnessResultSchema).max(200).meta({ description: 'Results of the witness cases' }),
  })
  .meta({ id: 'PolicyVersionDetailDto' })

export const policyPreviewSchema = z
  .object({
    previewId: uuidField('Preview ID'),
    fileName: z.string().meta({ description: 'Name of the file' }),
    fileHash: z.string().length(64).meta({ description: 'SHA-256 of the file' }),
    valid: z.boolean().meta({ description: 'The file respects the format' }),
    errors: z
      .array(
        z.object({
          path: z.string().min(1).max(200).meta({ description: 'JSON path' }),
          reason: z.string().min(1).max(300).meta({ description: 'Reason' }),
        }),
      )
      .max(100)
      .meta({ description: 'Faults of the file' }),
    label: z.string().nullable().meta({ description: 'Label (valid file)' }),
    versionDate: dateString('Date of the version').nullable(),
    global: policyGlobalSchema.nullable(),
    rules: z.array(policyRuleSchema).max(1000),
    checks: z.array(policyCheckSchema).max(6),
    witnesses: z.array(policyWitnessResultSchema).max(200),
  })
  .meta({ id: 'PolicyPreviewDto' })
export type PolicyPreviewDto = z.infer<typeof policyPreviewSchema>

export const policyVersionResponseSchema = z.object({ version: policyVersionSchema }).meta({ id: 'PolicyVersionResponseDto' })
export const policyVersionDetailResponseSchema = z.object({ version: policyVersionDetailSchema }).meta({ id: 'PolicyVersionDetailResponseDto' })
export const policyVersionsListResponseSchema = listOf(policyVersionSchema, 'PolicyVersionsListResponseDto', 'Versions of the page')

export const policyVersionsQuerySchema = paginationQuerySchema.extend({
  status: policyStatusSchema.optional().meta({ description: 'Status of the versions' }),
})
export type PolicyVersionsQuery = z.infer<typeof policyVersionsQuerySchema>

export const policyVersionParamsSchema = idParamsSchema
export type PolicyVersionParams = z.infer<typeof policyVersionParamsSchema>

export const policyPreviewParamsSchema = z.object({ previewId: uuidFormat().meta({ description: 'Preview ID' }) })
export type PolicyPreviewParams = z.infer<typeof policyPreviewParamsSchema>
