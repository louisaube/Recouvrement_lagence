import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { Observable } from 'rxjs'
import { ACCESS_KEY, AccessDeclaration } from '../access/access.decorators'
import type { ApiRequest } from '../http/request-context'
import { ScopeContext, scopeStorage } from './scope-access'

/**
 * Establishes the scope context of the request (caller, admin access declared on the route) for the whole handling,
 * so that `ScopedRepository` filters without the feature passing anything (`rule-foundation-scope-row-filter`).
 * The memberships themselves are read lazily, once per request, on the first scoped access.
 */
@Injectable()
export class ScopeContextInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<ApiRequest>()
    const declaration = this.reflector.get<AccessDeclaration | undefined>(ACCESS_KEY, context.getHandler())
    const scopeContext: ScopeContext = { caller: req.user, adminScopes: declaration?.adminScopes ?? 'full' }
    return new Observable((subscriber) => scopeStorage.run(scopeContext, () => next.handle().subscribe(subscriber)))
  }
}
