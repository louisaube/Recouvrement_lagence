import { z } from 'zod'
import { uuidFormat } from '../../platform/validation/common'

/** Everything the API of the recovery module bounds fits in 2^53 (amounts are integers of cents). */
export const MAX_SAFE = Number.MAX_SAFE_INTEGER

/**
 * Integer of the contract: `type: integer` and the bounds, nothing else (`z.number().int()` would add the bounds of a
 * safe integer to the OpenAPI document).
 */
export const integer = (min: number, description: string, max: number = MAX_SAFE) =>
  z.number().min(min).max(max).meta({ type: 'integer', description })

/** An amount of cents (signed: a credit note is negative). */
export const centsInteger = (description: string) => integer(-MAX_SAFE, description)

/** `AAAA-MM-JJ`. */
export const dateString = (description: string) => z.string().meta({ format: 'date', description })

/** ISO date-time. */
export const instantString = (description: string) => z.string().meta({ format: 'date-time', description })

export const uuidField = (description: string) => uuidFormat().meta({ description })

/** `{ id, email }` of an account (author of an import, of an activation...). */
export const accountRefSchema = z
  .object({ id: uuidField('Account ID'), email: z.string().meta({ description: 'E-mail of the account' }) })
  .meta({ id: 'AccountRefDto' })
export type AccountRefDto = z.infer<typeof accountRefSchema>

/** Response of a paginated list (`rule-foundation-list-pagination`). */
export const listOf = <T extends z.ZodType>(item: T, id: string, itemsDescription: string) =>
  z
    .object({
      items: z.array(item).max(100).meta({ description: itemsDescription }),
      total: integer(0, 'Number of elements of the whole list', 2147483647),
    })
    .meta({ id })

export const FORBIDDEN = { description: 'Forbidden - insufficient role permissions' }
export const UNAUTHORIZED = { description: 'Unauthorized' }
export const NOT_FOUND = { description: 'Not found' }
export const BAD_REQUEST = { description: 'Bad request - validation failed' }
