/**
 * Helpers shared by the acceptance tests of version socle-journal-audit.
 * Black box: entries are seeded with raw SQL (the journal has no write route) and read through HTTP.
 * Table `base.audit_logs` columns come from the module plan (assumption listed in COVERAGE-socle-journal-audit.md).
 */
import { sql } from './harness'

export interface SeedEntry {
  occurredAt?: string
  actorId?: string
  actorEmail?: string
  action?: string
  objectType?: string
  objectId?: string
  scope?: string | null
  summary?: string
}

export const ACTOR_A = '11111111-1111-4111-8111-111111111111'
export const ACTOR_B = '22222222-2222-4222-8222-222222222222'

let counter = 0

/** Inserts one journal entry and returns its id. Defaults give a valid entry. */
export async function seedEntry(e: SeedEntry = {}): Promise<string> {
  counter += 1
  const rows = await sql(
    `insert into base.audit_logs (occurred_at, actor_id, actor_email, action, object_type, object_id, scope_code, summary)
     values ($1::timestamptz, $2, $3, $4, $5, $6, $7, $8) returning id`,
    [
      e.occurredAt ?? '2026-01-01T10:00:00.000Z',
      e.actorId ?? ACTOR_A,
      e.actorEmail ?? 'auteur-a@example.com',
      e.action ?? 'groups:update',
      e.objectType ?? 'Groupe',
      e.objectId ?? `obj-${counter}`,
      e.scope === undefined ? null : e.scope,
      e.summary ?? `Résumé ${counter}`,
    ],
  )
  return rows[0].id
}

export const countEntries = async (): Promise<number> => (await sql('select 1 from base.audit_logs')).length

export const allEntries = async () =>
  sql('select id, occurred_at, actor_id, actor_email, action, object_type, object_id, scope_code, summary from base.audit_logs order by occurred_at, id')

/** Query-string builder for GET /audit-logs (values are URL-encoded). */
export function qs(params: Record<string, string | number>): string {
  const parts = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
  return parts.length ? `?${parts.join('&')}` : ''
}
