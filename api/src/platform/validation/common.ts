import { z } from 'zod'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Plain refinement: accepts a canonical uuid and adds nothing to the OpenAPI document. */
export const uuidRefinement = () => z.string().refine((v) => UUID_RE.test(v), 'Invalid UUID')

/** UUID declared as `format: uuid` only: the contract of record carries no `pattern`. */
export const uuidFormat = () => uuidRefinement().meta({ format: 'uuid' })

/** `:id` path parameter. The contract of record declares a plain string; the format is a refinement (400 when malformed). */
export const idParamsSchema = z.object({ id: uuidRefinement() })
export type IdParams = z.infer<typeof idParamsSchema>

/**
 * A list of distinct uuids (EXI-PLAT-07: `uniqueItems`), `min` to `max` elements.
 * The caller adds `.optional()` and its description.
 */
export const uuidList = (min: number, max: number) => {
  const list = z.array(uuidFormat()).max(max)
  return (min > 0 ? list.min(min) : list).refine((ids) => new Set(ids.map((id) => id.toLowerCase())).size === ids.length, 'Ids must be distinct')
}

/** A name of 1 to 100 characters, not empty once trimmed, stored trimmed (the bounds are those of the raw input). */
export const trimmedName = () =>
  z
    .string()
    .min(1)
    .max(100)
    .refine((v) => v.trim().length > 0, 'Must not be blank')
    .transform((v) => v.trim())

/**
 * Integer query parameter, `min` to `max`. The contract of record declares `from` and `size` as plain numbers
 * (`type: number`, no bounds): the range is a refinement so that the document stays identical to it, and the
 * string form is checked so that `1.5`, `-1`, `1e3`, an empty or a repeated value are refused (EXI-PLAT-07).
 */
const queryInteger = (min: number, max: number, description: string) =>
  z
    .string()
    .refine((s) => /^\d{1,10}$/.test(s) && Number(s) >= min && Number(s) <= max, `Must be an integer from ${min} to ${max}`)
    .transform(Number)
    .meta({ type: 'number', description })
    .optional()

/** `rule-foundation-list-pagination`: `from` 0 to 2147483647 (default 0), `size` 1 to 100 (default 10). */
export const paginationQuerySchema = z.object({
  from: queryInteger(0, 2147483647, 'The index of the first element to return (integer from 0 to 2147483647, default 0)'),
  size: queryInteger(1, 100, 'The number of elements to return (integer from 1 to 100, default 10)'),
})
export type PaginationQuery = z.infer<typeof paginationQuerySchema>

export const pageOf = (query: PaginationQuery): { from: number; size: number } => ({
  from: query.from ?? 0,
  size: query.size ?? 10,
})
