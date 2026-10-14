import { sql } from 'drizzle-orm'
import { check, date, index, integer, jsonb, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { base } from '../../platform/database/base-schema'
import { cases } from '../cases/cases.tables'
import { contacts } from '../recovery-imports/recovery-imports.tables'
import { policyVersions } from '../policies/policies.tables'

export const BATCH_STATUSES = ['blocked', 'ready', 'replaced'] as const
export const ORDER_KINDS = ['reminder', 'proposal', 'commitment_confirmation'] as const
export const ORDER_STATUSES = ['planned', 'blocked', 'cancelled'] as const

/**
 * Daily batches (module recouvrement; an addition to the data contract, see DISPUTES.md).
 * rule-recouvrement-batch-one-per-day: at most one batch per date that is not `replaced` (partial unique index).
 * rule-recouvrement-batch-release-mode: there is no "to release" status, the CHECK refuses it.
 * Actor columns (prepared_by, released_by) are plain uuids, without foreign key: the journal outlives the account.
 */
export const dailyBatches = base.table(
  'daily_batches',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    batchDate: date('batch_date', { mode: 'string' }).notNull(),
    status: text('status').notNull(),
    preparedBy: uuid('prepared_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    releasedBy: uuid('released_by'),
    releasedAt: timestamp('released_at', { withTimezone: true }),
    releaseReason: text('release_reason'),
    replacedBy: uuid('replaced_by'),
    policyVersionId: uuid('policy_version_id').references(() => policyVersions.id),
    caseCount: integer('case_count').notNull(),
    /** `BatchCheckDto[]`, as computed at the preparation. */
    checks: jsonb('checks').notNull(),
    /** `DecisionShareDto[]`, as computed at the preparation. */
    shares: jsonb('shares').notNull(),
    /** `{ reason, count }[]`. */
    excluded: jsonb('excluded').notNull(),
  },
  (table) => [
    check('daily_batches_status_check', sql`${table.status} in ('blocked', 'ready', 'replaced')`),
    check('daily_batches_case_count_check', sql`${table.caseCount} >= 0`),
    check('daily_batches_release_reason_check', sql`${table.releaseReason} is null or char_length(${table.releaseReason}) between 1 and 1000`),
    uniqueIndex('daily_batches_one_per_day')
      .on(table.batchDate)
      .where(sql`${table.status} <> 'replaced'`),
    index('daily_batches_date_idx').on(table.batchDate, table.createdAt),
  ],
)

/**
 * Send orders: structured instructions (case, interlocutor, channel, conditions), never a drafted text.
 * rule-recouvrement-batch-no-duplicate-order: one order per case, kind and day that is not `cancelled`, guaranteed by the
 * database (partial unique index). A confirmation refused by a unit check is `blocked` and keeps its place of the day.
 */
export const sendOrders = base.table(
  'send_orders',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    batchId: uuid('batch_id').references(() => dailyBatches.id),
    kind: text('kind').notNull(),
    status: text('status').notNull(),
    caseId: uuid('case_id')
      .notNull()
      .references(() => cases.id),
    interlocutorId: uuid('interlocutor_id')
      .notNull()
      .references(() => contacts.id),
    channel: text('channel').notNull(),
    /** `[{ name, value }]`: amounts, due dates, offer. */
    conditions: jsonb('conditions').notNull(),
    blockReason: text('block_reason'),
    orderDate: date('order_date', { mode: 'string' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('send_orders_kind_check', sql`${table.kind} in ('reminder', 'proposal', 'commitment_confirmation')`),
    check('send_orders_status_check', sql`${table.status} in ('planned', 'blocked', 'cancelled')`),
    check('send_orders_channel_check', sql`${table.channel} in ('voice', 'email_sms', 'mail')`),
    check('send_orders_block_reason_check', sql`${table.blockReason} is null or char_length(${table.blockReason}) between 1 and 300`),
    uniqueIndex('send_orders_one_active')
      .on(table.caseId, table.kind, table.orderDate)
      .where(sql`${table.status} <> 'cancelled'`),
    index('send_orders_batch_idx').on(table.batchId),
  ],
)
