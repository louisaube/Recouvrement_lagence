import { Controller, Get, Patch, Post } from '@nestjs/common'
import { Access } from '../../platform/access/access.decorators'
import { count, fieldNames } from '../../platform/audit/audit-text'
import { Audited } from '../../platform/audit/audit.decorators'
import { ApiRoute, ApiTag } from '../../platform/openapi/route-contract'
import type { IdParams } from '../../platform/validation/common'
import { ValidBody, ValidParams, ValidQuery } from '../../platform/validation/zod-validation.interceptor'
import {
  CreateGroupBody,
  createGroupBodySchema,
  createGroupResponseSchema,
  groupIdParamsSchema,
  GroupsListQuery,
  groupsListQuerySchema,
  groupsListResponseSchema,
  UpdateGroupBody,
  updateGroupBodySchema,
  updateGroupResponseSchema,
} from './groups.schemas'
import { GroupsService } from './groups.service'

/** French names of the fields of `PATCH /groups/:id`, for the summary of the trace (names, never values). */
const GROUP_FIELDS = { name: 'nom', userIds: 'membres', scopeIds: 'périmètres' }

const FORBIDDEN = { description: 'Forbidden - insufficient role permissions' }
const UNAUTHORIZED = { description: 'Unauthorized' }

/** rule-foundation-groups-admin-screen: the three routes are reserved to administrators. */
@Controller('groups')
@ApiTag('Groups')
export class GroupsController {
  constructor(private readonly service: GroupsService) {}

  @Get()
  @Access({ action: 'groups:list', roles: ['admin'] })
  @ApiRoute({
    description: 'Use this API action to list the groups with their members and scopes',
    query: groupsListQuerySchema,
    responses: {
      200: { description: 'List of groups', schema: groupsListResponseSchema },
      401: UNAUTHORIZED,
      403: FORBIDDEN,
    },
  })
  list(@ValidQuery() query: GroupsListQuery) {
    return this.service.list(query)
  }

  @Post()
  @Access({ action: 'groups:create', roles: ['admin'] })
  @Audited({
    objectType: 'Groupe',
    describe: ({ response }) => ({
      objectId: response.group.id,
      summary:
        `Création du groupe « ${response.group.name} » (${count(response.group.members.length, 'membre')}, ` +
        `${count(response.group.scopes.length, 'périmètre')} : ${response.group.scopes.map((s: { code: string }) => s.code).join(', ')})`,
    }),
  })
  @ApiRoute({
    description: 'Use this API action to create a group with its members and scopes in one request',
    body: createGroupBodySchema,
    responses: {
      201: { description: 'Group created successfully', schema: createGroupResponseSchema },
      401: UNAUTHORIZED,
      403: FORBIDDEN,
    },
  })
  async create(@ValidBody() body: CreateGroupBody) {
    return { group: await this.service.create(body) }
  }

  @Patch(':id')
  @Access({ action: 'groups:update', roles: ['admin'] })
  @Audited({
    objectType: 'Groupe',
    describe: ({ response, sentFields }) => ({
      objectId: response.group.id,
      summary: `Modification du groupe « ${response.group.name} » (${fieldNames(sentFields, GROUP_FIELDS)})`,
    }),
  })
  @ApiRoute({
    description:
      'Use this API action to change the name, members and/or scopes of a group. Provided fields replace the current values',
    params: groupIdParamsSchema,
    body: updateGroupBodySchema,
    responses: {
      200: { description: 'Group updated successfully', schema: updateGroupResponseSchema },
      401: UNAUTHORIZED,
      403: FORBIDDEN,
    },
  })
  async update(@ValidParams() params: IdParams, @ValidBody() body: UpdateGroupBody) {
    return { group: await this.service.update(params.id, body) }
  }
}
