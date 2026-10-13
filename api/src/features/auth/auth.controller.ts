import { Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common'
import type { Response } from 'express'
import { Public } from '../../platform/access/access.decorators'
import { AuditExempt } from '../../platform/audit/audit.decorators'
import { ApiError, ErrorCode } from '../../platform/http/errors'
import type { ApiRequest } from '../../platform/http/request-context'
import { ApiRoute, ApiTag } from '../../platform/openapi/route-contract'
import { SessionService } from '../../platform/security/session.service'
import { ValidBody } from '../../platform/validation/zod-validation.interceptor'
import {
  CurrentUserResponse,
  LoginParams,
  LoginResponse,
  currentUserResponseSchema,
  loginParamsSchema,
  loginResponseSchema,
} from './auth.schemas'
import { AuthService } from './auth.service'

/** The three routes are public (EXI-PLAT-10) and never traced (`rule-foundation-audit-scope-of-trace`). */
@Controller('auth')
@ApiTag('Auth')
export class AuthController {
  constructor(
    private readonly service: AuthService,
    private readonly sessions: SessionService,
  ) {}

  /** `rule-foundation-session-persists`, `rule-foundation-login-single-error`, Q-AUTH-01, Q-AUTH-05. */
  @Post('login')
  @HttpCode(200)
  @Public()
  @AuditExempt('Login creates or changes no business or administration data (rule-foundation-audit-scope-of-trace)')
  @ApiRoute({
    description: 'Login with email and password',
    body: loginParamsSchema,
    responses: { 200: { description: 'Login successful', schema: loginResponseSchema } },
  })
  async loginWithPassword(
    @ValidBody() body: LoginParams,
    @Req() req: ApiRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponse> {
    // credentials first: a wrong password answers 401 whatever the headers (rule-foundation-login-single-error)
    const token = await this.service.login(body.email, body.password)
    if (body.returnToken) return { token }
    const host = this.sessions.originHost(req)
    // Q-AUTH-01: without a token in the body the session lives in a cookie, which needs the Origin
    if (!host) {
      throw new ApiError(400, ErrorCode.invalidOrigin, 'An Origin header is required unless returnToken is true')
    }
    this.sessions.setSessionCookie(res, host, token)
    return {}
  }

  /** `rule-auth-session-persistence`, `rule-foundation-session-expired`: `{}` without session. */
  @Get('current-user')
  @Public()
  @ApiRoute({
    description: 'Get the current user. If there is no logged user (header or cookie), it returns an empty object',
    readsSession: true,
    responses: { 200: { description: 'Only if cookie is not set to true', schema: currentUserResponseSchema } },
  })
  async currentUser(@Req() req: ApiRequest): Promise<CurrentUserResponse> {
    const user = await this.sessions.authenticate(req)
    return user ? { user: { id: user.id, email: user.email, role: user.role } } : {}
  }

  /** `rule-foundation-logout`: 201, idempotent, expires the cookie named after the Origin (nothing without Origin). */
  @Post('logout')
  @Public()
  @AuditExempt('Logout creates or changes no business or administration data (rule-foundation-audit-scope-of-trace)')
  @ApiRoute({ description: 'Delete the JWT from the cookies', responses: { 201: { description: '' } } })
  logout(@Req() req: ApiRequest, @Res({ passthrough: true }) res: Response): void {
    const host = this.sessions.originHost(req)
    if (host) this.sessions.clearSessionCookie(res, host)
  }
}
