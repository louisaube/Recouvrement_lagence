import { Controller, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common'
import { Access } from '../../platform/access/access.decorators'
import { Audited } from '../../platform/audit/audit.decorators'
import type { ApiRequest } from '../../platform/http/request-context'
import { ApiRoute, ApiTag } from '../../platform/openapi/route-contract'
import { ValidBody, ValidParams } from '../../platform/validation/zod-validation.interceptor'
import { RequireProfile } from '../profiles/profile.guard'
import { BAD_REQUEST, FORBIDDEN, NOT_FOUND, UNAUTHORIZED } from '../recovery-common/schemas'
import { decisionLabel, QUEUE_TYPE_LABELS } from './decision-queue.constants'
import {
  QueueDecisionBody,
  queueDecisionBodySchema,
  queueDecisionResponseSchema,
  QueueItemParams,
  queueItemParamsSchema,
} from './decision-queue.schemas'
import { QueueDecisionService } from './queue-decision.service'

/** rule-recouvrement-queue-contents: the supervisor alone decides (the guard answers before anything of the request is read). */
@ApiTag('Decision queue')
@Controller('decision-queue')
@UseGuards(RequireProfile('supervisor'))
export class QueueDecisionController {
  constructor(private readonly service: QueueDecisionService) {}

  /** rule-recouvrement-queue-decision-motivated: the audit summary names the decision and the type, never the reason. */
  @Post('items/:id/decision')
  @HttpCode(200)
  @Access({ action: 'queue:decide', roles: [] })
  @Audited({
    objectType: 'Élément de file',
    describe: ({ response }) => {
      const { item } = response
      return {
        objectId: item.id,
        summary: `Décision « ${decisionLabel(item.type, item.decision.code)} » sur un élément « ${QUEUE_TYPE_LABELS[item.type as keyof typeof QUEUE_TYPE_LABELS]} ».`,
      }
    },
  })
  @ApiRoute({
    description: 'Use this API action to decide an item of the decision queue with a reason, among the decisions its type allows (supervisor profile)',
    params: queueItemParamsSchema,
    body: queueDecisionBodySchema,
    responses: {
      200: { description: 'The item after the decision', schema: queueDecisionResponseSchema },
      400: BAD_REQUEST,
      401: UNAUTHORIZED,
      403: FORBIDDEN,
      404: NOT_FOUND,
      409: { description: 'Conflict - queue.already_decided, queue.decision_not_allowed (also a transfer of a frozen or settled case), queue.invoice_not_open' },
    },
  })
  async decide(@ValidParams() params: QueueItemParams, @ValidBody() body: QueueDecisionBody, @Req() req: ApiRequest) {
    return { item: await this.service.decide(params.id, body, req.user!) }
  }
}
