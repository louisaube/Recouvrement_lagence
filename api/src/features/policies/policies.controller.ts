import { Controller, Get, HttpCode, Post, Req, UseGuards } from '@nestjs/common'
import { Access } from '../../platform/access/access.decorators'
import { Audited, AuditExempt } from '../../platform/audit/audit.decorators'
import type { ApiRequest } from '../../platform/http/request-context'
import { ApiRoute, ApiTag } from '../../platform/openapi/route-contract'
import { ValidParams, ValidQuery } from '../../platform/validation/zod-validation.interceptor'
import { MULTIPART_FILE_BODY } from '../imports/imports.schemas'
import { RequireProfile } from '../profiles/profile.guard'
import { BAD_REQUEST, FORBIDDEN, NOT_FOUND, UNAUTHORIZED } from '../recovery-common/schemas'
import {
  PolicyPreviewParams,
  policyPreviewParamsSchema,
  policyPreviewSchema,
  PolicyVersionParams,
  policyVersionDetailResponseSchema,
  policyVersionParamsSchema,
  policyVersionResponseSchema,
  PolicyVersionsQuery,
  policyVersionsListResponseSchema,
  policyVersionsQuerySchema,
} from './policies.schemas'
import { frenchDate, PoliciesService } from './policies.service'

/**
 * rule-recouvrement-policy-supervisor-only: the policy is readable by the profile `supervisor` only (the guard runs
 * before anything of the request is read).
 */
@ApiTag('Policies')
@Controller('policy-versions')
@UseGuards(RequireProfile('supervisor'))
export class PoliciesController {
  constructor(private readonly service: PoliciesService) {}

  @Get()
  @Access({ action: 'policies:list', roles: [] })
  @ApiRoute({
    description: 'Use this API action to list the versions of the recovery policy, newest first (supervisor profile)',
    query: policyVersionsQuerySchema,
    responses: { 200: { description: 'Versions of the page', schema: policyVersionsListResponseSchema }, 400: BAD_REQUEST, 401: UNAUTHORIZED, 403: FORBIDDEN },
  })
  list(@ValidQuery() query: PolicyVersionsQuery) {
    return this.service.list(query)
  }

  /** rule-recouvrement-policy-json-not-spreadsheet: the preview writes only its own temporary state. */
  @Post('previews')
  @HttpCode(200)
  @Access({ action: 'policies:preview', roles: [] })
  @AuditExempt('The preview writes only the temporary state of the analysis; the confirmation is the traced action')
  @ApiRoute({
    description: 'Use this API action to analyse a policy file (JSON) with its six activation checks and witness cases, without creating a version',
    rawBody: { contentType: 'multipart/form-data', schema: MULTIPART_FILE_BODY },
    responses: {
      200: { description: 'The analysis of the file and the identifier of the preview', schema: policyPreviewSchema },
      400: { description: 'Bad request - policies.invalid_file_type or the body is not a multipart upload' },
      401: UNAUTHORIZED,
      403: FORBIDDEN,
      409: { description: 'Conflict - policies.already_imported' },
      413: { description: 'Payload too large - policies.file_too_large' },
    },
  })
  preview(@Req() req: ApiRequest) {
    return this.service.preview(req, req.user!)
  }

  @Post('previews/:previewId/confirm')
  @Access({ action: 'policies:confirm', roles: [] })
  @Audited({
    objectType: 'Version de politique',
    describe: ({ response }) => ({
      objectId: response.version.id,
      summary: `Version de politique « ${response.version.label} » du ${frenchDate(response.version.versionDate)} importée.`,
    }),
  })
  @ApiRoute({
    description: 'Use this API action to create the version of a policy preview (once per file)',
    params: policyPreviewParamsSchema,
    responses: {
      201: { description: 'The version, imported', schema: policyVersionResponseSchema },
      400: BAD_REQUEST,
      401: UNAUTHORIZED,
      403: FORBIDDEN,
      404: { description: 'Not found - policies.preview_not_found' },
      409: { description: 'Conflict - policies.invalid_file, policies.already_imported' },
    },
  })
  async confirm(@ValidParams() params: PolicyPreviewParams, @Req() req: ApiRequest) {
    return { version: await this.service.confirm(params.previewId, req.user!) }
  }

  @Get(':id')
  @Access({ action: 'policies:get', roles: [] })
  @ApiRoute({
    description: 'Use this API action to read a policy version with its rules, its six checks and its witnesses (supervisor profile)',
    params: policyVersionParamsSchema,
    responses: {
      200: { description: 'The version', schema: policyVersionDetailResponseSchema },
      400: BAD_REQUEST,
      401: UNAUTHORIZED,
      403: FORBIDDEN,
      404: NOT_FOUND,
    },
  })
  async get(@ValidParams() params: PolicyVersionParams) {
    return { version: await this.service.get(params.id) }
  }

  @Post(':id/activate')
  @HttpCode(200)
  @Access({ action: 'policies:activate', roles: [] })
  @Audited({
    objectType: 'Version de politique',
    describe: ({ response }) => ({
      objectId: response.version.id,
      summary: `Version de politique « ${response.version.label} » du ${frenchDate(response.version.versionDate)} activée.`,
    }),
  })
  @ApiRoute({
    description: 'Use this API action to activate a policy version once its six checks pass; the previous active version is superseded',
    params: policyVersionParamsSchema,
    responses: {
      200: { description: 'The version, active', schema: policyVersionResponseSchema },
      400: BAD_REQUEST,
      401: UNAUTHORIZED,
      403: FORBIDDEN,
      404: NOT_FOUND,
      409: { description: 'Conflict - policies.activation_blocked (details: one entry per failed check), policies.not_activatable' },
    },
  })
  async activate(@ValidParams() params: PolicyVersionParams, @Req() req: ApiRequest) {
    return { version: await this.service.activate(params.id, req.user!) }
  }
}
