import { SetMetadata } from '@nestjs/common'
import type { z } from 'zod'

export const CONTRACT_KEY = 'platform:contract'
export const TAG_KEY = 'platform:contract:tag'

/** rule-foundation-response-content-type-closed-list: extending the list is a change of the platform. */
export const RESPONSE_CONTENT_TYPES = ['application/json', 'text/csv', 'text/csv; charset=utf-8'] as const
export type ResponseContentType = (typeof RESPONSE_CONTENT_TYPES)[number]

export interface ResponseContract {
  description: string
  /**
   * Content type of the response in the OpenAPI document (rule-foundation-response-content-type; default
   * `application/json`). Declarative only: the platform does not write the `Content-Type` header, the route does.
   */
  contentType?: ResponseContentType
  /** Zod schema of the body; omitted for an empty body. */
  schema?: z.ZodType
}

/**
 * Contract of one route. The Zod schemas are the single source of validation AND of the OpenAPI document:
 * every bound that the API applies must be written in the schema (`.min()`, `.max()`, `.length()`, `.regex()`,
 * `.int()`, `.uuid()`, enums, array sizes...), never checked elsewhere.
 */
export interface RouteContract {
  description?: string
  body?: z.ZodType
  /**
   * Request body that is not JSON (multipart upload): published as is in the OpenAPI document, never validated by
   * the interceptor. The route reads its own stream.
   */
  rawBody?: { contentType: string; schema: Record<string, unknown> }
  /** A `z.object` whose keys are the query parameters. */
  query?: z.ZodObject
  /** A `z.object` whose keys are the `:params` of the path. */
  params?: z.ZodObject
  responses: Record<number, ResponseContract>
  /** A public route that still reads the session (documents the bearer and cookie security schemes). */
  readsSession?: boolean
  /** Left out of the OpenAPI document (documentation UI, test routes). */
  hidden?: boolean
}

export const ApiRoute = (contract: RouteContract): MethodDecorator => SetMetadata(CONTRACT_KEY, contract)

/** OpenAPI tag of every route of a controller. */
export const ApiTag = (tag: string): ClassDecorator => SetMetadata(TAG_KEY, tag)
