import { z } from 'zod'
import { idParamsSchema, paginationQuerySchema, trimmedName, uuidFormat, uuidList } from '../../platform/validation/common'
import { scopeSchema } from '../scopes/scopes.schemas'

export const groupIdParamsSchema = idParamsSchema
export const groupsListQuerySchema = paginationQuerySchema

export const groupMemberSchema = z
  .object({
    id: uuidFormat().meta({ description: 'User ID' }),
    email: z.string().meta({ description: 'E-mail of the member', example: 'john.doe@example.com' }),
  })
  .meta({ id: 'GroupMemberDto' })

/** GroupDto (40-groupes-perimetres.md §2) */
export const groupSchema = z
  .object({
    id: uuidFormat().meta({ description: 'Group ID' }),
    name: z.string().min(1).max(100).meta({ description: 'Name of the group, unique ignoring case', example: 'Équipe Nord' }),
    members: z.array(groupMemberSchema).meta({ description: 'Members, sorted by e-mail' }),
    scopes: z.array(scopeSchema).meta({ description: 'Scopes the group gives access to, sorted by code' }),
  })
  .meta({ id: 'GroupDto' })

export const groupsListResponseSchema = z
  .object({
    groups: z.array(groupSchema),
    total: z.number().meta({ description: 'Total number of groups', example: 3 }),
  })
  .meta({ id: 'GroupsListResponseDto' })

/** rule-foundation-group-definition, -needs-scope, -members-optional, -name-unique */
export const createGroupBodySchema = z
  .object({
    name: trimmedName().meta({
      description: 'Name of the group, trimmed, not empty, unique ignoring case',
      example: 'Équipe Nord',
    }),
    userIds: uuidList(0, 1000)
      .optional()
      .meta({
        description:
          'Members of the group (rule-foundation-group-members-optional): distinct ids of existing users, none by default',
        uniqueItems: true,
      }),
    scopeIds: uuidList(1, 200).meta({
      description: 'Scopes of the group (rule-foundation-group-needs-scope): 1 or more distinct ids of existing scopes',
      uniqueItems: true,
    }),
  })
  .meta({ id: 'GroupsCreateParamsDto' })

export const createGroupResponseSchema = z.object({ group: groupSchema }).meta({ id: 'GroupsCreateResponseDto' })

/** rule-foundation-group-definition: each provided field replaces the current value; unknown keys are refused. */
export const updateGroupBodySchema = z
  .strictObject({
    name: trimmedName().optional().meta({ description: 'New name of the group, trimmed, not empty' }),
    userIds: uuidList(0, 1000)
      .optional()
      .meta({ description: 'New set of members (replaces the current one, [] removes all)', uniqueItems: true }),
    scopeIds: uuidList(1, 200)
      .optional()
      .meta({ description: 'New set of scopes (replaces the current one), at least 1', uniqueItems: true }),
  })
  // the contract of record declares no `additionalProperties` on the body: the refusal of unknown keys is applied, not published
  .meta({ id: 'GroupsUpdateParamsDto', additionalProperties: undefined })

export const updateGroupResponseSchema = z.object({ group: groupSchema }).meta({ id: 'GroupsUpdateResponseDto' })

export type GroupDto = z.infer<typeof groupSchema>
export type GroupsListQuery = z.infer<typeof groupsListQuerySchema>
export type CreateGroupBody = z.infer<typeof createGroupBodySchema>
export type UpdateGroupBody = z.infer<typeof updateGroupBodySchema>
