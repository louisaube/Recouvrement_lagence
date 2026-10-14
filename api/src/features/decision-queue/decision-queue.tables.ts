import { sql } from 'drizzle-orm'
import { check, index, jsonb, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { base } from '../../platform/database/base-schema'
import { cases } from '../cases/cases.tables'

export const QUEUE_TYPES = [
  'contestation',
  'amount_over_threshold',
  'ladder_exhausted',
  'unassigned_payment',
  'accounting_gap',
  'prescription_near',
  'prescription_expired',
  'alert',
  'human_request',
  'transfer_proposed',
] as const
export type QueueType = (typeof QUEUE_TYPES)[number]

/**
 * Items of the queue of the supervisor (module recouvrement; an addition to the data contract, see DISPUTES.md).
 * rule-recouvrement-queue-single-open: at most one open item per (type, object); a decided item is final (trigger of
 * the migration `recouvrement_triggers`, rule-recouvrement-queue-decided-final).
 * This lot creates the table and the writer (`QueueService`); the routes of the queue come with the lot of the day.
 */
export const queueItems = base.table(
  'queue_items',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    type: text('type').notNull(),
    status: text('status').notNull().default('open'),
    caseId: uuid('case_id').references(() => cases.id),
    objectKey: text('object_key').notNull(),
    summary: text('summary').notNull(),
    details: jsonb('details').notNull().default(sql`'[]'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decisionCode: text('decision_code'),
    decisionReason: text('decision_reason'),
    /** Plain uuid, no foreign key (the journal outlives the account); null with `auto_closed`. */
    decidedBy: uuid('decided_by'),
  },
  (table) => [
    check(
      'queue_items_type_check',
      sql`${table.type} in ('contestation', 'amount_over_threshold', 'ladder_exhausted', 'unassigned_payment', 'accounting_gap', 'prescription_near', 'prescription_expired', 'alert', 'human_request', 'transfer_proposed')`,
    ),
    check('queue_items_status_check', sql`${table.status} in ('open', 'decided')`),
    check('queue_items_object_key_check', sql`char_length(${table.objectKey}) between 1 and 100`),
    check('queue_items_summary_check', sql`char_length(${table.summary}) between 1 and 300`),
    check('queue_items_decision_reason_check', sql`${table.decisionReason} is null or char_length(${table.decisionReason}) between 1 and 1000`),
    uniqueIndex('queue_items_single_open')
      .on(table.type, table.objectKey)
      .where(sql`${table.status} = 'open'`),
    index('queue_items_case_idx').on(table.caseId),
    index('queue_items_status_created_idx').on(table.status, table.createdAt, table.id),
  ],
)
