import { sql } from 'drizzle-orm'
import type { Database } from '../../platform/database/database.module'

type Executor = Pick<Database, 'execute'>

/**
 * Serialises the transactions that rewrite memberships (`base.group_users`), whether they start from the account
 * (`PATCH /users/:id`, `POST /users`) or from the group (`PATCH /groups/:id`, `POST /groups`): without it, two
 * replacements that delete and insert overlapping rows in opposite orders can deadlock (PostgreSQL 40P01, a 500).
 * Taken before any row lock, released at the end of the transaction. Administration writes are rare: the wait is short.
 */
export async function lockMemberships(tx: Executor): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('base.group_users'))`)
}

/** A uuid compared the way PostgreSQL does: hexadecimal digits are case-insensitive. */
export const sameId = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase()
