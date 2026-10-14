import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { base } from '../../platform/database/base-schema'
import { cases, invoices } from '../cases/cases.tables'
import { importPreviews } from '../imports/imports.tables'

const cents = (name: string) => bigint(name, { mode: 'number' })

export const REPORT_CATEGORIES = ['new', 'settled', 'modified', 'removed'] as const
export type ReportCategory = (typeof REPORT_CATEGORIES)[number]
export const CONTACT_ROLES = ['accounts_payable', 'buyer', 'approver', 'payer'] as const
export const DOCUMENT_TYPES = ['contract', 'order', 'delivery_proof'] as const
export const ALLOCATION_ORIGINS = ['reference', 'amount', 'excess', 'unassigned', 'supervisor'] as const

/**
 * What the recovery imports keep about a preview, next to the rows of the foundation (`import_previews`,
 * `import_preview_rows`, `import_preview_errors` are reused as they are). Deleted with the preview when it expires.
 * `accepted` is false for a file of a type refused as a whole when it has its error; the effects are written at the
 * confirmation (at most 20 `{ label, count }`).
 */
export const recoveryImportDetails = base.table('recovery_import_details', {
  importId: uuid('import_id')
    .primaryKey()
    .references(() => importPreviews.id, { onDelete: 'cascade' }),
  accepted: boolean('accepted').notNull().default(true),
  extractionDate: date('extraction_date', { mode: 'string' }),
  controlTotalCents: cents('control_total_cents'),
  computedTotalCents: cents('computed_total_cents'),
  /** Last import of the same type confirmed when the report was computed (the one the report compares with). */
  previousImportId: uuid('previous_import_id'),
  effects: jsonb('effects'),
})

/** rule-recouvrement-import-report: the counts of a report category. */
export const recoveryImportReportCategories = base.table(
  'recovery_import_report_categories',
  {
    importId: uuid('import_id')
      .notNull()
      .references(() => importPreviews.id, { onDelete: 'cascade' }),
    category: text('category').notNull(),
    rowCount: integer('row_count').notNull().default(0),
    caseCount: integer('case_count').notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.importId, table.category] }),
    check('recovery_import_report_categories_category_check', sql`${table.category} in ('new', 'settled', 'modified', 'removed')`),
  ],
)

/** rule-recouvrement-import-report: the lines of a report category, by natural key. */
export const recoveryImportReportItems = base.table(
  'recovery_import_report_items',
  {
    importId: uuid('import_id')
      .notNull()
      .references(() => importPreviews.id, { onDelete: 'cascade' }),
    category: text('category').notNull(),
    key: text('key').notNull(),
    debtorId: text('debtor_id'),
    detail: text('detail').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.importId, table.category, table.key] }),
    check('recovery_import_report_items_category_check', sql`${table.category} in ('new', 'settled', 'modified', 'removed')`),
    check('recovery_import_report_items_key_check', sql`char_length(${table.key}) between 1 and 200`),
    check('recovery_import_report_items_detail_check', sql`char_length(${table.detail}) between 1 and 300`),
  ],
)

export const recoveryImportReportNotes = base.table(
  'recovery_import_report_notes',
  {
    importId: uuid('import_id')
      .notNull()
      .references(() => importPreviews.id, { onDelete: 'cascade' }),
    code: text('code').notNull(),
    label: text('label').notNull(),
    count: integer('count').notNull(),
  },
  (table) => [primaryKey({ columns: [table.importId, table.code] })],
)

/** rule-recouvrement-payments-columns: a bank statement line; the reference is unique, a known one is ignored. */
export const payments = base.table(
  'payments',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    reference: text('reference').notNull().unique(),
    amountCents: cents('amount_cents').notNull(),
    paymentDate: date('payment_date', { mode: 'string' }).notNull(),
    statementDate: date('statement_date', { mode: 'string' }).notNull(),
    importId: uuid('import_id')
      .notNull()
      .references(() => importPreviews.id),
    /** `applied`: dated after the extraction of the latest snapshot; `already_in_balances`: nothing to do. */
    status: text('status').notNull(),
  },
  (table) => [
    check('payments_reference_check', sql`char_length(${table.reference}) between 1 and 100`),
    check('payments_amount_check', sql`${table.amountCents} > 0 and ${table.amountCents} <= 10000000000`),
    check('payments_status_check', sql`${table.status} in ('already_in_balances', 'applied')`),
    index('payments_payment_date_idx').on(table.paymentDate),
  ],
)

/** One row per confirmed statement (freshness of the bank statement). */
export const statements = base.table('statements', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  statementDate: date('statement_date', { mode: 'string' }).notNull(),
  importId: uuid('import_id')
    .notNull()
    .references(() => importPreviews.id),
  confirmedAt: timestamp('confirmed_at', { withTimezone: true }).notNull().defaultNow(),
})

/**
 * Allocation of a payment to an invoice (`invoice_id` null: not assigned). The balance of an invoice is its snapshot
 * balance minus its allocations. The automatic ones (`reference`, `amount`, `excess`, `unassigned`) are rebuilt at every
 * confirmation of receivables or payments; the ones of the supervisor are kept (rule-recouvrement-unassigned-payment-freeze).
 */
export const paymentAllocations = base.table(
  'payment_allocations',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    paymentId: uuid('payment_id')
      .notNull()
      .references(() => payments.id, { onDelete: 'cascade' }),
    invoiceId: uuid('invoice_id').references(() => invoices.id),
    amountCents: cents('amount_cents').notNull(),
    origin: text('origin').notNull(),
    parentAllocationId: uuid('parent_allocation_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    assignedBy: uuid('assigned_by'),
    assignedAt: timestamp('assigned_at', { withTimezone: true }),
  },
  (table) => [
    check('payment_allocations_amount_check', sql`${table.amountCents} > 0`),
    check('payment_allocations_origin_check', sql`${table.origin} in ('reference', 'amount', 'excess', 'unassigned', 'supervisor')`),
    index('payment_allocations_invoice_idx').on(table.invoiceId),
    index('payment_allocations_payment_idx').on(table.paymentId),
  ],
)

/**
 * rule-recouvrement-contacts-columns: the contacts of a case. The unique key is (case, role, coordinates): the identifier
 * is kept when they are unchanged. `last_import_id` marks the rows written by the last confirmation (the others go).
 */
export const contacts = base.table(
  'contacts',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    caseId: uuid('case_id')
      .notNull()
      .references(() => cases.id),
    role: text('role').notNull(),
    email: text('email'),
    phone: text('phone'),
    postalAddress: text('postal_address'),
    /** rule-recouvrement-contact-invalid-suspends-channel: channels suspended by an invalid coordinate. */
    suspendedChannels: text('suspended_channels').array().notNull().default(sql`'{}'::text[]`),
    lastImportId: uuid('last_import_id').references(() => importPreviews.id, { onDelete: 'set null' }),
  },
  (table) => [
    check('contacts_role_check', sql`${table.role} in ('accounts_payable', 'buyer', 'approver', 'payer')`),
    check(
      'contacts_coordinate_check',
      sql`${table.email} is not null or ${table.phone} is not null or ${table.postalAddress} is not null`,
    ),
    check('contacts_suspended_check', sql`${table.suspendedChannels} <@ array['voice', 'email_sms', 'mail']::text[]`),
    uniqueIndex('contacts_natural_key').on(
      table.caseId,
      table.role,
      sql`coalesce(${table.email}, '')`,
      sql`coalesce(${table.phone}, '')`,
      sql`coalesce(${table.postalAddress}, '')`,
    ),
  ],
)

/** rule-recouvrement-documents-columns: which supporting documents exist for an invoice (no document is stored). */
export const invoiceDocuments = base.table(
  'invoice_documents',
  {
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id),
    type: text('type').notNull(),
    reference: text('reference'),
    lastImportId: uuid('last_import_id').references(() => importPreviews.id, { onDelete: 'set null' }),
  },
  (table) => [
    primaryKey({ columns: [table.invoiceId, table.type] }),
    check('invoice_documents_type_check', sql`${table.type} in ('contract', 'order', 'delivery_proof')`),
    check('invoice_documents_reference_check', sql`${table.reference} is null or char_length(${table.reference}) between 1 and 100`),
  ],
)
