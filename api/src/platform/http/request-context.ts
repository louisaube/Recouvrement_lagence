import type { Request } from 'express'
import type { Role } from '../access/access.decorators'

/** Authenticated caller, attached to the request by the access guard. */
export interface AuthenticatedUser {
  id: string
  email: string
  role: Role
}

/** Validated inputs of the route, attached by the validation interceptor. */
export interface ParsedInputs {
  body: unknown
  query: unknown
  params: unknown
}

export type ApiRequest = Request & {
  id?: string
  user?: AuthenticatedUser
  parsed?: ParsedInputs
}
