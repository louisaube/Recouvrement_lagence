import { Controller, Get, UseGuards } from '@nestjs/common'
import { Access } from '../../platform/access/access.decorators'
import { ApiRoute, ApiTag } from '../../platform/openapi/route-contract'
import { ValidQuery } from '../../platform/validation/zod-validation.interceptor'
import { RequireProfile } from '../profiles/profile.guard'
import { BAD_REQUEST, FORBIDDEN, UNAUTHORIZED } from '../recovery-common/schemas'
import { QueueItemsQuery, queueCountsResponseSchema, queueItemsQuerySchema, queueItemsResponseSchema } from './decision-queue.schemas'
import { QueueReadService } from './queue-read.service'

/** rule-recouvrement-queue-contents: the supervisor alone reads the queue. The decision route comes with the lot of the day. */
@ApiTag('Decision queue')
@Controller('decision-queue')
@UseGuards(RequireProfile('supervisor'))
export class DecisionQueueController {
  constructor(private readonly service: QueueReadService) {}

  @Get('items')
  @Access({ action: 'queue:list', roles: [] })
  @ApiRoute({
    description: 'Use this API action to list the items of the decision queue, open ones oldest first by default (supervisor profile)',
    query: queueItemsQuerySchema,
    responses: { 200: { description: 'Items of the page', schema: queueItemsResponseSchema }, 400: BAD_REQUEST, 401: UNAUTHORIZED, 403: FORBIDDEN },
  })
  list(@ValidQuery() query: QueueItemsQuery) {
    return this.service.list(query)
  }

  @Get('counts')
  @Access({ action: 'queue:counts', roles: [] })
  @ApiRoute({
    description: 'Use this API action to count the open items of the decision queue by type (supervisor profile)',
    responses: { 200: { description: 'Open items by type', schema: queueCountsResponseSchema }, 401: UNAUTHORIZED, 403: FORBIDDEN },
  })
  counts() {
    return this.service.counts()
  }
}
