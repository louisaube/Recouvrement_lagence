import { Controller, Get, HttpCode, Post, Req } from '@nestjs/common'
import { Access } from '../../platform/access/access.decorators'
import { count } from '../../platform/audit/audit-text'
import { Audited, AuditExempt } from '../../platform/audit/audit.decorators'
import type { ApiRequest } from '../../platform/http/request-context'
import { ApiRoute, ApiTag } from '../../platform/openapi/route-contract'
import { ValidParams, ValidQuery } from '../../platform/validation/zod-validation.interceptor'
import {
  ImportErrorsQuery,
  importConfirmSchema,
  importErrorsListSchema,
  importErrorsQuerySchema,
  ImportParams,
  importParamsSchema,
  importPreviewSchema,
  importSpecificationSchema,
  MULTIPART_FILE_BODY,
} from '../imports/imports.schemas'
import { ImportsService } from '../imports/imports.service'
import { UsersImportDefinition } from './users-import.definition'

const FORBIDDEN = { description: 'Forbidden - insufficient role permissions' }
const UNAUTHORIZED = { description: 'Unauthorized' }

/**
 * Import of accounts (`60-import.md`): the four routes of the mechanism, all reserved to administrators
 * (`rule-foundation-import-users-admin-only`). The access guard answers 401/403 before any byte of the body is read.
 * A feature with an import copies this controller: its action codes, its roles, its object type and its definition.
 */
@Controller('users/imports')
@ApiTag('Users')
export class UsersImportController {
  constructor(
    private readonly imports: ImportsService,
    private readonly definition: UsersImportDefinition,
  ) {}

  @Get('specification')
  @Access({ action: 'users:import-specification', roles: ['admin'] })
  @ApiRoute({
    description: 'Use this API action to get the columns, formats and limits of the accounts import (administrators only)',
    responses: {
      200: { description: 'Columns expected in the file and limits of the import', schema: importSpecificationSchema },
      401: UNAUTHORIZED,
      403: FORBIDDEN,
    },
  })
  specification() {
    return this.imports.specification(this.definition)
  }

  /** `rule-foundation-import-preview-not-traced`: the preview writes only temporary state; the confirmation is traced. */
  @Post('preview')
  @HttpCode(200)
  @Access({ action: 'users:import-preview', roles: ['admin'] })
  @AuditExempt('The preview writes only the temporary state of the analysis; the confirmation is the traced action')
  @ApiRoute({
    description: 'Use this API action to analyse an accounts file (.xlsx or .csv) without creating anything',
    rawBody: { contentType: 'multipart/form-data', schema: MULTIPART_FILE_BODY },
    responses: {
      200: { description: 'Counts of the analysis and identifier of the preview', schema: importPreviewSchema },
      401: UNAUTHORIZED,
      403: FORBIDDEN,
    },
  })
  preview(@Req() req: ApiRequest) {
    return this.imports.preview(this.definition, req)
  }

  @Get(':importId/errors')
  @Access({ action: 'users:import-errors', roles: ['admin'] })
  @ApiRoute({
    description: 'Use this API action to list, page by page, the faults found in the preview of an accounts file',
    params: importParamsSchema,
    query: importErrorsQuerySchema,
    responses: {
      200: { description: 'One page of (row, column, reason) entries and their total', schema: importErrorsListSchema },
      401: UNAUTHORIZED,
      403: FORBIDDEN,
    },
  })
  errors(@ValidParams() params: ImportParams, @ValidQuery() query: ImportErrorsQuery, @Req() req: ApiRequest) {
    return this.imports.errors(this.definition, params.importId, query, req.user!)
  }

  /** `rule-foundation-import-audited`: one entry per import, never an e-mail, a cell or a hash. */
  @Post(':importId/confirm')
  @HttpCode(200)
  @Access({ action: 'users:import-confirm', roles: ['admin'] })
  @Audited({
    objectType: 'Import de comptes',
    describe: ({ response }) => ({
      objectId: response.importId,
      scope: null,
      summary: `Import de ${count(response.createdCount, 'compte')} depuis « ${response.fileName} »`,
    }),
  })
  @ApiRoute({
    description: 'Use this API action to create the accounts of the valid rows of a preview (administrators only, once per file)',
    params: importParamsSchema,
    responses: {
      200: { description: 'Counts of the confirmation', schema: importConfirmSchema },
      401: UNAUTHORIZED,
      403: FORBIDDEN,
    },
  })
  confirm(@ValidParams() params: ImportParams, @Req() req: ApiRequest) {
    return this.imports.confirm(this.definition, params.importId, req.user!)
  }
}
