import { Controller, Get, HttpCode, Post, Req, UseGuards } from '@nestjs/common'
import { Access } from '../../platform/access/access.decorators'
import { Audited } from '../../platform/audit/audit.decorators'
import type { ApiRequest } from '../../platform/http/request-context'
import { ApiRoute, ApiTag } from '../../platform/openapi/route-contract'
import { ValidBody, ValidParams, ValidQuery } from '../../platform/validation/zod-validation.interceptor'
import { RequireProfile } from '../profiles/profile.guard'
import { BAD_REQUEST, FORBIDDEN, NOT_FOUND, UNAUTHORIZED } from '../recovery-common/schemas'
import { BatchPreparationService } from './batch-preparation.service'
import {
  BatchesListQuery,
  batchesListQuerySchema,
  batchesListResponseSchema,
  BatchOrdersQuery,
  batchOrdersQuerySchema,
  batchOrdersResponseSchema,
  BatchParams,
  batchParamsSchema,
  batchResponseSchema,
  ReleaseBatchBody,
  releaseBatchBodySchema,
} from './batches.schemas'
import { BatchesService } from './batches.service'

const frenchDate = (iso: string): string => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`

/**
 * rule-recouvrement-batch-prepared-by-supervisor (user): the daily batch is for the profile `supervisor` only (the guard
 * answers before anything of the request is read); the other profiles, a plain user and a profile-less admin get 403.
 */
@ApiTag('Daily batches')
@Controller('daily-batches')
@UseGuards(RequireProfile('supervisor'))
export class BatchesController {
  constructor(
    private readonly service: BatchesService,
    private readonly preparation: BatchPreparationService,
  ) {}

  @Get()
  @Access({ action: 'batches:list', roles: [] })
  @ApiRoute({
    description: 'Use this API action to list the daily batches, the most recent first (supervisor profile)',
    query: batchesListQuerySchema,
    responses: { 200: { description: 'Batches of the page', schema: batchesListResponseSchema }, 400: BAD_REQUEST, 401: UNAUTHORIZED, 403: FORBIDDEN },
  })
  list(@ValidQuery() query: BatchesListQuery) {
    return this.service.list(query)
  }

  @Get(':id')
  @Access({ action: 'batches:get', roles: [] })
  @ApiRoute({
    description: 'Use this API action to read a daily batch with its checks, shares, exclusions and orders by type (supervisor profile)',
    params: batchParamsSchema,
    responses: {
      200: { description: 'The batch', schema: batchResponseSchema },
      400: BAD_REQUEST,
      401: UNAUTHORIZED,
      403: FORBIDDEN,
      404: NOT_FOUND,
    },
  })
  async get(@ValidParams() params: BatchParams) {
    return { batch: await this.service.get(params.id) }
  }

  @Get(':id/orders')
  @Access({ action: 'batches:orders', roles: [] })
  @ApiRoute({
    description: 'Use this API action to browse the send orders of a daily batch, by customer identifier then type (supervisor profile)',
    params: batchParamsSchema,
    query: batchOrdersQuerySchema,
    responses: {
      200: { description: 'Orders of the page', schema: batchOrdersResponseSchema },
      400: BAD_REQUEST,
      401: UNAUTHORIZED,
      403: FORBIDDEN,
      404: NOT_FOUND,
    },
  })
  orders(@ValidParams() params: BatchParams, @ValidQuery() query: BatchOrdersQuery) {
    return this.service.orders(params.id, query)
  }

  /** rule-recouvrement-batch-prepared-by-supervisor: no body, the supervisor triggers the preparation. */
  @Post()
  @Access({ action: 'batches:prepare', roles: [] })
  @Audited({
    objectType: 'Lot du jour',
    describe: ({ response }) => {
      const { batch } = response
      const orders = `${batch.orderCount} ordre${batch.orderCount > 1 ? 's' : ''}`
      return {
        objectId: batch.id,
        summary: `Lot du jour du ${frenchDate(batch.date)} préparé : ${orders}, ${batch.status === 'ready' ? 'prêt' : 'bloqué'}.`,
      }
    },
  })
  @ApiRoute({
    description: 'Use this API action to prepare the daily batch: the brain decides every case, the orders are built and the checks run (supervisor profile)',
    responses: {
      201: { description: 'The batch, ready when every check passes, blocked otherwise', schema: batchResponseSchema },
      401: UNAUTHORIZED,
      403: FORBIDDEN,
      409: { description: 'Conflict - batches.already_released (the batch of the day is ready), batches.no_active_policy' },
    },
  })
  async prepare(@Req() req: ApiRequest) {
    return { batch: await this.preparation.prepare(req.user!) }
  }

  /** rule-recouvrement-batch-blocked-release-by-decision: only a reasoned decision releases a blocked batch. */
  @Post(':id/release')
  @HttpCode(200)
  @Access({ action: 'batches:release', roles: [] })
  @Audited({
    objectType: 'Lot du jour',
    describe: ({ response }) => ({
      objectId: response.batch.id,
      summary: `Lot du jour du ${frenchDate(response.batch.date)} libéré par décision du superviseur.`,
    }),
  })
  @ApiRoute({
    description: 'Use this API action to release a blocked daily batch by a reasoned decision; the failed checks stay displayed (supervisor profile)',
    params: batchParamsSchema,
    body: releaseBatchBodySchema,
    responses: {
      200: { description: 'The batch, ready', schema: batchResponseSchema },
      400: BAD_REQUEST,
      401: UNAUTHORIZED,
      403: FORBIDDEN,
      404: NOT_FOUND,
      409: { description: 'Conflict - batches.not_releasable (the batch is not blocked)' },
    },
  })
  async release(@ValidParams() params: BatchParams, @ValidBody() body: ReleaseBatchBody, @Req() req: ApiRequest) {
    return { batch: await this.service.release(params.id, body, req.user!) }
  }
}
