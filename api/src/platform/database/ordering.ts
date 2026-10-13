import { sql, SQL } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'

/**
 * Orderings of the lists. They use the byte-wise collation `C` so that the order does not depend on the locale of the
 * database server (pages of a sorted list show neither a gap nor a duplicate, whatever the server).
 */
export const byText = (column: AnyPgColumn | SQL): SQL => sql`${column} collate "C"`

/** Case-insensitive order (name of a group, `rule-foundation-group-definition`). */
export const byLowerText = (column: AnyPgColumn | SQL): SQL => sql`lower(${column}) collate "C"`
