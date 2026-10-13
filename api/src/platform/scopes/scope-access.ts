import { AsyncLocalStorage } from 'node:async_hooks'
import { Injectable } from '@nestjs/common'
import { eq } from 'drizzle-orm'
import type { AdminScopeAccess } from '../access/access.decorators'
import { groupScopes, groupUsers } from '../../features/groups/groups.tables'
import { scopes } from '../../features/scopes/scopes.tables'
import { Database, InjectDb } from '../database/database.module'
import type { AuthenticatedUser } from '../http/request-context'

/**
 * What a caller reaches, resolved once per request (`rule-foundation-scope-row-filter`).
 *   - `read`: every row (`'all'`) or the rows of these scope codes;
 *   - `write`: every code (`'all'`), these codes, nothing because the route is read-only for administrators
 *     (`scopes.read_only`), or nothing at all (`scopes.access_denied`).
 */
export interface ScopeAccess {
  read: 'all' | { codes: string[] }
  write: 'all' | { codes: string[] } | 'read_only' | 'none'
}

/** `rule-foundation-scope-fail-closed`: no identity, no row. */
export const NO_ACCESS: ScopeAccess = { read: { codes: [] }, write: 'none' }

/** Access of an administrator according to the route declaration (`rule-foundation-admin-scope-access`). */
export function adminAccess(declared: AdminScopeAccess): ScopeAccess {
  if (declared === 'read') return { read: 'all', write: 'read_only' }
  if (declared === 'none') return NO_ACCESS
  return { read: 'all', write: 'all' }
}

/** Request-bound state: who calls, and what an administrator reaches on this route. Memoises the resolved access. */
export interface ScopeContext {
  /** Caller of the request; absent on a public route. The role is the one of the session token. */
  caller?: AuthenticatedUser
  adminScopes: AdminScopeAccess
  /** Set by `runWithScopeAccess` for a processing outside any request: the access it explicitly declares. */
  explicit?: ScopeAccess
  resolved?: Promise<ScopeAccess>
}

export const scopeStorage = new AsyncLocalStorage<ScopeContext>()

/**
 * Runs `fn` outside any request (scheduled task, script) under an explicitly declared access
 * (`rule-foundation-scope-fail-closed`): `'full'` reaches every scope, `'read'` reads all and writes nothing,
 * `'none'` reaches nothing. Without this call, code running outside a request reaches no row at all.
 */
export function runWithScopeAccess<T>(declared: AdminScopeAccess, fn: () => T): T {
  return scopeStorage.run({ adminScopes: declared, explicit: adminAccess(declared) }, fn)
}

@Injectable()
export class ScopeAccessService {
  constructor(@InjectDb() private readonly db: Database) {}

  /** Access of the current request (or of the explicit processing); nothing when no identity is established. */
  current(): Promise<ScopeAccess> {
    const context = scopeStorage.getStore()
    if (!context) return Promise.resolve(NO_ACCESS)
    context.resolved ??= this.resolve(context)
    return context.resolved
  }

  private async resolve(context: ScopeContext): Promise<ScopeAccess> {
    if (context.explicit) return context.explicit
    const caller = context.caller
    if (!caller) return NO_ACCESS
    // the declared admin access has no effect on ordinary users, who always follow their groups
    if (caller.role === 'admin') return adminAccess(context.adminScopes)
    // memberships are read on every request: a change applies from the next request, without reconnection
    const rows = await this.db
      .selectDistinct({ code: scopes.code })
      .from(groupUsers)
      .innerJoin(groupScopes, eq(groupScopes.groupId, groupUsers.groupId))
      .innerJoin(scopes, eq(scopes.id, groupScopes.scopeId))
      .where(eq(groupUsers.userId, caller.id))
    const codes = rows.map((row) => row.code)
    return { read: { codes }, write: { codes } }
  }
}
