import { sql } from 'drizzle-orm'
import { text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { base } from '../../platform/database/base-schema'

/**
 * data-contract: base.audit_logs. Append-only in the database itself (rule-foundation-audit-db-append-only): triggers
 * added by the migration `audit_append_only` refuse UPDATE, DELETE (and TRUNCATE outside a `_test` database).
 */
export const auditLogs = base.table('audit_logs', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  occurredAt: timestamp('occurred_at', { withTimezone: true })
    .notNull()
    .default(sql`date_trunc('milliseconds'::text, clock_timestamp())`),
  actorId: uuid('actor_id').notNull(),
  actorEmail: text('actor_email').notNull(),
  action: text('action').notNull(),
  objectType: text('object_type').notNull(),
  objectId: text('object_id').notNull(),
  scopeCode: text('scope_code'),
  summary: text('summary').notNull(),
})
