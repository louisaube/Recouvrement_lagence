import { Controller, Get, Patch, Post, Req, UseGuards } from '@nestjs/common'
import { Access } from '../../platform/access/access.decorators'
import type { ApiRequest } from '../../platform/http/request-context'
import { count, fieldNames } from '../../platform/audit/audit-text'
import { Audited } from '../../platform/audit/audit.decorators'
import { ApiRoute, ApiTag } from '../../platform/openapi/route-contract'
import type { IdParams } from '../../platform/validation/common'
import { ValidBody, ValidParams, ValidQuery } from '../../platform/validation/zod-validation.interceptor'
import { SelfOrAdminGuard } from './users.guards'
import {
  CreateUserBody,
  createUserBodySchema,
  createUserResponseSchema,
  getUserResponseSchema,
  UpdateUserBody,
  updateUserBodySchema,
  updateUserResponseSchema,
  userIdParamsSchema,
  UsersListQuery,
  usersListQuerySchema,
  usersListResponseSchema,
} from './users.schemas'
import { UsersService } from './users.service'

/** French names of the fields of `PATCH /users/:id`, for the summary of the trace (names, never values). */
const USER_FIELDS = { role: 'rôle', groupIds: 'groupes' }
const roleLabel = (role: string): string => (role === 'admin' ? 'Administrateur' : 'Utilisateur')

const FORBIDDEN = { description: 'Forbidden - insufficient role permissions' }
const UNAUTHORIZED = { description: 'Unauthorized' }

@Controller('users')
@ApiTag('Users')
export class UsersController {
  constructor(private readonly service: UsersService) {}

  /** rule-foundation-users-list-admin-only: administrators only. */
  @Get()
  @Access({ action: 'users:list', roles: ['admin'] })
  @ApiRoute({
    description: 'Use this API action to list users (administrators only)',
    query: usersListQuerySchema,
    responses: {
      200: { description: 'List of users with their groups', schema: usersListResponseSchema },
      401: UNAUTHORIZED,
      403: FORBIDDEN,
    },
  })
  list(@ValidQuery() query: UsersListQuery) {
    return this.service.list(query)
  }

  /** rule-foundation-users-admin-screen, rule-foundation-no-self-signup: admin only. */
  @Post()
  @Access({ action: 'users:create', roles: ['admin'] })
  @Audited({
    objectType: 'Utilisateur',
    describe: ({ response }) => ({
      objectId: response.user.id,
      summary: `Création du compte ${response.user.email} (rôle ${roleLabel(response.user.role)}, ${count(response.user.groups.length, 'groupe')})`,
    }),
  })
  @ApiRoute({
    description: 'Use this API action to create a new user, optionally in some groups',
    body: createUserBodySchema,
    responses: {
      201: { description: 'User created successfully', schema: createUserResponseSchema },
      401: UNAUTHORIZED,
      403: FORBIDDEN,
    },
  })
  async create(@ValidBody() body: CreateUserBody) {
    return { user: await this.service.create(body) }
  }

  /**
   * rule-foundation-users-get-self-or-admin: an administrator reads any account, an ordinary user only their own
   * (business guard, before the validation of the parameters and any lookup).
   */
  @Get(':id')
  @Access({ action: 'users:get', roles: ['user'], ownerOnly: true })
  @UseGuards(SelfOrAdminGuard)
  @ApiRoute({
    description: 'Use this API action to get a single user. An ordinary user can only read their own account',
    params: userIdParamsSchema,
    responses: {
      200: { description: 'User with their groups', schema: getUserResponseSchema },
      401: UNAUTHORIZED,
      403: FORBIDDEN,
    },
  })
  async get(@ValidParams() params: IdParams) {
    return { user: await this.service.get(params.id) }
  }

  /** rule-foundation-users-admin-screen, rule-foundation-user-edit-scope, rule-foundation-user-own-role-locked. */
  @Patch(':id')
  @Access({ action: 'users:update', roles: ['admin'] })
  @Audited({
    objectType: 'Utilisateur',
    describe: ({ response, sentFields }) => ({
      objectId: response.user.id,
      summary: `Modification du compte ${response.user.email} (${fieldNames(sentFields, USER_FIELDS)})`,
    }),
  })
  @ApiRoute({
    description: 'Use this API action to change the role and/or the groups of a user',
    params: userIdParamsSchema,
    body: updateUserBodySchema,
    responses: {
      200: { description: 'User updated successfully', schema: updateUserResponseSchema },
      401: UNAUTHORIZED,
      403: FORBIDDEN,
    },
  })
  async update(@ValidParams() params: IdParams, @ValidBody() body: UpdateUserBody, @Req() req: ApiRequest) {
    return { user: await this.service.update(params.id, body, req.user!) }
  }
}
