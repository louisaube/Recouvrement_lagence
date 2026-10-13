import { Injectable } from '@nestjs/common'
import { asc, count, eq } from 'drizzle-orm'
import { Database, InjectDb } from '../../platform/database/database.module'
import { byText } from '../../platform/database/ordering'
import { ApiError, isUniqueViolation, notFound } from '../../platform/http/errors'
import type { AuthenticatedUser } from '../../platform/http/request-context'
import { pageOf } from '../../platform/validation/common'
import { users } from '../users/users.tables'
import type { SetUserProfileBody, UserProfileDto, UserProfilesListQuery } from './profiles.schemas'
import { Channel, Profile, userProfiles } from './profiles.tables'

@Injectable()
export class ProfilesService {
  constructor(@InjectDb() private readonly db: Database) {}

  /** rule-recouvrement-profile-server-enforced: what the account is, read now. */
  async me(userId: string): Promise<{ profile: Profile | null; channel: Channel | null }> {
    const [row] = await this.db.select({ profile: userProfiles.profile, channel: userProfiles.channel }).from(userProfiles).where(eq(userProfiles.userId, userId))
    return { profile: (row?.profile as Profile) ?? null, channel: (row?.channel as Channel) ?? null }
  }

  /** rule-recouvrement-profiles-assigned-by-admin: only the accounts that have a profile, by e-mail. */
  async list(query: UserProfilesListQuery): Promise<{ items: UserProfileDto[]; total: number }> {
    const { from, size } = pageOf(query)
    const rows = await this.db
      .select({ userId: users.id, email: users.email, profile: userProfiles.profile, channel: userProfiles.channel })
      .from(userProfiles)
      .innerJoin(users, eq(users.id, userProfiles.userId))
      .orderBy(byText(users.email), asc(users.id))
      .limit(size)
      .offset(from)
    const [{ total }] = await this.db.select({ total: count() }).from(userProfiles)
    return { items: rows.map((r) => ({ ...r, profile: r.profile as Profile, channel: r.channel as Channel | null })), total: Number(total) }
  }

  /**
   * rule-recouvrement-profile-single (a new profile replaces the previous one), rule-recouvrement-own-profile-locked,
   * rule-recouvrement-agent-channel-required, rule-recouvrement-agent-one-per-channel, rule-recouvrement-agent-user-role,
   * rule-recouvrement-profile-no-delete (`profile: null` removes the row, the account stays).
   */
  async set(userId: string, body: SetUserProfileBody, actor: AuthenticatedUser): Promise<UserProfileDto> {
    return this.db.transaction(async (tx) => {
      const [account] = await tx.select({ id: users.id, email: users.email, role: users.role }).from(users).where(eq(users.id, userId)).for('no key update')
      if (!account) throw notFound()
      if (account.id.toLowerCase() === actor.id.toLowerCase()) {
        throw new ApiError(409, 'profiles.cannot_change_own_profile', 'An administrator cannot change their own profile')
      }
      const channel = body.channel ?? null
      if (body.profile === 'agent' && channel === null) {
        throw new ApiError(409, 'profiles.channel_required', 'The agent profile requires a channel')
      }
      if (body.profile !== 'agent' && channel !== null) {
        throw new ApiError(409, 'profiles.channel_not_allowed', 'Only the agent profile carries a channel')
      }
      if (body.profile === 'agent' && account.role !== 'user') {
        throw new ApiError(409, 'profiles.agent_requires_user_role', 'The agent profile requires an account with the user role')
      }
      if (body.profile === null) {
        await tx.delete(userProfiles).where(eq(userProfiles.userId, account.id))
        return { userId: account.id, email: account.email, profile: null, channel: null }
      }
      try {
        await tx.transaction(async (savepoint) => {
          await savepoint
            .insert(userProfiles)
            .values({ userId: account.id, profile: body.profile!, channel })
            .onConflictDoUpdate({ target: userProfiles.userId, set: { profile: body.profile!, channel, updatedAt: new Date() } })
        })
      } catch (error) {
        if (isUniqueViolation(error)) throw new ApiError(409, 'profiles.channel_taken', 'Another account already serves this channel')
        throw error
      }
      return { userId: account.id, email: account.email, profile: body.profile, channel }
    })
  }
}
