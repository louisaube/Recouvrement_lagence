import { Injectable } from '@nestjs/common'
import { asc, count, eq, sql } from 'drizzle-orm'
import { Database, InjectDb } from '../../platform/database/database.module'
import { ApiError, notFound } from '../../platform/http/errors'
import { pageOf } from '../../platform/validation/common'
import type { CreateScopeBody, ScopeDto, ScopesListQuery, UpdateScopeBody } from './scopes.schemas'
import { scopes } from './scopes.tables'

const toDto = (row: { id: string; code: string; name: string }): ScopeDto => ({
  id: row.id,
  code: row.code,
  name: row.name,
})

@Injectable()
export class ScopesService {
  constructor(@InjectDb() private readonly db: Database) {}

  /**
   * rule-foundation-scopes-admin-screen: the table of the scopes is not filtered by scope (an administrator sees them
   * all). Sorted by code (byte order: lowercase letters, digits, `_` and `-` only), then by id.
   */
  async list(query: ScopesListQuery): Promise<{ scopes: ScopeDto[]; total: number }> {
    const { from, size } = pageOf(query)
    const rows = await this.db
      .select({ id: scopes.id, code: scopes.code, name: scopes.name })
      .from(scopes)
      .orderBy(sql`${scopes.code} collate "C"`, asc(scopes.id))
      .limit(size)
      .offset(from)
    const [{ total }] = await this.db.select({ total: count() }).from(scopes)
    return { scopes: rows.map(toDto), total: Number(total) }
  }

  /** rule-foundation-scope-definition, rule-foundation-scope-code-unique (unique index on `code`, 409 on conflict). */
  async create(body: CreateScopeBody): Promise<ScopeDto> {
    const [row] = await this.db
      .insert(scopes)
      .values({ code: body.code, name: body.name })
      .onConflictDoNothing({ target: scopes.code })
      .returning({ id: scopes.id, code: scopes.code, name: scopes.name })
    if (!row) throw new ApiError(409, 'scopes.code_already_exists', 'A scope already uses this code')
    return toDto(row)
  }

  /** rule-foundation-scope-code-immutable: only the name changes. Unknown id: 404 repository.not_found. */
  async rename(id: string, body: UpdateScopeBody): Promise<ScopeDto> {
    const [row] = await this.db
      .update(scopes)
      .set({ name: body.name, updatedAt: sql`now()` })
      .where(eq(scopes.id, id))
      .returning({ id: scopes.id, code: scopes.code, name: scopes.name })
    if (!row) throw notFound()
    return toDto(row)
  }
}
