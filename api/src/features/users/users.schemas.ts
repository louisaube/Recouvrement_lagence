import { z } from 'zod'
import { emailSchema } from '../../platform/validation/email'
import { idParamsSchema, paginationQuerySchema, uuidFormat, uuidList } from '../../platform/validation/common'

export const userIdParamsSchema = idParamsSchema
export const usersListQuerySchema = paginationQuerySchema

/** rule-foundation-user-create-fields. Component names are those of the contract of record. */
export const createUserBodySchema = z
  .object({
    email: emailSchema.max(254).meta({ description: 'Email of the user (at most 254 characters)', example: 'john.doe@example.com' }),
    password: z.string().min(8).max(72).meta({ description: 'Password of the user (8 to 72 characters)', example: 'securePassword123' }),
    role: z.enum(['user', 'admin']).meta({ description: 'Role of the user', example: 'user' }),
    groupIds: uuidList(0, 100)
      .optional()
      .meta({
        description:
          'Groups of the user (rule-foundation-user-groups-membership): distinct ids of existing groups, none by default',
        uniqueItems: true,
      }),
  })
  .meta({ id: 'UsersCreateParamsDto' })

export const userGroupSchema = z
  .object({
    id: uuidFormat().meta({ description: 'Group ID' }),
    name: z.string().meta({ description: 'Name of the group', example: 'Équipe Nord' }),
  })
  .meta({ id: 'GroupRefDto' })

/** UserDto (30-comptes.md §1) */
export const userSchema = z
  .object({
    id: z.string().meta({ description: 'User ID', example: '123' }),
    email: z.string().meta({ description: 'Email of the user', example: 'john.doe@example.com' }),
    role: z.enum(['admin', 'user']).meta({ description: 'Role name the user has' }),
    groups: z
      .array(userGroupSchema)
      .meta({ description: 'Groups the user belongs to (rule-foundation-user-groups-membership), sorted by name' }),
  })
  .meta({ id: 'UserDto' })

export const createUserResponseSchema = z.object({ user: userSchema }).meta({ id: 'UsersCreateResponseDto' })

export const usersListResponseSchema = z
  .object({
    users: z.array(userSchema),
    total: z.number().meta({ description: 'Total number of users matching the criteria', example: 100 }),
  })
  .meta({ id: 'UsersListResponseDto' })

export const getUserResponseSchema = z.object({ user: userSchema }).meta({ id: 'UserGetResponseDto' })

/** rule-foundation-user-edit-scope: only the role and the groups; any other key is refused (strict object). */
export const updateUserBodySchema = z
  .strictObject({
    role: z.enum(['user', 'admin']).optional().meta({ description: 'New role of the user' }),
    groupIds: uuidList(0, 100)
      .optional()
      .meta({ description: 'New groups of the user (replaces the current ones, [] removes all)', uniqueItems: true }),
  })
  // the contract of record declares no `additionalProperties` on the body: the refusal of unknown keys is applied, not published
  .meta({ id: 'UsersUpdateParamsDto', additionalProperties: undefined })

export const updateUserResponseSchema = z.object({ user: userSchema }).meta({ id: 'UsersUpdateResponseDto' })

export type CreateUserBody = z.infer<typeof createUserBodySchema>
export type UpdateUserBody = z.infer<typeof updateUserBodySchema>
export type UsersListQuery = z.infer<typeof usersListQuerySchema>
export type UserDto = z.infer<typeof userSchema>
