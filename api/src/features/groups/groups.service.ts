import { Injectable } from '@nestjs/common'
import { asc, count, eq, inArray, sql } from 'drizzle-orm'
import { Database, InjectDb } from '../../platform/database/database.module'
import { byLowerText, byText } from '../../platform/database/ordering'
import { ApiError, isUniqueViolation, notFound, validationFailed } from '../../platform/http/errors'
import { pageOf } from '../../platform/validation/common'
import { scopes } from '../scopes/scopes.tables'
import { users } from '../users/users.tables'
import type { CreateGroupBody, GroupDto, GroupsListQuery, UpdateGroupBody } from './groups.schemas'
import { groups, groupScopes, groupUsers } from './groups.tables'
import { lockMemberships } from './memberships'

type Executor = Pick<Database, 'select' | 'insert' | 'update' | 'delete'>

const nameTaken = () => new ApiError(409, 'groups.name_already_exists', 'A group already uses this name')

@Injectable()
export class GroupsService {
  constructor(@InjectDb() private readonly db: Database) {}

  /** rule-foundation-group-definition: groups by name ignoring case, then id; members by e-mail; scopes by code. */
  async list(query: GroupsListQuery): Promise<{ groups: GroupDto[]; total: number }> {
    const { from, size } = pageOf(query)
    const page = await this.db
      .select({ id: groups.id })
      .from(groups)
      .orderBy(byLowerText(groups.name), asc(groups.id))
      .limit(size)
      .offset(from)
    const [{ total }] = await this.db.select({ total: count() }).from(groups)
    return { groups: await this.load(this.db, page.map((row) => row.id)), total: Number(total) }
  }

  /**
   * rule-foundation-group-definition: name, members and scopes are created together, atomically.
   * rule-foundation-group-name-unique: unique ignoring case (index on `lower(name)`), 409 on conflict.
   */
  async create(body: CreateGroupBody): Promise<GroupDto> {
    const userIds = body.userIds ?? []
    return this.db.transaction(async (tx) => {
      if (userIds.length > 0) await lockMemberships(tx)
      await this.assertReferences(tx, { userIds, scopeIds: body.scopeIds })
      const [created] = await tx
        .insert(groups)
        .values({ name: body.name })
        .onConflictDoNothing()
        .returning({ id: groups.id })
      if (!created) throw nameTaken()
      await this.replaceMembers(tx, created.id, userIds)
      await this.replaceScopes(tx, created.id, body.scopeIds)
      return (await this.load(tx, [created.id]))[0]
    })
  }

  /**
   * rule-foundation-group-definition: each provided field replaces the current value, all in one atomic step.
   * The group row is locked first (`no key update`: it excludes another modification of the group but not the foreign
   * key checks of the memberships written from an account), so two concurrent modifications of one group never
   * interleave. The existence of the group (404) is checked before the referenced ids (400).
   */
  async update(id: string, body: UpdateGroupBody): Promise<GroupDto> {
    return this.db.transaction(async (tx) => {
      if (body.userIds !== undefined) await lockMemberships(tx)
      const [existing] = await tx.select({ id: groups.id }).from(groups).where(eq(groups.id, id)).for('no key update')
      if (!existing) throw notFound()
      id = existing.id
      await this.assertReferences(tx, { userIds: body.userIds ?? [], scopeIds: body.scopeIds ?? [] })
      if (body.name !== undefined) {
        try {
          await tx.update(groups).set({ name: body.name, updatedAt: sql`now()` }).where(eq(groups.id, id))
        } catch (error) {
          if (isUniqueViolation(error)) throw nameTaken() // the transaction is rolled back: nothing else is applied
          throw error
        }
      }
      if (body.userIds !== undefined) await this.replaceMembers(tx, id, body.userIds)
      if (body.scopeIds !== undefined) await this.replaceScopes(tx, id, body.scopeIds)
      if (body.name === undefined && (body.userIds !== undefined || body.scopeIds !== undefined)) {
        await tx.update(groups).set({ updatedAt: sql`now()` }).where(eq(groups.id, id))
      }
      return (await this.load(tx, [id]))[0]
    })
  }

  /** The referenced users and scopes must exist: 400, never a foreign key error (EXI-PLAT-03). */
  private async assertReferences(tx: Executor, ids: { userIds: string[]; scopeIds: string[] }): Promise<void> {
    if (ids.userIds.length > 0) {
      const found = await tx.select({ id: users.id }).from(users).where(inArray(users.id, ids.userIds))
      if (found.length !== ids.userIds.length) throw validationFailed([{ path: 'body.userIds', message: 'Unknown user' }])
    }
    if (ids.scopeIds.length > 0) {
      const found = await tx.select({ id: scopes.id }).from(scopes).where(inArray(scopes.id, ids.scopeIds))
      if (found.length !== ids.scopeIds.length) throw validationFailed([{ path: 'body.scopeIds', message: 'Unknown scope' }])
    }
  }

  private async replaceMembers(tx: Executor, groupId: string, userIds: string[]): Promise<void> {
    await tx.delete(groupUsers).where(eq(groupUsers.groupId, groupId))
    if (userIds.length > 0) {
      await tx
        .insert(groupUsers)
        .values(userIds.map((userId) => ({ groupId, userId })))
        .onConflictDoNothing()
    }
  }

  private async replaceScopes(tx: Executor, groupId: string, scopeIds: string[]): Promise<void> {
    await tx.delete(groupScopes).where(eq(groupScopes.groupId, groupId))
    if (scopeIds.length > 0) {
      await tx
        .insert(groupScopes)
        .values(scopeIds.map((scopeId) => ({ groupId, scopeId })))
        .onConflictDoNothing()
    }
  }

  /** GroupDto of each id, in the order of `ids`. */
  private async load(executor: Executor, ids: string[]): Promise<GroupDto[]> {
    if (ids.length === 0) return []
    const rows = await executor.select({ id: groups.id, name: groups.name }).from(groups).where(inArray(groups.id, ids))
    const members = await executor
      .select({ groupId: groupUsers.groupId, id: users.id, email: users.email })
      .from(groupUsers)
      .innerJoin(users, eq(users.id, groupUsers.userId))
      .where(inArray(groupUsers.groupId, ids))
      .orderBy(byText(users.email), asc(users.id))
    const reached = await executor
      .select({ groupId: groupScopes.groupId, id: scopes.id, code: scopes.code, name: scopes.name })
      .from(groupScopes)
      .innerJoin(scopes, eq(scopes.id, groupScopes.scopeId))
      .where(inArray(groupScopes.groupId, ids))
      .orderBy(byText(scopes.code), asc(scopes.id))
    // identifiers come back from PostgreSQL in lower case, whatever the case of the requested ones
    const byId = new Map(rows.map((row) => [row.id, row]))
    return ids.flatMap((requested) => {
      const row = byId.get(requested.toLowerCase())
      if (!row) return []
      return [
        {
          id: row.id,
          name: row.name,
          members: members.filter((m) => m.groupId === row.id).map((m) => ({ id: m.id, email: m.email })),
          scopes: reached.filter((s) => s.groupId === row.id).map((s) => ({ id: s.id, code: s.code, name: s.name })),
        },
      ]
    })
  }
}
