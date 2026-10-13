import { z } from 'zod'
import { idParamsSchema, paginationQuerySchema, uuidFormat } from '../../platform/validation/common'

export const profileSchema = z.enum(['supervisor', 'agent', 'litigation', 'indicators']).meta({ id: 'ProfileDto', description: 'Recovery profile' })
export const channelSchema = z.enum(['voice', 'email_sms', 'mail']).meta({ id: 'ChannelDto', description: 'Channel of an agent account' })

export const profilesMeResponseSchema = z
  .object({ profile: profileSchema.nullable(), channel: channelSchema.nullable() })
  .meta({ id: 'ProfilesMeResponseDto' })

export const userProfileSchema = z
  .object({
    userId: uuidFormat().meta({ description: 'Account ID' }),
    email: z.string().meta({ description: 'E-mail of the account' }),
    profile: profileSchema.nullable(),
    channel: channelSchema.nullable(),
  })
  .meta({ id: 'UserProfileDto' })

export const userProfilesListQuerySchema = paginationQuerySchema
export const userProfilesListResponseSchema = z
  .object({ items: z.array(userProfileSchema), total: z.number().meta({ description: 'Number of accounts that have a profile' }) })
  .meta({ id: 'UserProfilesListResponseDto' })

export const userProfileParamsSchema = z.object({ userId: idParamsSchema.shape.id })

/** rule-recouvrement-profiles-assigned-by-admin: strict body, `profile: null` removes the profile. */
export const setUserProfileBodySchema = z
  .strictObject({
    profile: profileSchema.nullable().meta({ description: 'The profile, or null to remove it' }),
    channel: channelSchema.nullable().optional().meta({ description: 'Required for the agent profile, refused otherwise' }),
  })
  .meta({ id: 'SetUserProfileParamsDto', additionalProperties: undefined })

export const setUserProfileResponseSchema = z.object({ userProfile: userProfileSchema }).meta({ id: 'SetUserProfileResponseDto' })

export type UserProfilesListQuery = z.infer<typeof userProfilesListQuerySchema>
export type SetUserProfileBody = z.infer<typeof setUserProfileBodySchema>
export type UserProfileDto = z.infer<typeof userProfileSchema>
export type UserProfileParams = z.infer<typeof userProfileParamsSchema>
