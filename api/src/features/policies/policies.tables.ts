import { sql } from 'drizzle-orm'
import { boolean, char, check, date, jsonb, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { base } from '../../platform/database/base-schema'

export const POLICY_STATUSES = ['imported', 'active', 'superseded'] as const

/**
 * Versions of the recovery policy (module recouvrement; an addition to the data contract, see DISPUTES.md).
 * rule-recouvrement-policy-versioned: the SHA-256 of the file is unique, authors are kept.
 * rule-recouvrement-policy-immutable: partial unique index (at most one active version) and trigger of the migration
 * `recouvrement_triggers` (only status, activated_by and activated_at change; imported -> active, active -> superseded;
 * no DELETE).
 * Actor columns (imported_by, activated_by) are plain uuids, without foreign key: the journal outlives the account.
 */
export const policyVersions = base.table(
  'policy_versions',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    label: text('label').notNull(),
    versionDate: date('version_date', { mode: 'string' }).notNull(),
    status: text('status').notNull(),
    fileHash: char('file_hash', { length: 64 }).notNull().unique(),
    document: jsonb('document').notNull(),
    importedBy: uuid('imported_by').notNull(),
    importedAt: timestamp('imported_at', { withTimezone: true }).notNull().defaultNow(),
    activatedBy: uuid('activated_by'),
    activatedAt: timestamp('activated_at', { withTimezone: true }),
    checksPassed: boolean('checks_passed'),
  },
  (table) => [
    check('policy_versions_label_check', sql`char_length(${table.label}) between 1 and 100`),
    check('policy_versions_status_check', sql`${table.status} in ('imported', 'active', 'superseded')`),
    uniqueIndex('policy_versions_one_active').on(table.status).where(sql`${table.status} = 'active'`),
  ],
)

/** Preview of a policy file (purged at the next preview once expired, 2 hours). */
export const policyPreviews = base.table(
  'policy_previews',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    actorId: uuid('actor_id').notNull(),
    fileName: text('file_name').notNull(),
    fileHash: char('file_hash', { length: 64 }).notNull(),
    document: jsonb('document'),
    valid: boolean('valid').notNull(),
    errors: jsonb('errors').notNull().default(sql`'[]'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [check('policy_previews_file_name_check', sql`char_length(${table.fileName}) between 1 and 255`)],
)
