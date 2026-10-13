import { sql } from 'drizzle-orm'
import { text, timestamp, uuid, uniqueIndex } from 'drizzle-orm/pg-core'
import { base } from '../../platform/database/base-schema'

/** data-contract: base.scopes (table only: routes belong to lot r1-comptes-groupes-perimetres) */
export const scopes = base.table(
  'scopes',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    code: text('code').notNull(),
    name: text('name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('scopes_code_unique').on(table.code)],
)
