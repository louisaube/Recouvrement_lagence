import { sql } from 'drizzle-orm'
import {
  bigint,
  bigserial,
  check,
  date,
  index,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { base } from '../../platform/database/base-schema'
import { importPreviews } from '../imports/imports.tables'
import { policyVersions } from '../policies/policies.tables'

export const CASE_STATES = ['open', 'negotiating', 'committed', 'frozen', 'supervisor_queue', 'transferred', 'settled'] as const
export const NATURES = ['family', 'company'] as const
export const TRANSFER_KINDS = ['external_collector', 'litigation', 'assignment'] as const
export const INVOICE_KINDS = ['invoice', 'credit_note'] as const
export const FREEZE_CODES = ['dispute', 'contestation', 'unassigned_payment'] as const
export const FREEZE_SCOPES = ['invoice', 'case'] as const
export type CaseState = (typeof CASE_STATES)[number]

const cents = (name: string) => bigint(name, { mode: 'number' })

/**
 * Debtor cases. rule-recouvrement-case-grouping: one case per debtor_id (UNIQUE).
 * rule-recouvrement-debtor-attributes: nature / SIREN / segment CHECKs.
 * `state` has a single writer, `CaseStateService.recompute`; the negotiable amount is computed in SQL, never stored.
 */
export const cases = base.table(
  'cases',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    debtorId: text('debtor_id').notNull().unique(),
    nature: text('nature').notNull(),
    debtorSiren: text('debtor_siren'),
    segment: text('segment').notNull(),
    state: text('state').notNull().default('open'),
    stateSince: timestamp('state_since', { withTimezone: true }).notNull().defaultNow(),
    transferredAt: timestamp('transferred_at', { withTimezone: true }),
    transferKind: text('transfer_kind'),
    authorizedCents: cents('authorized_cents'),
    firstSeenOn: date('first_seen_on', { mode: 'string' }).notNull(),
    firstSeenDueCents: cents('first_seen_due_cents').notNull(),
    /** Active policy version at the first appearance (indicator "collected / due"); plain FK, nullable. */
    firstPolicyVersionId: uuid('first_policy_version_id').references(() => policyVersions.id),
    rejectedTransferRule: text('rejected_transfer_rule'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('cases_debtor_id_check', sql`char_length(${table.debtorId}) between 1 and 50`),
    check('cases_nature_check', sql`${table.nature} in ('family', 'company')`),
    check('cases_debtor_siren_check', sql`(${table.nature} = 'company') = coalesce(${table.debtorSiren} ~ '^[0-9]{9}$', false)`),
    check('cases_segment_check', sql`${table.segment} ~ '^[a-z0-9][a-z0-9_-]{0,49}$'`),
    check(
      'cases_state_check',
      sql`${table.state} in ('open', 'negotiating', 'committed', 'frozen', 'supervisor_queue', 'transferred', 'settled')`,
    ),
    check('cases_transfer_kind_check', sql`${table.transferKind} is null or ${table.transferKind} in ('external_collector', 'litigation', 'assignment')`),
    index('cases_state_idx').on(table.state),
    index('cases_segment_idx').on(table.segment),
  ],
)

/**
 * Invoices and credit notes of a case. UNIQUE (creditor_siren, number).
 * Sign CHECKs: invoice amount > 0 and 0 <= balance <= amount; credit note amount < 0 and amount <= balance <= 0.
 * The check `due_date >= invoice_date` is a validation of the import, not a CHECK of the table (the acceptance suite moves
 * due dates in SQL to simulate lateness).
 */
export const invoices = base.table(
  'invoices',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    caseId: uuid('case_id')
      .notNull()
      .references(() => cases.id),
    kind: text('kind').notNull(),
    number: text('number').notNull(),
    creditorSiren: text('creditor_siren').notNull(),
    amountCents: cents('amount_cents').notNull(),
    /** Balance of the last snapshot. */
    importedBalanceCents: cents('imported_balance_cents').notNull(),
    /** Current balance = snapshot balance minus the payments applied after the extraction. */
    balanceCents: cents('balance_cents').notNull(),
    payer: text('payer'),
    invoiceDate: date('invoice_date', { mode: 'string' }).notNull(),
    dueDate: date('due_date', { mode: 'string' }).notNull(),
    channels: text('channels').array().notNull(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    firstSeenOn: date('first_seen_on', { mode: 'string' }).notNull(),
    firstSeenBalanceCents: cents('first_seen_balance_cents').notNull(),
    lastExtractionDate: date('last_extraction_date', { mode: 'string' }).notNull(),
  },
  (table) => [
    check('invoices_kind_check', sql`${table.kind} in ('invoice', 'credit_note')`),
    check('invoices_number_check', sql`char_length(${table.number}) between 1 and 50`),
    check('invoices_creditor_siren_check', sql`${table.creditorSiren} ~ '^[0-9]{9}$'`),
    check(
      'invoices_sign_check',
      sql`(${table.kind} = 'invoice' and ${table.amountCents} > 0 and ${table.balanceCents} between 0 and ${table.amountCents})
        or (${table.kind} = 'credit_note' and ${table.amountCents} < 0 and ${table.balanceCents} between ${table.amountCents} and 0)`,
    ),
    check(
      'invoices_bounds_check',
      sql`abs(${table.amountCents}) <= 10000000000 and abs(${table.importedBalanceCents}) <= 10000000000 and abs(${table.balanceCents}) <= 10000000000 and abs(${table.firstSeenBalanceCents}) <= 10000000000`,
    ),
    check('invoices_channels_check', sql`${table.channels} <@ array['voice', 'email_sms', 'mail']::text[]`),
    uniqueIndex('invoices_creditor_number_unique').on(table.creditorSiren, table.number),
    index('invoices_case_idx').on(table.caseId),
    index('invoices_number_prefix_idx').on(sql`lower(${table.number}) text_pattern_ops`),
  ],
)

/**
 * Freezes: one row each, never recomputed at read time. Partial unique index on the active ones.
 * source_id is the uuid of the dispute, the contestation or the payment allocation (no foreign key: three tables).
 */
export const freezes = base.table(
  'freezes',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    caseId: uuid('case_id')
      .notNull()
      .references(() => cases.id),
    code: text('code').notNull(),
    scope: text('scope').notNull(),
    invoiceId: uuid('invoice_id').references(() => invoices.id),
    sourceType: text('source_type').notNull(),
    sourceId: uuid('source_id').notNull(),
    reference: text('reference').notNull(),
    since: timestamp('since', { withTimezone: true }).notNull().defaultNow(),
    releasedAt: timestamp('released_at', { withTimezone: true }),
  },
  (table) => [
    check('freezes_code_check', sql`${table.code} in ('dispute', 'contestation', 'unassigned_payment')`),
    check('freezes_scope_check', sql`${table.scope} in ('invoice', 'case')`),
    check('freezes_invoice_scope_check', sql`(${table.scope} = 'invoice') = (${table.invoiceId} is not null)`),
    check('freezes_reference_check', sql`char_length(${table.reference}) between 1 and 100`),
    uniqueIndex('freezes_active_unique')
      .on(table.caseId, table.code, table.sourceType, table.sourceId)
      .where(sql`${table.releasedAt} is null`),
    index('freezes_case_idx').on(table.caseId),
  ],
)

/**
 * Journal of the state transitions of a case.
 * rule-recouvrement-state-transitions-logged: append-only (triggers of the migration `recouvrement_triggers`,
 * TRUNCATE allowed in `*_test` databases only, like audit_logs).
 */
export const caseStateHistory = base.table(
  'case_state_history',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    caseId: uuid('case_id')
      .notNull()
      .references(() => cases.id),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    fromState: text('from_state'),
    toState: text('to_state').notNull(),
    cause: text('cause').notNull(),
    actor: text('actor').notNull(),
    reference: text('reference'),
  },
  (table) => [
    check(
      'case_state_history_states_check',
      sql`${table.toState} in ('open', 'negotiating', 'committed', 'frozen', 'supervisor_queue', 'transferred', 'settled')
        and (${table.fromState} is null or ${table.fromState} in ('open', 'negotiating', 'committed', 'frozen', 'supervisor_queue', 'transferred', 'settled'))`,
    ),
    check('case_state_history_actor_check', sql`char_length(${table.actor}) between 1 and 200`),
    index('case_state_history_case_idx').on(table.caseId, table.id),
  ],
)

/** Confirmed receivable snapshots (the core keeps the confirmed row of `import_previews`). */
export const receivableSnapshots = base.table('receivable_snapshots', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  importId: uuid('import_id')
    .notNull()
    .references(() => importPreviews.id),
  extractionDate: date('extraction_date', { mode: 'string' }).notNull().unique(),
  controlTotalCents: cents('control_total_cents').notNull(),
  totalCents: cents('total_cents').notNull(),
  confirmedAt: timestamp('confirmed_at', { withTimezone: true }).notNull().defaultNow(),
})
