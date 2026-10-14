import { sql, SQL } from 'drizzle-orm'

/** `array['a','b']::text[]` (a JS array given to the `sql` tag would be spread as a list of parameters). */
export const textArray = (values: string[]): SQL =>
  values.length === 0 ? sql`'{}'::text[]` : sql`array[${sql.join(values.map((v) => sql`${v}`), sql`, `)}]::text[]`

/** An instant read from a raw query (string or Date, depending on the driver) as an ISO 8601 string. */
export const isoInstant = (v: unknown): string => new Date(v as string | Date).toISOString()

/** `array['…']::uuid[]`. */
export const uuidArray = (values: string[]): SQL =>
  values.length === 0 ? sql`'{}'::uuid[]` : sql`array[${sql.join(values.map((v) => sql`${v}`), sql`, `)}]::uuid[]`
