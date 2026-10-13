import { sql } from 'drizzle-orm'
import { text, timestamp, uuid, uniqueIndex } from 'drizzle-orm/pg-core'
import { base } from '../../platform/database/base-schema'

export const userRole = base.enum('user_role', ['user', 'admin'])
export const credentialType = base.enum('credential_type', ['token'])

/** data-contract: base.users */
export const users = base.table(
  'users',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    email: text('email').notNull(),
    role: userRole('role').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('users_email_unique').on(table.email)],
)

/** data-contract: base.credentials (one `token` row per account, bcrypt hash cost 10) */
export const credentials = base.table('credentials', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  password: text('password').notNull(),
  type: credentialType('type').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})
