import { sql } from 'drizzle-orm'
import { check, index, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { base } from '../../platform/database/base-schema'
import { cases, invoices } from '../cases/cases.tables'

export const DISPUTE_ORIGINS = ['import', 'contestation', 'service'] as const
export type DisputeOrigin = (typeof DISPUTE_ORIGINS)[number]

/**
 * Disputes on an invoice (module recouvrement; an addition to the data contract, see DISPUTES.md).
 * rule-recouvrement-dispute-one-open-per-invoice: partial unique index on the open ones.
 * A closed dispute does not change any more and is never deleted (rule-recouvrement-dispute-no-delete, triggers of
 * the migration `recouvrement_triggers`). `contestation_id` is a plain uuid: the table of the contestations comes with
 * the lot of the agent tools. Author columns are plain uuids (the journal outlives the account).
 */
export const disputes = base.table(
  'disputes',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id),
    caseId: uuid('case_id')
      .notNull()
      .references(() => cases.id),
    origin: text('origin').notNull(),
    reason: text('reason').notNull(),
    owner: text('owner').notNull(),
    openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
    openedBy: uuid('opened_by'),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    closedBy: uuid('closed_by'),
    closeNote: text('close_note'),
    contestationId: uuid('contestation_id'),
  },
  (table) => [
    check('disputes_origin_check', sql`${table.origin} in ('import', 'contestation', 'service')`),
    check('disputes_reason_check', sql`char_length(${table.reason}) between 1 and 500`),
    check('disputes_owner_check', sql`char_length(${table.owner}) between 1 and 100`),
    check('disputes_close_note_check', sql`(${table.closedAt} is null) = (${table.closeNote} is null) and (${table.closedAt} is null) = (${table.closedBy} is null)`),
    check('disputes_close_note_length_check', sql`${table.closeNote} is null or char_length(${table.closeNote}) between 1 and 500`),
    uniqueIndex('disputes_one_open_per_invoice')
      .on(table.invoiceId)
      .where(sql`${table.closedAt} is null`),
    index('disputes_case_idx').on(table.caseId),
    index('disputes_opened_idx').on(table.openedAt, table.id),
  ],
)
