import { Controller, Get } from '@nestjs/common'
import { Access } from '../../platform/access/access.decorators'
import { ApiRoute, ApiTag } from '../../platform/openapi/route-contract'
import { ValidQuery } from '../../platform/validation/zod-validation.interceptor'
import {
  AuditLogsListQuery,
  auditLogFiltersSchema,
  auditLogsListQuerySchema,
  auditLogsListResponseSchema,
} from './audit.schemas'
import { AuditService } from './audit.service'

const FORBIDDEN = { description: 'Forbidden - insufficient role permissions' }
const UNAUTHORIZED = { description: 'Unauthorized' }

/**
 * Read-only (rule-foundation-audit-immutable): the journal has no write route, so POST, PUT, PATCH and DELETE under
 * `/audit-logs` answer `404 api.route_not_found` to everybody. Administrators only (rule-foundation-audit-admin-only);
 * reads are never traced (rule-foundation-audit-reads-not-traced).
 */
@Controller('audit-logs')
@ApiTag('Audit')
export class AuditController {
  constructor(private readonly service: AuditService) {}

  @Get()
  @Access({ action: 'audit:list', roles: ['admin'] })
  @ApiRoute({
    description: 'Use this API action to list the audit journal, newest first, with combinable filters (administrators only)',
    query: auditLogsListQuerySchema,
    responses: {
      200: { description: 'Page of journal entries and number of entries matching the filters', schema: auditLogsListResponseSchema },
      401: UNAUTHORIZED,
      403: FORBIDDEN,
    },
  })
  list(@ValidQuery() query: AuditLogsListQuery) {
    return this.service.list(query)
  }

  /** The route is declared before any `:id`-like path would be: query parameters are ignored (no query schema). */
  @Get('filters')
  @Access({ action: 'audit:filters', roles: ['admin'] })
  @ApiRoute({
    description:
      'Use this API action to get the values offered by the filters of the journal screen, taken from the journal itself (administrators only)',
    responses: {
      200: { description: 'Authors, actions, object types and scopes found in the journal', schema: auditLogFiltersSchema },
      401: UNAUTHORIZED,
      403: FORBIDDEN,
    },
  })
  filters() {
    return this.service.filters()
  }
}
