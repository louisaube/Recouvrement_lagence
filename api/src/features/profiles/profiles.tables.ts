import { sql } from 'drizzle-orm'
import { check, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { base } from '../../platform/database/base-schema'
import { users } from '../users/users.tables'

export const PROFILES = ['supervisor', 'agent', 'litigation', 'indicators'] as const
export const CHANNELS = ['voice', 'email_sms', 'mail'] as const
export type Profile = (typeof PROFILES)[number]
export type Channel = (typeof CHANNELS)[number]

/**
 * Recovery profile of an account (module recouvrement; an addition to the data contract, see DISPUTES.md).
 * rule-recouvrement-profile-single: the primary key is the account, one profile at most.
 * rule-recouvrement-agent-channel-required: the CHECK ties the channel to the agent profile.
 * rule-recouvrement-agent-one-per-channel: partial unique index on the channel of the agent accounts.
 * rule-recouvrement-agent-user-role: triggers of the migration `profiles_triggers` (agent only on a `user` account).
 */
export const userProfiles = base.table(
  'user_profiles',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    profile: text('profile').notNull(),
    channel: text('channel'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('user_profiles_profile_check', sql`${table.profile} in ('supervisor', 'agent', 'litigation', 'indicators')`),
    check('user_profiles_channel_check', sql`${table.channel} is null or ${table.channel} in ('voice', 'email_sms', 'mail')`),
    check('user_profiles_agent_channel_check', sql`(${table.profile} = 'agent') = (${table.channel} is not null)`),
    uniqueIndex('user_profiles_agent_channel_unique').on(table.channel).where(sql`${table.profile} = 'agent'`),
  ],
)
