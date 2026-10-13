import { sql } from 'drizzle-orm'
import { primaryKey, text, timestamp, uuid, uniqueIndex } from 'drizzle-orm/pg-core'
import { base } from '../../platform/database/base-schema'
import { scopes } from '../scopes/scopes.tables'
import { users } from '../users/users.tables'

/** data-contract: base.groups (table only: routes belong to lot r1-comptes-groupes-perimetres) */
export const groups = base.table(
  'groups',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    name: text('name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('groups_name_lower_unique').on(sql`lower(${table.name})`)],
)

/** data-contract: base.group_users */
export const groupUsers = base.table(
  'group_users',
  {
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.groupId, table.userId] }),
    uniqueIndex('group_users_group_id_user_id_unique').on(table.groupId, table.userId),
  ],
)

/** data-contract: base.group_scopes */
export const groupScopes = base.table(
  'group_scopes',
  {
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    scopeId: uuid('scope_id')
      .notNull()
      .references(() => scopes.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.groupId, table.scopeId] }),
    uniqueIndex('group_scopes_group_id_scope_id_unique').on(table.groupId, table.scopeId),
  ],
)
