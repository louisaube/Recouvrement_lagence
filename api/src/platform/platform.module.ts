import { Module } from '@nestjs/common'
import { APP_GUARD, APP_INTERCEPTOR, DiscoveryModule } from '@nestjs/core'
import { AccessBootCheck } from './access/access-boot-check'
import { AccessGuard } from './access/access.guard'
import { AuditInterceptor } from './audit/audit.interceptor'
import { RouteCatalog } from './access/route-catalog.service'
import { DatabaseModule } from './database/database.module'
import { ScopeAccessModule } from './scopes/scope-access.module'
import { ScopeContextInterceptor } from './scopes/scope-context.interceptor'
import { SecurityModule } from './security/security.module'
import { ZodValidationInterceptor } from './validation/zod-validation.interceptor'

/**
 * Cross-cutting pieces: database pool, session security, access declaration (guard + boot check), Zod validation,
 * OpenAPI document. A business feature plugs into it with `@Public()` / `@Access()` / `@ApiRoute()`; see docs/socle.md.
 */
@Module({
  imports: [DiscoveryModule, DatabaseModule, SecurityModule, ScopeAccessModule],
  providers: [
    RouteCatalog,
    AccessBootCheck,
    { provide: APP_GUARD, useClass: AccessGuard },
    { provide: APP_INTERCEPTOR, useClass: ZodValidationInterceptor },
    // after the validation: the scope context wraps the handler itself
    { provide: APP_INTERCEPTOR, useClass: ScopeContextInterceptor },
    // innermost: the transaction of a traced route wraps the handler only
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
  exports: [RouteCatalog],
})
export class PlatformModule {}
