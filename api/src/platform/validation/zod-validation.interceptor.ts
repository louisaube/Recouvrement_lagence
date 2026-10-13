import { CallHandler, ExecutionContext, Injectable, NestInterceptor, createParamDecorator } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import express from 'express'
import { Observable, from, mergeMap } from 'rxjs'
import type { z } from 'zod'
import type { ValidationDetail } from '../http/errors'
import { validationFailed } from '../http/errors'
import type { ApiRequest } from '../http/request-context'
import { CONTRACT_KEY, RouteContract } from '../openapi/route-contract'

/** Q-PLAT-04: JSON bodies are limited to 1 MiB (`413 api.payload_too_large`). */
export const JSON_BODY_LIMIT = '1mb'

const parseJson = express.json({ limit: JSON_BODY_LIMIT })

const readBody = (req: ApiRequest, res: unknown): Promise<void> =>
  new Promise((resolve, reject) => {
    parseJson(req, res as express.Response, (error?: unknown) => (error ? reject(error) : resolve()))
  })

/** EXI-PLAT-06: a null character is refused anywhere in the inputs (keys and values). */
export function containsNullCharacter(value: unknown): boolean {
  if (typeof value === 'string') return value.includes('\u0000')
  if (Array.isArray(value)) return value.some(containsNullCharacter)
  if (value && typeof value === 'object') {
    return Object.entries(value).some(([key, item]) => key.includes('\u0000') || containsNullCharacter(item))
  }
  return false
}

function issuesOf(location: string, error: z.ZodError): ValidationDetail[] {
  return error.issues.map((issue) => ({
    path: [location, ...issue.path.map(String)].join('.'),
    message: issue.message,
  }))
}

/**
 * Global interceptor (runs after the access guard, EXI-PLAT-11): reads the JSON body, refuses null characters, then
 * validates body, query and path parameters against the route's Zod schemas (`@ApiRoute`). The validated values are
 * attached to the request (`req.parsed`) and read through `@ValidBody()`, `@ValidQuery()`, `@ValidParams()`.
 * Unknown keys are stripped by plain `z.object`; a PATCH schema uses `z.strictObject` to refuse them (EXI-PLAT-08).
 */
@Injectable()
export class ZodValidationInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp()
    const req = http.getRequest<ApiRequest>()
    const res = http.getResponse()
    const contract = this.reflector.get<RouteContract | undefined>(CONTRACT_KEY, context.getHandler())
    return from(this.prepare(req, res, contract)).pipe(mergeMap(() => next.handle()))
  }

  private async prepare(req: ApiRequest, res: unknown, contract: RouteContract | undefined): Promise<void> {
    if (!['GET', 'HEAD', 'DELETE'].includes(req.method)) await readBody(req, res)
    const raw = { body: req.body as unknown, query: req.query as unknown, params: req.params as unknown }
    if (containsNullCharacter(raw)) throw validationFailed([{ path: 'request', message: 'Null characters are not allowed' }])

    const details: ValidationDetail[] = []
    const parsed: Record<'body' | 'query' | 'params', unknown> = { body: undefined, query: {}, params: {} }
    for (const location of ['body', 'query', 'params'] as const) {
      const schema = contract?.[location]
      if (!schema) continue
      const result = schema.safeParse(raw[location])
      if (result.success) parsed[location] = result.data
      else details.push(...issuesOf(location, result.error))
    }
    if (details.length > 0) throw validationFailed(details)
    req.parsed = parsed
  }
}

const parsedInput = (location: 'body' | 'query' | 'params') =>
  createParamDecorator((_data: unknown, context: ExecutionContext) => {
    return context.switchToHttp().getRequest<ApiRequest>().parsed?.[location]
  })

/** Validated body / query / path parameters of the route (typed by the caller from the Zod schema). */
export const ValidBody = parsedInput('body')
export const ValidQuery = parsedInput('query')
export const ValidParams = parsedInput('params')
