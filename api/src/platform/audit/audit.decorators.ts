import { SetMetadata } from '@nestjs/common'
import type { AuthenticatedUser } from '../http/request-context'

export const AUDIT_KEY = 'platform:audit:traced'
export const AUDIT_EXEMPT_KEY = 'platform:audit:exempt'

/** What a traced route knows once the action succeeded. */
export interface AuditContext<TResponse = any> {
  /** Validated inputs of the request. Build a summary from their NAMES (`sentFields`), never from raw values. */
  body: any
  params: any
  query: any
  /** Names of the keys of the validated body (for a PATCH: the fields the caller sent). */
  sentFields: string[]
  /** What the handler returned (checked against the contract before anything is written). */
  response: TResponse
  actor: AuthenticatedUser
}

/** Description of the entry, computed from the request and the result of the action. */
export interface AuditDescriptor {
  /** 1 to 100 characters, not necessarily a uuid. */
  objectId: string
  /** French readable text, no secret; normalised (whitespace, control characters) and cut at 500 characters. */
  summary: string
  /** Code of the scope the action targets (1 to 50 characters), or none. */
  scope?: string | null
}

export interface AuditDeclaration<TResponse = any> {
  /** French label of the kind of object, chosen once and never renamed (1 to 100 characters). */
  objectType: string
  describe: (context: AuditContext<TResponse>) => AuditDescriptor
}

/**
 * `rule-foundation-audit-declarative-route`: declares a write route as traced. The action code is the one of the
 * `@Access()` declaration of the route; the platform writes the entry, in the transaction of the action, and only
 * when the action succeeded. The route must be authenticated (otherwise `500 audit.misconfigured`).
 */
export const Audited = <TResponse = any>(declaration: AuditDeclaration<TResponse>): MethodDecorator =>
  SetMetadata(AUDIT_KEY, declaration)

/**
 * Explicit, motivated exception: a write route (POST, PUT, PATCH, DELETE) that creates or changes no business or
 * administration data (login, logout, import preview...). The reason is mandatory.
 */
export const AuditExempt = (reason: string): MethodDecorator => SetMetadata(AUDIT_EXEMPT_KEY, reason)
