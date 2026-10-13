import { Injectable } from '@nestjs/common'
import { and, count as countRows, inArray, sql, SQL } from 'drizzle-orm'
import { AnyPgColumn, getTableConfig, PgTable } from 'drizzle-orm/pg-core'
import { getTableColumns } from 'drizzle-orm'
import { scopes } from '../../features/scopes/scopes.tables'
import { Database, InjectDb } from '../database/database.module'
import { notFound, scopeAccessDenied, scopeReadOnly, validationFailed } from '../http/errors'
import { ScopeAccess, ScopeAccessService } from './scope-access'

/** A Drizzle table attached to a scope: it carries the column `scope_code` (text, not null). */
export type ScopedTable = PgTable
type Executor = Pick<Database, 'select' | 'insert' | 'update' | 'delete'>

/** Name of the column imposed by the specification: one row belongs to one scope. */
export const SCOPE_COLUMN = 'scope_code'

interface ScopedColumn {
  /** Key of the column in the table object (`scopeCode`). */
  key: string
  column: AnyPgColumn
}

function scopeColumnOf(table: ScopedTable): ScopedColumn | undefined {
  for (const [key, column] of Object.entries(getTableColumns(table))) {
    if (column.name === SCOPE_COLUMN) return { key, column: column as AnyPgColumn }
  }
  return undefined
}

/**
 * Declares that a table is attached to a scope (90-capacites-pour-le-metier.md §2). Call it where the table is
 * defined: a table declared without a `scope_code` column (text, not null) makes the module fail to load, so the
 * server refuses to start. The database side (reference to `base.scopes(code)`, no deletion nor change of a
 * referenced code: `on delete restrict on update restrict`) belongs to the feature's migration.
 */
export function declareScopedTable<T extends ScopedTable>(table: T): T {
  const name = getTableConfig(table).name
  const found = scopeColumnOf(table)
  if (!found) throw new Error(`Table "${name}" is declared as attached to a scope but has no "${SCOPE_COLUMN}" column`)
  if (found.column.dataType !== 'string' || !found.column.notNull) {
    throw new Error(`Column "${SCOPE_COLUMN}" of table "${name}" must be text and not null`)
  }
  return table
}

function requireScopedColumn(table: ScopedTable): ScopedColumn {
  declareScopedTable(table)
  return scopeColumnOf(table)!
}

const readCondition = (access: ScopeAccess, column: AnyPgColumn): SQL =>
  access.read === 'all' ? sql`true` : access.read.codes.length === 0 ? sql`false` : inArray(column, access.read.codes)

/** Rows a caller may modify: those of the scopes it may write to (nothing for a read-only or no-access caller). */
const writeCondition = (access: ScopeAccess, column: AnyPgColumn): SQL => {
  if (access.write === 'all') return sql`true`
  if (typeof access.write === 'string' || access.write.codes.length === 0) return sql`false`
  return inArray(column, access.write.codes)
}

/**
 * Access to the tables attached to a scope, with the row-level rule applied without the feature writing any filter
 * (`rule-foundation-scope-row-filter`, `-admin-scope-access`, `-fail-closed`, `rule-foundation-user-no-group-no-data`).
 * Reads see only the rows of the scopes reached; a row elsewhere does not exist for the caller (`repository.not_found`);
 * a write aimed at a scope not reached is `403 scopes.access_denied` and nothing is written.
 *
 * A hand-written query (join, aggregate) bypasses this repository and must add `await repository.condition(table)`
 * itself.
 */
@Injectable()
export class ScopedRepository {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly access: ScopeAccessService,
  ) {}

  /** Scope condition of a read, to apply by hand in a query that does not go through this repository. */
  async condition(table: ScopedTable): Promise<SQL> {
    return readCondition(await this.access.current(), requireScopedColumn(table).column)
  }

  async find<T extends ScopedTable>(
    table: T,
    options: { where?: SQL; orderBy?: SQL[]; limit?: number; offset?: number } = {},
    executor: Executor = this.db,
  ): Promise<T['$inferSelect'][]> {
    const scoped = await this.condition(table)
    let query = executor.select().from(table as PgTable).where(and(scoped, options.where)).$dynamic()
    if (options.orderBy) query = query.orderBy(...options.orderBy)
    if (options.limit !== undefined) query = query.limit(options.limit)
    if (options.offset !== undefined) query = query.offset(options.offset)
    return (await query) as T['$inferSelect'][]
  }

  async count(table: ScopedTable, where?: SQL, executor: Executor = this.db): Promise<number> {
    const scoped = await this.condition(table)
    const [row] = await executor.select({ total: countRows() }).from(table).where(and(scoped, where))
    return Number(row.total)
  }

  /** The row, or `404 repository.not_found` when it does not exist or belongs to a scope not reached. */
  async get<T extends ScopedTable>(table: T, where: SQL, executor: Executor = this.db): Promise<T['$inferSelect']> {
    const [row] = await this.find(table, { where, limit: 1 }, executor)
    if (!row) throw notFound()
    return row
  }

  async insert<T extends ScopedTable>(
    table: T,
    values: T['$inferInsert'] | T['$inferInsert'][],
    executor: Executor = this.db,
  ): Promise<T['$inferSelect'][]> {
    const rows = Array.isArray(values) ? values : [values]
    await this.assertMayWrite(table, rows, executor)
    if (rows.length === 0) return []
    return (await executor.insert(table).values(rows).returning()) as T['$inferSelect'][]
  }

  /** Updates the rows matching `where` among those of the scopes the caller may write to; returns them. */
  async update<T extends ScopedTable>(
    table: T,
    set: Partial<T['$inferInsert']>,
    where: SQL,
    executor: Executor = this.db,
  ): Promise<T['$inferSelect'][]> {
    await this.assertMayWrite(table, [set as Record<string, unknown>], executor, false)
    const { column } = requireScopedColumn(table)
    const writable = writeCondition(await this.access.current(), column)
    return (await executor.update(table).set(set).where(and(writable, where)).returning()) as T['$inferSelect'][]
  }

  /** As `update`, for one row: `404 repository.not_found` when no row is touched. */
  async updateOne<T extends ScopedTable>(
    table: T,
    set: Partial<T['$inferInsert']>,
    where: SQL,
    executor: Executor = this.db,
  ): Promise<T['$inferSelect']> {
    const [row] = await this.update(table, set, where, executor)
    if (!row) throw notFound()
    return row
  }

  /** Deletes the matching rows among those of the scopes the caller may write to; returns how many. */
  async remove(table: ScopedTable, where: SQL, executor: Executor = this.db): Promise<number> {
    const access = await this.access.current()
    this.assertWriteMode(access)
    const { column } = requireScopedColumn(table)
    const deleted = await executor.delete(table).where(and(writeCondition(access, column), where)).returning()
    return deleted.length
  }

  /** As `remove`, for one row: `404 repository.not_found` when no row is touched. */
  async removeOne(table: ScopedTable, where: SQL, executor: Executor = this.db): Promise<void> {
    if ((await this.remove(table, where, executor)) === 0) throw notFound()
  }

  /**
   * Insert, or update on conflict. A conflicting row of a scope the caller may not write to is never modified, and the
   * update never changes the scope code. Returns the rows inserted or updated.
   */
  async upsert<T extends ScopedTable>(
    table: T,
    values: T['$inferInsert'] | T['$inferInsert'][],
    conflict: { target: AnyPgColumn | AnyPgColumn[]; set: Partial<T['$inferInsert']> },
    executor: Executor = this.db,
  ): Promise<T['$inferSelect'][]> {
    const rows = Array.isArray(values) ? values : [values]
    await this.assertMayWrite(table, rows, executor)
    if (rows.length === 0) return []
    const { key, column } = requireScopedColumn(table)
    const { [key]: _ignored, ...set } = conflict.set as Record<string, unknown>
    const writable = writeCondition(await this.access.current(), column)
    return (await executor
      .insert(table)
      .values(rows)
      .onConflictDoUpdate({
        target: conflict.target,
        set: set as never,
        setWhere: writable,
      })
      .returning()) as T['$inferSelect'][]
  }

  private assertWriteMode(access: ScopeAccess): void {
    if (access.write === 'read_only') throw scopeReadOnly()
    if (access.write === 'none') throw scopeAccessDenied()
  }

  /** Every scope code written (creation, or move of a row) must be one the caller may write to. */
  private async assertMayWrite(
    table: ScopedTable,
    rows: Record<string, unknown>[],
    executor: Executor,
    creation = true,
  ): Promise<void> {
    const access = await this.access.current()
    this.assertWriteMode(access)
    const { key } = requireScopedColumn(table)
    // a created row must carry its scope code (never a not-null violation)
    if (creation && rows.some((row) => typeof row[key] !== 'string')) {
      throw validationFailed([{ path: key, message: 'A scope code is required' }])
    }
    const codes = [...new Set(rows.map((row) => row[key]).filter((code): code is string => typeof code === 'string'))]
    if (access.write === 'all') {
      // administrator: any existing scope; an unknown code is a validation failure, never a foreign key error
      if (codes.length === 0) return
      const known = await executor.select({ code: scopes.code }).from(scopes).where(inArray(scopes.code, codes))
      if (known.length !== codes.length) {
        throw validationFailed([{ path: key, message: 'Unknown scope code' }])
      }
      return
    }
    const reached = new Set((access.write as { codes: string[] }).codes)
    if (codes.some((code) => !reached.has(code))) throw scopeAccessDenied()
  }
}
