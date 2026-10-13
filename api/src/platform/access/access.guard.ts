import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { accessDenied, missingToken } from '../http/errors'
import type { ApiRequest } from '../http/request-context'
import { SessionService } from '../security/session.service'
import { ACCESS_KEY, AccessDeclaration, admittedRoles, PUBLIC_KEY } from './access.decorators'

/**
 * Global guard: refusal by default (EXI-PLAT-11). Runs before any validation, body reading or lookup.
 *   - `@Public()`: let through;
 *   - `@Access(...)`: 401 without a valid token (`security.missing_token` / `security.invalid_token`),
 *     403 `security.access_denied` when the role is not admitted; with `roles: []` (route reserved to a business
 *     guard, rule-foundation-access-guard-only-route) the platform never refuses by role once authenticated and
 *     `req.user` is set: the `@UseGuards` of the route decide, after this guard and before any validation;
 *   - no declaration (cannot happen: the server refuses to start): 401 for a visitor, 403 otherwise.
 */
@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler()]
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, targets) === true) return true

    const req = context.switchToHttp().getRequest<ApiRequest>()
    const user = await this.sessions.authenticate(req)
    if (!user) throw missingToken()
    req.user = user

    const declaration = this.reflector.getAllAndOverride<AccessDeclaration | undefined>(ACCESS_KEY, targets)
    if (!declaration) throw accessDenied()
    // rule-foundation-access-guard-only-regime: no role of the foundation is admitted, the business guard decides
    if (declaration.roles.length === 0) return true
    if (!admittedRoles(declaration.roles).includes(user.role)) throw accessDenied()
    return true
  }
}
