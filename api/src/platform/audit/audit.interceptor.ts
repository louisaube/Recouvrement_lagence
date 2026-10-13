import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { eq } from 'drizzle-orm'
import { Observable, from, lastValueFrom } from 'rxjs'
import { auditLogs } from '../../features/audit/audit.tables'
import { users } from '../../features/users/users.tables'
import { ACCESS_KEY, AccessDeclaration } from '../access/access.decorators'
import { Database, InjectDb } from '../database/database.module'
import { ambientTransaction } from '../database/transaction-context'
import { ApiError, invalidToken } from '../http/errors'
import type { ApiRequest } from '../http/request-context'
import { CONTRACT_KEY, RouteContract } from '../openapi/route-contract'
import { normaliseSummary } from './audit-text'
import { AUDIT_KEY, AuditDeclaration, AuditDescriptor } from './audit.decorators'

const misconfigured = (message: string) => new ApiError(500, 'audit.misconfigured', message)
const invalidDescriptor = (message: string) => new ApiError(500, 'audit.invalid_descriptor', message)

const lengthBetween = (value: unknown, min: number, max: number): value is string =>
  typeof value === 'string' && Array.from(value).length >= min && Array.from(value).length <= max

/**
 * `rule-foundation-audit-trace-content`, `rule-foundation-audit-atomic-with-action`: runs a traced route in one
 * transaction (the queries of the handler follow it, see `transactionAware`), then writes the entry in it. The entry
 * exists only if the action succeeded (2xx) and the description and the response are valid; any error rolls back the
 * action and the entry together. The author's e-mail is read just before the action.
 * Innermost interceptor: the access guard and the validation have already run.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    @InjectDb() private readonly db: Database,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const handler = context.getHandler()
    const declaration = this.reflector.get<AuditDeclaration | undefined>(AUDIT_KEY, handler)
    if (!declaration) return next.handle()
    const req = context.switchToHttp().getRequest<ApiRequest>()
    const access = this.reflector.get<AccessDeclaration | undefined>(ACCESS_KEY, handler)
    const contract = this.reflector.get<RouteContract | undefined>(CONTRACT_KEY, handler)
    return from(this.traced(req, access, declaration, contract, next))
  }

  private async traced(
    req: ApiRequest,
    access: AccessDeclaration | undefined,
    declaration: AuditDeclaration,
    contract: RouteContract | undefined,
    next: CallHandler,
  ): Promise<unknown> {
    const actor = req.user
    if (!access || !actor) throw misconfigured('A traced route must declare an authenticated access regime')
    if (!lengthBetween(declaration.objectType, 1, 100)) throw misconfigured('Invalid object type of the traced route')

    return this.db.transaction(async (tx) => {
      const [author] = await tx.select({ email: users.email }).from(users).where(eq(users.id, actor.id))
      if (!author) throw invalidToken()

      return ambientTransaction.run({ tx: tx as unknown as Database }, async () => {
        const response = await lastValueFrom(next.handle(), { defaultValue: undefined })
        this.checkResponse(contract, response)

        const parsed = req.parsed
        const body = parsed?.body
        let descriptor: AuditDescriptor
        try {
          descriptor = declaration.describe({
            body,
            params: parsed?.params,
            query: parsed?.query,
            sentFields: body && typeof body === 'object' ? Object.keys(body) : [],
            response,
            actor,
          })
        } catch {
          throw invalidDescriptor('The description of the traced route could not be built')
        }
        const summary = normaliseSummary(String(descriptor?.summary ?? ''))
        const scope = descriptor?.scope ?? null
        if (
          !lengthBetween(descriptor?.objectId, 1, 100) ||
          !lengthBetween(summary, 1, 500) ||
          (scope !== null && !lengthBetween(scope, 1, 50))
        ) {
          throw invalidDescriptor('The description of the traced route is out of bounds')
        }

        await tx.insert(auditLogs).values({
          actorId: actor.id,
          actorEmail: author.email,
          action: access.action,
          objectType: declaration.objectType,
          objectId: descriptor.objectId,
          scopeCode: scope,
          summary,
        })
        return response
      })
    })
  }

  /** A response that does not match the contract is a server error: neither entry nor data is kept. */
  private checkResponse(contract: RouteContract | undefined, response: unknown): void {
    const success = Object.entries(contract?.responses ?? {})
      .filter(([status, item]) => Number(status) >= 200 && Number(status) < 300 && item.schema)
      .map(([, item]) => item.schema!)[0]
    if (success && !success.safeParse(response).success) {
      throw new Error('Response does not match the contract of the route')
    }
  }
}
