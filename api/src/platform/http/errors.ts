/** Stable error codes `<domain>.<reason>` (10-plateforme.md §2). A code is added, never renamed. */
export const ErrorCode = {
  validationFailed: 'api.validation.incoming_failed',
  payloadTooLarge: 'api.payload_too_large',
  routeNotFound: 'api.route_not_found',
  unknown: 'api.unknown_error',
  missingToken: 'security.missing_token',
  invalidToken: 'security.invalid_token',
  invalidCredentials: 'security.invalid_credentials',
  invalidOrigin: 'security.invalid_origin',
  accessDenied: 'security.access_denied',
  notFound: 'repository.not_found',
  scopeAccessDenied: 'scopes.access_denied',
  scopeReadOnly: 'scopes.read_only',
} as const

export interface ValidationDetail {
  path: string
  message: string
}

/** The only exception the application throws on purpose: body `{ status, code, message }` (+ `details`). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: ValidationDetail[],
  ) {
    super(message)
    this.name = 'ApiError'
  }

  toBody(): { status: number; code: string; message: string; details?: ValidationDetail[] } {
    return {
      status: this.status,
      code: this.code,
      message: this.message,
      ...(this.details ? { details: this.details } : {}),
    }
  }
}

export const validationFailed = (details: ValidationDetail[], message = 'Request validation failed'): ApiError =>
  new ApiError(400, ErrorCode.validationFailed, message, details)

/** `rule-foundation-login-single-error`: one fixed body whatever the cause (EXI-PLAT-02). */
export const invalidCredentials = (): ApiError =>
  new ApiError(401, ErrorCode.invalidCredentials, 'Invalid credentials')

export const missingToken = (): ApiError => new ApiError(401, ErrorCode.missingToken, 'Authentication required')
export const invalidToken = (): ApiError => new ApiError(401, ErrorCode.invalidToken, 'Invalid or expired token')
export const accessDenied = (): ApiError => new ApiError(403, ErrorCode.accessDenied, 'Access denied')

/** An unknown object, or a row outside the scopes of the caller (indistinguishable, rule-foundation-scope-row-filter). */
export const notFound = (): ApiError => new ApiError(404, ErrorCode.notFound, 'Resource not found')

/** Write aimed at a scope the caller does not reach (or no scope at all). */
export const scopeAccessDenied = (): ApiError =>
  new ApiError(403, ErrorCode.scopeAccessDenied, 'Scope not reachable by the caller')

/** Write by an administrator on a route where the declared admin access to the scopes is read-only. */
export const scopeReadOnly = (): ApiError => new ApiError(403, ErrorCode.scopeReadOnly, 'Scopes are read-only on this route')

/** PostgreSQL unique violation (23505), whether Drizzle wrapped it or not. */
export function isUniqueViolation(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code
  const causeCode = ((error as { cause?: unknown } | null)?.cause as { code?: unknown } | undefined)?.code
  return code === '23505' || causeCode === '23505'
}
