import { Controller, Get, Patch, Post } from '@nestjs/common'
import { Access } from '../../platform/access/access.decorators'
import { Audited } from '../../platform/audit/audit.decorators'
import { ApiRoute, ApiTag } from '../../platform/openapi/route-contract'
import type { IdParams } from '../../platform/validation/common'
import { ValidBody, ValidParams, ValidQuery } from '../../platform/validation/zod-validation.interceptor'
import {
  CreateScopeBody,
  createScopeBodySchema,
  createScopeResponseSchema,
  scopeIdParamsSchema,
  ScopesListQuery,
  scopesListQuerySchema,
  scopesListResponseSchema,
  UpdateScopeBody,
  updateScopeBodySchema,
  updateScopeResponseSchema,
} from './scopes.schemas'
import { ScopesService } from './scopes.service'

const FORBIDDEN = { description: 'Forbidden - insufficient role permissions' }
const UNAUTHORIZED = { description: 'Unauthorized' }

/** rule-foundation-scopes-admin-screen: the three routes are reserved to administrators. */
@Controller('scopes')
@ApiTag('Scopes')
export class ScopesController {
  constructor(private readonly service: ScopesService) {}

  @Get()
  @Access({ action: 'scopes:list', roles: ['admin'] })
  @ApiRoute({
    description: 'Use this API action to list the scopes, sorted by code',
    query: scopesListQuerySchema,
    responses: {
      200: { description: 'List of scopes', schema: scopesListResponseSchema },
      401: UNAUTHORIZED,
      403: FORBIDDEN,
    },
  })
  list(@ValidQuery() query: ScopesListQuery) {
    return this.service.list(query)
  }

  @Post()
  @Access({ action: 'scopes:create', roles: ['admin'] })
  @Audited({
    objectType: 'Périmètre',
    describe: ({ response }) => ({
      objectId: response.scope.id,
      scope: response.scope.code,
      summary: `Création du périmètre « ${response.scope.name} » (${response.scope.code})`,
    }),
  })
  @ApiRoute({
    description: 'Use this API action to create a scope',
    body: createScopeBodySchema,
    responses: {
      201: { description: 'Scope created successfully', schema: createScopeResponseSchema },
      401: UNAUTHORIZED,
      403: FORBIDDEN,
    },
  })
  async create(@ValidBody() body: CreateScopeBody) {
    return { scope: await this.service.create(body) }
  }

  @Patch(':id')
  @Access({ action: 'scopes:update', roles: ['admin'] })
  @Audited({
    objectType: 'Périmètre',
    describe: ({ response }) => ({
      objectId: response.scope.id,
      scope: response.scope.code,
      summary: `Modification du périmètre ${response.scope.code} (nouveau nom : « ${response.scope.name} »)`,
    }),
  })
  @ApiRoute({
    description: 'Use this API action to rename a scope. The code cannot be changed',
    params: scopeIdParamsSchema,
    body: updateScopeBodySchema,
    responses: {
      200: { description: 'Scope renamed successfully', schema: updateScopeResponseSchema },
      401: UNAUTHORIZED,
      403: FORBIDDEN,
    },
  })
  async update(@ValidParams() params: IdParams, @ValidBody() body: UpdateScopeBody) {
    return { scope: await this.service.rename(params.id, body) }
  }
}
