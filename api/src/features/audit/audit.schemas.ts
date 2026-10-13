import { z } from 'zod'
import { uuidFormat } from '../../platform/validation/common'

/** Integer query parameter: the contract of record publishes `type: integer` with its bounds. */
const queryInteger = (min: number, max: number, description: string) =>
  z
    .string()
    .refine((s) => /^\d{1,10}$/.test(s) && Number(s) >= min && Number(s) <= max, `Must be an integer from ${min} to ${max}`)
    .transform(Number)
    .meta({ type: 'integer', minimum: min, maximum: max, description })
    .optional()

const DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(Z|[+-](\d{2}):(\d{2}))$/

/**
 * Milliseconds since the epoch of an ISO 8601 date-time WITH a zone (`Z` or `+hh:mm`), or `null` when it is not one:
 * no zone, date only, impossible day (`2026-02-30`), year outside 1000-9999, hour 24, offset beyond ±23:59.
 */
export function parseZonedDateTime(text: string): number | null {
  const m = DATE_TIME.exec(text)
  if (!m) return null
  const [year, month, day, hour, minute] = [m[1], m[2], m[3], m[4], m[5]].map(Number)
  const second = m[6] === undefined ? 0 : Number(m[6])
  const offsetMinutes = m[7] === 'Z' ? 0 : (m[7][0] === '-' ? -1 : 1) * (Number(m[8]) * 60 + Number(m[9]))
  if (year < 1000 || month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return null
  if (m[7] !== 'Z' && (Number(m[8]) > 23 || Number(m[9]) > 59)) return null
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second))
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null
  const fraction = /\.(\d{1,9})/.exec(text)
  const millis = fraction ? Number(fraction[1].padEnd(3, '0').slice(0, 3)) : 0
  return date.getTime() + millis - offsetMinutes * 60_000
}

const dateTimeParam = (description: string) =>
  z
    .string()
    .min(16)
    .max(35)
    .refine((s) => parseZonedDateTime(s) !== null, 'Must be an ISO 8601 date-time with a zone (Z or offset)')
    .meta({ format: 'date-time', example: '2026-01-31T23:59:59.999Z', description })
    .optional()

/** rule-foundation-audit-filters: pagination and the six filters; a repeated or empty parameter is refused (400). */
export const auditLogsListQuerySchema = z
  .object({
    from: queryInteger(0, 2147483647, 'Index of the first entry to return (default 0)'),
    size: queryInteger(1, 100, 'Number of entries to return (default 10)'),
    actorId: uuidFormat().meta({ description: 'Only the entries of this author (a deleted account included)' }).optional(),
    action: z.string().min(1).max(100).meta({ description: 'Exact action code, e.g. `groups:update`' }).optional(),
    objectType: z.string().min(1).max(100).meta({ description: 'Exact object type, e.g. `Groupe`' }).optional(),
    scope: z.string().min(1).max(50).meta({ description: 'Exact scope code' }).optional(),
    occurredFrom: dateTimeParam('Lower bound, inclusive: ISO 8601 date-time with a zone (Z or offset)'),
    occurredTo: dateTimeParam(
      'Upper bound, inclusive: ISO 8601 date-time with a zone (Z or offset), not before occurredFrom',
    ),
  })
  .refine(
    (q) =>
      q.occurredFrom === undefined ||
      q.occurredTo === undefined ||
      (parseZonedDateTime(q.occurredFrom) ?? 0) <= (parseZonedDateTime(q.occurredTo) ?? 0),
    { message: 'occurredFrom must not be after occurredTo', path: ['occurredTo'] },
  )
export type AuditLogsListQuery = z.infer<typeof auditLogsListQuerySchema>

/** AuditActorDto: an author as recorded in the journal (the e-mail is a copy, kept if the account disappears). */
export const auditActorSchema = z
  .object({
    id: uuidFormat().meta({ description: 'User ID of the author' }),
    email: z.string().min(1).max(254).meta({ description: 'E-mail of the author at the time of the action', example: 'admin@example.com' }),
  })
  .meta({ id: 'AuditActorDto' })

/** AuditEntryDto (50-journal-audit.md §1) */
export const auditEntrySchema = z
  .object({
    id: uuidFormat().meta({ description: 'Entry ID' }),
    occurredAt: z
      .string()
      .meta({ format: 'date-time', description: 'Time of the action (ISO 8601, UTC, millisecond precision)', example: '2026-01-31T10:15:30.123Z' }),
    actor: auditActorSchema,
    action: z.string().min(1).max(100).meta({ description: 'Action code `<feature>:<verb>`', example: 'groups:update' }),
    objectType: z.string().min(1).max(100).meta({ description: 'French label of the kind of object', example: 'Groupe' }),
    objectId: z.string().min(1).max(100).meta({ description: 'Id of the object (not necessarily a uuid)' }),
    scope: z.string().min(1).max(50).nullable().meta({ description: 'Code of the scope the action targets, null if none' }),
    summary: z.string().min(1).max(500).meta({ description: 'Readable French text, never a secret' }),
  })
  .meta({ id: 'AuditEntryDto' })
export type AuditEntryDto = z.infer<typeof auditEntrySchema>

export const auditLogsListResponseSchema = z
  .object({
    entries: z.array(auditEntrySchema).max(100),
    total: z.number().int().min(0).meta({ description: 'Number of entries matching the filters', example: 42 }),
  })
  .meta({ id: 'AuditLogsListResponseDto' })

/** rule-foundation-audit-filter-options-from-journal: at most 1000 values per list. */
export const auditLogFiltersSchema = z
  .object({
    actors: z
      .array(auditActorSchema)
      .max(1000)
      .meta({ description: 'Authors found in the journal, with the e-mail of their latest entry, sorted by e-mail' }),
    actions: z.array(z.string().min(1).max(100)).max(1000).meta({ description: 'Distinct action codes, sorted' }),
    objectTypes: z.array(z.string().min(1).max(100)).max(1000).meta({ description: 'Distinct object types, sorted' }),
    scopes: z.array(z.string().min(1).max(50)).max(1000).meta({ description: 'Distinct scope codes, sorted' }),
  })
  .meta({ id: 'AuditLogFiltersDto' })
export type AuditLogFiltersDto = z.infer<typeof auditLogFiltersSchema>
