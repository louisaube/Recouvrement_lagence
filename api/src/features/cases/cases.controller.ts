import { Controller, Get, UseGuards } from '@nestjs/common'
import { Access } from '../../platform/access/access.decorators'
import { ApiRoute, ApiTag } from '../../platform/openapi/route-contract'
import { ValidParams, ValidQuery } from '../../platform/validation/zod-validation.interceptor'
import { RequireProfile } from '../profiles/profile.guard'
import { BAD_REQUEST, FORBIDDEN, NOT_FOUND, UNAUTHORIZED } from '../recovery-common/schemas'
import { CasesService } from './cases.service'
import {
  CaseIdParams,
  caseIdParamsSchema,
  CasePageQuery,
  casePageQuerySchema,
  caseResponseSchema,
  CasesListQuery,
  casesFiltersResponseSchema,
  casesListQuerySchema,
  casesListResponseSchema,
  decisionsListResponseSchema,
  InvoicesSearchQuery,
  invoicesSearchQuerySchema,
  invoicesSearchResponseSchema,
  stateHistoryResponseSchema,
} from './cases.schemas'

/**
 * rule-recouvrement-cases-supervisor-only: every route is reserved to the profile `supervisor` (the guard runs before the
 * validation: a refused caller learns nothing about the case asked for).
 */
@ApiTag('Cases')
@Controller()
@UseGuards(RequireProfile('supervisor'))
export class CasesController {
  constructor(private readonly service: CasesService) {}

  @Get('cases')
  @Access({ action: 'cases:list', roles: [] })
  @ApiRoute({
    description: 'Use this API action to list and filter the debtor cases, by negotiable amount then customer identifier (supervisor profile)',
    query: casesListQuerySchema,
    responses: { 200: { description: 'The cases of the page', schema: casesListResponseSchema }, 400: BAD_REQUEST, 401: UNAUTHORIZED, 403: FORBIDDEN },
  })
  list(@ValidQuery() query: CasesListQuery) {
    return this.service.list(query)
  }

  // Declared before `cases/:id`.
  @Get('cases/filters')
  @Access({ action: 'cases:filters', roles: [] })
  @ApiRoute({
    description: 'Use this API action to read the segments and creditor entities present in the cases (supervisor profile)',
    responses: { 200: { description: 'Sorted values', schema: casesFiltersResponseSchema }, 401: UNAUTHORIZED, 403: FORBIDDEN },
  })
  filters() {
    return this.service.filtersLists()
  }

  @Get('cases/:id')
  @Access({ action: 'cases:get', roles: [] })
  @ApiRoute({
    description: 'Use this API action to read the sheet of a case: invoices, freezes, offers, commitments, outputs (supervisor profile)',
    params: caseIdParamsSchema,
    responses: {
      200: { description: 'The case', schema: caseResponseSchema },
      400: BAD_REQUEST,
      401: UNAUTHORIZED,
      403: FORBIDDEN,
      404: NOT_FOUND,
    },
  })
  async get(@ValidParams() params: CaseIdParams) {
    return { case: await this.service.get(params.id) }
  }

  @Get('cases/:id/decisions')
  @Access({ action: 'cases:decisions', roles: [] })
  @ApiRoute({
    description: 'Use this API action to read the decisions of the brain about a case, most recent first (supervisor profile)',
    params: caseIdParamsSchema,
    query: casePageQuerySchema,
    responses: {
      200: { description: 'The decisions of the page', schema: decisionsListResponseSchema },
      400: BAD_REQUEST,
      401: UNAUTHORIZED,
      403: FORBIDDEN,
      404: NOT_FOUND,
    },
  })
  decisions(@ValidParams() params: CaseIdParams, @ValidQuery() query: CasePageQuery) {
    return this.service.decisions(params.id, query)
  }

  @Get('cases/:id/state-history')
  @Access({ action: 'cases:state-history', roles: [] })
  @ApiRoute({
    description: 'Use this API action to read the state transitions of a case, most recent first (supervisor profile)',
    params: caseIdParamsSchema,
    query: casePageQuerySchema,
    responses: {
      200: { description: 'The transitions of the page', schema: stateHistoryResponseSchema },
      400: BAD_REQUEST,
      401: UNAUTHORIZED,
      403: FORBIDDEN,
      404: NOT_FOUND,
    },
  })
  stateHistory(@ValidParams() params: CaseIdParams, @ValidQuery() query: CasePageQuery) {
    return this.service.stateHistory(params.id, query)
  }

  @Get('invoices')
  @Access({ action: 'invoices:search', roles: [] })
  @ApiRoute({
    description: 'Use this API action to search the open invoices by the beginning of their number (supervisor profile)',
    query: invoicesSearchQuerySchema,
    responses: { 200: { description: 'Open invoices of the page', schema: invoicesSearchResponseSchema }, 400: BAD_REQUEST, 401: UNAUTHORIZED, 403: FORBIDDEN },
  })
  searchInvoices(@ValidQuery() query: InvoicesSearchQuery) {
    return this.service.searchInvoices(query)
  }
}
