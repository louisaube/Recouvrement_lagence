import { sql } from 'drizzle-orm'
import {
  bigint,
  integer,
  jsonb,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { base } from '../../platform/database/base-schema'

/** data-contract: base.import_previews (table only: the import belongs to lot r3-import) */
export const importPreviews = base.table(
  'import_previews',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    feature: text('feature').notNull(),
    actorId: uuid('actor_id').notNull(),
    fileName: text('file_name').notNull(),
    fileHash: text('file_hash').notNull(),
    status: text('status').notNull(),
    totalRows: integer('total_rows').notNull().default(0),
    validRows: integer('valid_rows').notNull().default(0),
    errorRows: integer('error_rows').notNull().default(0),
    errorEntries: integer('error_entries').notNull().default(0),
    createdCount: integer('created_count'),
    skippedCount: integer('skipped_count'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('import_previews_feature_file_hash_confirmed_unique')
      .on(table.feature, table.fileHash)
      .where(sql`status = 'confirmed'::text`),
  ],
)

/** data-contract: base.import_preview_rows */
export const importPreviewRows = base.table(
  'import_preview_rows',
  {
    previewId: uuid('preview_id')
      .notNull()
      .references(() => importPreviews.id, { onDelete: 'cascade' }),
    rowNumber: integer('row_number').notNull(),
    dedupeKey: text('dedupe_key'),
    data: jsonb('data'),
  },
  (table) => [
    primaryKey({ columns: [table.previewId, table.rowNumber] }),
    uniqueIndex('import_preview_rows_preview_id_row_number_unique').on(table.previewId, table.rowNumber),
    uniqueIndex('import_preview_rows_preview_id_dedupe_key_unique')
      .on(table.previewId, table.dedupeKey)
      .where(sql`dedupe_key IS NOT NULL`),
  ],
)

/** data-contract: base.import_preview_errors */
export const importPreviewErrors = base.table(
  'import_preview_errors',
  {
    previewId: uuid('preview_id')
      .notNull()
      .references(() => importPreviews.id, { onDelete: 'cascade' }),
    seq: bigint('seq', { mode: 'number' }).notNull(),
    rowNumber: integer('row_number').notNull(),
    column: text('column').notNull(),
    reason: text('reason').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.previewId, table.seq] }),
    uniqueIndex('import_preview_errors_preview_id_seq_unique').on(table.previewId, table.seq),
  ],
)
