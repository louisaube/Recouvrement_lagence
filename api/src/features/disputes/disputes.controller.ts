import { Controller, Get, UseGuards } from '@nestjs/common'
import { Access } from '../../platform/access/access.decorators'
import { ApiRoute, ApiTag } from '../../platform/openapi/route-contract'
import { ValidParams, ValidQuery } from '../../platform/validation/zod-validation.interceptor'
import { RequireProfile } from '../profiles/profile.guard'
import { BAD_REQUEST, FORBIDDEN, NOT_FOUND, UNAUTHORIZED } from '../recovery-common/schemas'
import {
  DisputeInvoicesQuery,
  disputeInvoicesQuerySchema,
  disputeInvoicesResponseSchema,
  DisputeParams,
  disputeParamsSchema,
  disputeResponseSchema,
  DisputesListQuery,
  disputesListQuerySchema,
  disputesListResponseSchema,
} from './disputes.schemas'
import { DisputesService } from './disputes.service'

/**
 * rule-recouvrement-disputes-litigation-only: the disputes are for the profile `litigation` only (the supervisor gets
 * 403). `invoices` is declared before `:id`.
 */
@ApiTag('Disputes')
@Controller('disputes')
@UseGuards(RequireProfile('litigation'))
export class DisputesController {
  constructor(private readonly service: DisputesService) {}

  @Get()
  @Access({ action: 'disputes:list', roles: [] })
  @ApiRoute({
    description: 'Use this API action to list the disputes (open by default), with their invoice and the state of their case (litigation profile)',
    query: disputesListQuerySchema,
    responses: { 200: { description: 'Disputes of the page', schema: disputesListResponseSchema }, 400: BAD_REQUEST, 401: UNAUTHORIZED, 403: FORBIDDEN },
  })
  list(@ValidQuery() query: DisputesListQuery) {
    return this.service.list(query)
  }

  @Get('invoices')
  @Access({ action: 'disputes:invoice-search', roles: [] })
  @ApiRoute({
    description: 'Use this API action to search the open invoices by the beginning of their number, to open a dispute (litigation profile)',
    query: disputeInvoicesQuerySchema,
    responses: { 200: { description: 'Invoices of the page', schema: disputeInvoicesResponseSchema }, 400: BAD_REQUEST, 401: UNAUTHORIZED, 403: FORBIDDEN },
  })
  invoices(@ValidQuery() query: DisputeInvoicesQuery) {
    return this.service.invoices(query)
  }

  @Get(':id')
  @Access({ action: 'disputes:get', roles: [] })
  @ApiRoute({
    description: 'Use this API action to read a dispute with its invoice, the summary of its case and its contestation (litigation profile)',
    params: disputeParamsSchema,
    responses: {
      200: { description: 'The dispute', schema: disputeResponseSchema },
      400: BAD_REQUEST,
      401: UNAUTHORIZED,
      403: FORBIDDEN,
      404: NOT_FOUND,
    },
  })
  async get(@ValidParams() params: DisputeParams) {
    return { dispute: await this.service.get(params.id) }
  }
}
