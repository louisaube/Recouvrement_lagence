/** rule-foundation-audit-shareable-filter / rule-foundation-audit-url-sanitized: filters carried by the address. */
export interface AuditFilters {
  auteur: string
  action: string
  type: string
  perimetre: string
  du: string
  au: string
}

export const FILTER_KEYS = ['auteur', 'action', 'type', 'perimetre', 'du', 'au'] as const
export type FilterKey = (typeof FILTER_KEYS)[number]

const MAX_LENGTH: Partial<Record<FilterKey, number>> = { action: 100, type: 100, perimetre: 50 }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function validDay(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!m) return false
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  if (y < 1001 || y > 9998) return false
  const date = new Date(Date.UTC(y, mo - 1, d))
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d
}

export function validFilterValue(key: FilterKey, value: string): boolean {
  if (value === '' || value.includes('\0')) return false
  if (key === 'auteur') return UUID.test(value)
  if (key === 'du' || key === 'au') return validDay(value)
  return value.length <= (MAX_LENGTH[key] ?? 100)
}

/** Only valid, non-empty values survive. */
export function readFilters(params: URLSearchParams): AuditFilters {
  const out: AuditFilters = { auteur: '', action: '', type: '', perimetre: '', du: '', au: '' }
  for (const key of FILTER_KEYS) {
    const value = params.get(key) ?? ''
    if (validFilterValue(key, value)) out[key] = value
  }
  return out
}

function boundary(day: string, h: number, mi: number, s: number, ms: number): string {
  const [y, m, d] = day.split('-').map(Number)
  const date = new Date(2000, m - 1, d, h, mi, s, ms)
  date.setFullYear(y)
  return date.toISOString()
}

/** Calendar days in the browser's time zone, bounds included (rule-foundation-audit-period-inclusive-days). */
export const dayStart = (day: string) => boundary(day, 0, 0, 0, 0)
export const dayEnd = (day: string) => boundary(day, 23, 59, 59, 999)

export function periodInverted(filters: AuditFilters): boolean {
  return filters.du !== '' && filters.au !== '' && filters.du > filters.au
}

export function hasActiveFilter(filters: AuditFilters): boolean {
  return FILTER_KEYS.some((k) => filters[k] !== '')
}

const VERBS: Record<string, string> = { create: 'Création', update: 'Modification', delete: 'Suppression', 'import-confirm': 'Import' }

/** French verb of an action code `<feature>:<verb>`; the raw suffix when unknown. */
export function actionVerb(action: string): string {
  const suffix = action.includes(':') ? action.slice(action.indexOf(':') + 1) : action
  return VERBS[suffix] ?? suffix
}

export function actionOptionLabel(action: string): string {
  return `${actionVerb(action)} — ${action}`
}

const two = (n: number) => String(n).padStart(2, '0')

/** `JJ/MM/AAAA HH:mm:ss` in the browser's time zone. */
export function formatDateTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return `${two(d.getDate())}/${two(d.getMonth() + 1)}/${d.getFullYear()} ${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`
}
