import { Injectable } from '@nestjs/common'
import bcrypt from 'bcryptjs'
import { asc, count, eq, inArray, sql } from 'drizzle-orm'
import { Database, InjectDb } from '../../platform/database/database.module'
import { byLowerText, byText } from '../../platform/database/ordering'
import { ApiError, notFound, validationFailed } from '../../platform/http/errors'
import type { AuthenticatedUser } from '../../platform/http/request-context'
import { pageOf } from '../../platform/validation/common'
import { groups, groupUsers } from '../groups/groups.tables'
import { lockMemberships, sameId } from '../groups/memberships'
import type { CreateUserBody, UpdateUserBody, UserDto, UsersListQuery } from './users.schemas'
import { credentials, users } from './users.tables'

type Executor = Pick<Database, 'select' | 'insert' | 'update' | 'delete'>

@Injectable()
export class UsersService {
  constructor(@InjectDb() private readonly db: Database) {}

  /** rule-foundation-users-list-admin-only: accounts by e-mail, then id; their groups by name ignoring case, then id. */
  async list(query: UsersListQuery): Promise<{ users: UserDto[]; total: number }> {
    const { from, size } = pageOf(query)
    const page = await this.db
      .select({ id: users.id })
      .from(users)
      .orderBy(byText(users.email), asc(users.id))
      .limit(size)
      .offset(from)
    const [{ total }] = await this.db.select({ total: count() }).from(users)
    return { users: await this.load(this.db, page.map((row) => row.id)), total: Number(total) }
  }

  /** rule-foundation-users-get-self-or-admin: the ownership check ran in the guard; unknown id is 404. */
  async get(id: string): Promise<UserDto> {
    const [user] = await this.load(this.db, [id])
    if (!user) throw notFound()
    return user
  }

  /** rule-foundation-user-create-fields, rule-foundation-user-email-unique, rule-foundation-user-groups-membership. */
  async create(body: CreateUserBody): Promise<UserDto> {
    const groupIds = body.groupIds ?? []
    const hash = await bcrypt.hash(body.password, 10)
    return this.db.transaction(async (tx) => {
      if (groupIds.length > 0) await lockMemberships(tx)
      await this.assertGroupsExist(tx, groupIds)
      const inserted = await tx
        .insert(users)
        .values({ email: body.email, role: body.role })
        .onConflictDoNothing({ target: users.email })
        .returning({ id: users.id })
      const created = inserted[0]
      if (!created) throw new ApiError(409, 'users.email_already_exists', 'An account already uses this e-mail')
      await tx.insert(credentials).values({ userId: created.id, password: hash, type: 'token' })
      await this.replaceGroups(tx, created.id, groupIds)
      return (await this.load(tx, [created.id]))[0]
    })
  }

  /**
   * rule-foundation-user-edit-scope: role and groups only, changed together and atomically.
   * rule-foundation-user-groups-membership: `groupIds` replaces the memberships, absent leaves them unchanged.
   * rule-foundation-user-own-role-locked: an administrator cannot change their own role (409, nothing applied).
   * The account is locked first (`no key update`: it must not block the foreign key checks of the memberships written
   * from a group); its existence (404) is checked before the group ids (400).
   */
  async update(id: string, body: UpdateUserBody, actor: AuthenticatedUser): Promise<UserDto> {
    return this.db.transaction(async (tx) => {
      if (body.groupIds !== undefined) await lockMemberships(tx)
      const [current] = await tx
        .select({ id: users.id, role: users.role })
        .from(users)
        .where(eq(users.id, id))
        .for('no key update')
      if (!current) throw notFound()
      // the identifier of the path may be written in capitals: compare as PostgreSQL does
      if (body.role !== undefined && sameId(current.id, actor.id) && body.role !== current.role) {
        throw new ApiError(409, 'users.cannot_change_own_role', 'An administrator cannot change their own role')
      }
      if (body.groupIds !== undefined) await this.assertGroupsExist(tx, body.groupIds)
      if (body.role !== undefined && body.role !== current.role) {
        await tx.update(users).set({ role: body.role, updatedAt: sql`now()` }).where(eq(users.id, id))
      }
      if (body.groupIds !== undefined) await this.replaceGroups(tx, current.id, body.groupIds)
      return (await this.load(tx, [current.id]))[0]
    })
  }

  /** The referenced groups must exist: 400, never a foreign key error (EXI-PLAT-03). */
  private async assertGroupsExist(tx: Executor, groupIds: string[]): Promise<void> {
    if (groupIds.length === 0) return
    const found = await tx.select({ id: groups.id }).from(groups).where(inArray(groups.id, groupIds))
    if (found.length !== groupIds.length) throw validationFailed([{ path: 'body.groupIds', message: 'Unknown group' }])
  }

  /** Same memberships as the ones edited from the group (`base.group_users`): the last write wins. */
  private async replaceGroups(tx: Executor, userId: string, groupIds: string[]): Promise<void> {
    await tx.delete(groupUsers).where(eq(groupUsers.userId, userId))
    if (groupIds.length > 0) {
      await tx
        .insert(groupUsers)
        .values(groupIds.map((groupId) => ({ groupId, userId })))
        .onConflictDoNothing()
    }
  }

  /** UserDto of each id that exists, in the order of `ids`. */
  private async load(executor: Executor, ids: string[]): Promise<UserDto[]> {
    if (ids.length === 0) return []
    const rows = await executor
      .select({ id: users.id, email: users.email, role: users.role })
      .from(users)
      .where(inArray(users.id, ids))
    const memberships = await executor
      .select({ userId: groupUsers.userId, id: groups.id, name: groups.name })
      .from(groupUsers)
      .innerJoin(groups, eq(groups.id, groupUsers.groupId))
      .where(inArray(groupUsers.userId, ids))
      .orderBy(byLowerText(groups.name), asc(groups.id))
    // identifiers come back from PostgreSQL in lower case, whatever the case of the requested ones
    const byId = new Map(rows.map((row) => [row.id, row]))
    return ids.flatMap((requested) => {
      const row = byId.get(requested.toLowerCase())
      if (!row) return []
      return [
        {
          id: row.id,
          email: row.email,
          role: row.role,
          groups: memberships.filter((m) => m.userId === row.id).map((m) => ({ id: m.id, name: m.name })),
        },
      ]
    })
  }
}
