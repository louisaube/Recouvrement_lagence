import { Controller, Get, HttpCode, Post, Req, UseGuards } from '@nestjs/common'
import { Access } from '../../platform/access/access.decorators'
import { Audited, AuditExempt } from '../../platform/audit/audit.decorators'
import type { ApiRequest } from '../../platform/http/request-context'
import { ApiRoute, ApiTag } from '../../platform/openapi/route-contract'
import { ValidParams, ValidQuery } from '../../platform/validation/zod-validation.interceptor'
import {
  ImportErrorsQuery,
  importErrorsListSchema,
  importErrorsQuerySchema,
  MULTIPART_FILE_BODY,
} from '../imports/imports.schemas'
import { RequireProfile } from '../profiles/profile.guard'
import { BAD_REQUEST, FORBIDDEN, NOT_FOUND, UNAUTHORIZED } from '../recovery-common/schemas'
import { importTypeStorage } from './import-type.context'
import { OBJECT_TYPE_OF } from './recovery-imports.constants'
import {
  confirmResponseSchema,
  HistoryQuery,
  historyQuerySchema,
  historyResponseSchema,
  ImportParams,
  importParamsSchema,
  PreviewQuery,
  previewQuerySchema,
  previewResponseSchema,
  reportItemsQuerySchema,
  reportItemsResponseSchema,
  ReportItemsQuery,
  reportSchema,
  specificationSchema,
  statusSchema,
  TypeParams,
  typeParamsSchema,
} from './recovery-imports.schemas'
import { RecoveryImportsService } from './recovery-imports.service'

/**
 * rule-recouvrement-import-supervisor-only: the five imports of the module are for the profile `supervisor` only (the
 * guard runs before anything of the request is read). `history` and `status` are declared before the routes with a
 * `:type` segment.
 */
@ApiTag('Recovery imports')
@Controller('recovery-imports')
@UseGuards(RequireProfile('supervisor'))
export class RecoveryImportsController {
  constructor(private readonly service: RecoveryImportsService) {}

  @Get('history')
  @Access({ action: 'recovery-imports:history', roles: [] })
  @ApiRoute({
    description: 'Use this API action to list the confirmed imports of the module, newest first (supervisor profile)',
    query: historyQuerySchema,
    responses: { 200: { description: 'Imports of the page', schema: historyResponseSchema }, 400: BAD_REQUEST, 401: UNAUTHORIZED, 403: FORBIDDEN },
  })
  history(@ValidQuery() query: HistoryQuery) {
    return this.service.history(query)
  }

  @Get('status')
  @Access({ action: 'recovery-imports:status', roles: [] })
  @ApiRoute({
    description: 'Use this API action to know whether the bank statement is fresh, the date of the receivables extraction and the last import of each type',
    responses: { 200: { description: 'State of the imports', schema: statusSchema }, 401: UNAUTHORIZED, 403: FORBIDDEN },
  })
  status() {
    return this.service.status()
  }

  @Get(':type/specification')
  @Access({ action: 'recovery-imports:specification', roles: [] })
  @ApiRoute({
    description: 'Use this API action to read the columns, the limits and the extra fields of a file type',
    params: typeParamsSchema,
    responses: { 200: { description: 'Specification of the file', schema: specificationSchema }, 400: BAD_REQUEST, 401: UNAUTHORIZED, 403: FORBIDDEN },
  })
  specification(@ValidParams() params: TypeParams) {
    return this.service.specification(params.type)
  }

  @Post(':type/preview')
  @HttpCode(200)
  @Access({ action: 'recovery-imports:preview', roles: [] })
  @AuditExempt('The preview writes only the temporary state of the analysis; the confirmation is the traced action')
  @ApiRoute({
    description: 'Use this API action to analyse a file of a type without writing anything but its temporary preview',
    params: typeParamsSchema,
    query: previewQuerySchema,
    rawBody: { contentType: 'multipart/form-data', schema: MULTIPART_FILE_BODY },
    responses: {
      200: { description: 'The analysis of the file and the identifier of the preview', schema: previewResponseSchema },
      400: { description: 'Bad request - imports.invalid_file_type, imports.control_total_required, imports.control_total_invalid or invalid input' },
      401: UNAUTHORIZED,
      403: FORBIDDEN,
      409: { description: 'Conflict - imports.already_imported' },
      413: { description: 'Payload too large - imports.file_too_large' },
    },
  })
  preview(@ValidParams() params: TypeParams, @ValidQuery() query: PreviewQuery, @Req() req: ApiRequest) {
    return this.service.preview(params.type, query, req)
  }

  @Get(':type/:importId/errors')
  @Access({ action: 'recovery-imports:errors', roles: [] })
  @ApiRoute({
    description: 'Use this API action to list the errors of a preview, by row',
    params: importParamsSchema,
    query: importErrorsQuerySchema,
    responses: { 200: { description: 'Errors of the page', schema: importErrorsListSchema }, 400: BAD_REQUEST, 401: UNAUTHORIZED, 403: FORBIDDEN, 404: NOT_FOUND },
  })
  errors(@ValidParams() params: ImportParams, @ValidQuery() query: ImportErrorsQuery, @Req() req: ApiRequest) {
    return this.service.errors(params.type, params.importId, query, req.user!)
  }

  @Get(':type/:importId/report')
  @Access({ action: 'recovery-imports:report', roles: [] })
  @ApiRoute({
    description: 'Use this API action to read the differences of a preview (or of a confirmed import) with the previous import of the same type',
    params: importParamsSchema,
    responses: { 200: { description: 'The report', schema: reportSchema }, 400: BAD_REQUEST, 401: UNAUTHORIZED, 403: FORBIDDEN, 404: NOT_FOUND },
  })
  report(@ValidParams() params: ImportParams, @Req() req: ApiRequest) {
    return this.service.report(params.type, params.importId, req.user!)
  }

  @Get(':type/:importId/report/items')
  @Access({ action: 'recovery-imports:report-items', roles: [] })
  @ApiRoute({
    description: 'Use this API action to list the lines of one category of the report',
    params: importParamsSchema,
    query: reportItemsQuerySchema,
    responses: { 200: { description: 'Lines of the page', schema: reportItemsResponseSchema }, 400: BAD_REQUEST, 401: UNAUTHORIZED, 403: FORBIDDEN, 404: NOT_FOUND },
  })
  reportItems(@ValidParams() params: ImportParams, @ValidQuery() query: ReportItemsQuery, @Req() req: ApiRequest) {
    return this.service.reportItems(params.type, params.importId, query, req.user!)
  }

  /**
   * rule-recouvrement-import-green-light. The object type of the audit entry is the one of the file: it is read, when
   * the platform needs it, from the type of the address (`ImportTypeMiddleware`). The summary names no cell value, no
   * debtor and no invoice.
   */
  @Post(':type/:importId/confirm')
  @HttpCode(200)
  @Access({ action: 'recovery-imports:confirm', roles: [] })
  @Audited({
    get objectType() {
      const type = importTypeStorage.getStore()?.type
      return type ? OBJECT_TYPE_OF[type] : 'Import'
    },
    describe: ({ params, response }) => ({
      objectId: params.importId,
      summary: `${OBJECT_TYPE_OF[params.type as keyof typeof OBJECT_TYPE_OF]} confirmé : ${response.createdCount} ligne(s) écrite(s), ${response.skippedCount} ignorée(s).`,
    }),
  })
  @ApiRoute({
    description: 'Use this API action to give the green light to a preview: the file is applied (once per file)',
    params: importParamsSchema,
    responses: {
      200: { description: 'What the confirmation did', schema: confirmResponseSchema },
      400: BAD_REQUEST,
      401: UNAUTHORIZED,
      403: FORBIDDEN,
      404: NOT_FOUND,
      409: { description: 'Conflict - imports.file_refused, imports.stale_extraction, imports.already_imported' },
    },
  })
  confirm(@ValidParams() params: ImportParams, @Req() req: ApiRequest) {
    return this.service.confirm(params.type, params.importId, req.user!)
  }
}
