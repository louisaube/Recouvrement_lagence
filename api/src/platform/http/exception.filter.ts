import { ArgumentsHost, Catch, ExceptionFilter, HttpException, NotFoundException } from '@nestjs/common'
import type { Response } from 'express'
import { ApiError, ErrorCode } from './errors'
import type { ApiRequest } from './request-context'

/**
 * Q-PLAT-01: every error body is `{ status, code, message }` (+ `details` for validation); never a stack, SQL or
 * file path. Q-PLAT-06: an unknown path is `404 api.route_not_found`, any unexpected error `500 api.unknown_error`.
 */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp()
    const res = http.getResponse<Response>()
    const req = http.getRequest<ApiRequest>()
    const error = this.normalise(exception, req)
    if (res.headersSent) return
    res.status(error.status).json(error.toBody())
  }

  private normalise(exception: unknown, req: ApiRequest): ApiError {
    if (exception instanceof ApiError) return exception
    // errors raised by the body parser: size, malformed JSON, but also unsupported charset or content encoding,
    // aborted or wrongly sized requests (all 4xx, all typed): a client input is never a 500 (EXI-PLAT-03)
    const parserError = exception as { type?: string; status?: number } | null
    if (parserError?.type === 'entity.too.large') {
      return new ApiError(413, ErrorCode.payloadTooLarge, 'Request body too large')
    }
    if (exception instanceof NotFoundException) {
      return new ApiError(404, ErrorCode.routeNotFound, 'Route not found')
    }
    // HttpException also carries a numeric `status`: only non-Nest errors are parser errors
    if (
      !(exception instanceof HttpException) &&
      typeof parserError?.status === 'number' &&
      parserError.status >= 400 &&
      parserError.status < 500
    ) {
      return new ApiError(400, ErrorCode.validationFailed, 'Request body could not be read', [])
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus()
      if (status < 500) return new ApiError(status, ErrorCode.validationFailed, 'Request rejected')
    }
    // unexpected: the cause is logged with the request id, never returned
    console.error(
      JSON.stringify({
        level: 'error',
        requestId: req.id,
        error: describeForLog(exception),
      }),
    )
    return new ApiError(500, ErrorCode.unknown, 'Unexpected error')
  }
}

/**
 * Technical log text of an unexpected error. A failed Drizzle query carries the SQL and its parameters (password
 * hash, e-mail) in its message: only the PostgreSQL error code is kept (EXI-PLAT-05: no secret in the logs).
 */
function describeForLog(exception: unknown): string {
  if (!(exception instanceof Error)) return 'unknown'
  if (exception.message.startsWith('Failed query')) {
    const code = (exception.cause as { code?: unknown } | undefined)?.code
    return `${exception.name}: database query failed${typeof code === 'string' ? ` (${code})` : ''}`
  }
  return `${exception.name}: ${exception.message}`
}
