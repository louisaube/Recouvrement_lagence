import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common'
import { accessDenied } from '../../platform/http/errors'
import type { ApiRequest } from '../../platform/http/request-context'

/**
 * rule-foundation-users-get-self-or-admin: an ordinary user reads only their own account. Any other identifier is
 * `403 security.access_denied`, whether the account exists or not and even if the identifier is malformed: the check
 * runs before the validation of the parameters and before any lookup, so it reveals nothing.
 * (Runs after the global access guard, which has already established `req.user`.)
 */
@Injectable()
export class SelfOrAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<ApiRequest>()
    const caller = req.user
    if (!caller) throw accessDenied()
    if (caller.role === 'admin') return true
    const requested = (req.params as Record<string, unknown> | undefined)?.id
    if (typeof requested === 'string' && requested.toLowerCase() === caller.id.toLowerCase()) return true
    throw accessDenied()
  }
}
