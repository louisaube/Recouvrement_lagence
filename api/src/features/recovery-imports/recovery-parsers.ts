import { echo } from '../imports/imports.text'
import type { CellResult } from '../imports/imports.types'
import { MAX_AMOUNT_CENTS } from './recovery-imports.constants'

export const fail = (reason: string): CellResult<never> => ({ ok: false, reason })
export const ok = <T>(value: T): CellResult<T> => ({ ok: true, value })
export const quoted = (value: string): string => `« ${echo(value)} »`

/** Control characters other than the ones a cell can legitimately hold. */
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/

/**
 * rule-recouvrement-money-cents: a decimal amount (point or comma, spaces as thousands separators, two decimals at most)
 * converted to an integer of cents without any rounding. Returns `null` when the text is not an amount.
 */
export function amountToCents(text: string): { cents: number } | { tooManyDecimals: true } | null {
  const compact = text.replace(/[\s  ]/g, '')
  const match = /^(-?)(\d+)(?:[.,](\d*))?$/.exec(compact)
  if (!match) return null
  const decimals = match[3] ?? ''
  if (decimals.length > 2) return { tooManyDecimals: true }
  const whole = match[2]
  if (whole.length > 13) return { cents: Number.MAX_SAFE_INTEGER }
  const cents = Number(whole) * 100 + Number(decimals.padEnd(2, '0'))
  return { cents: match[1] === '-' ? -cents : cents }
}

/** A required or optional amount column: the sign rules are checked by the caller. */
export function amountCell(label: string, required: boolean) {
  return (cell: string | null): CellResult<number | null> => {
    if (cell === null) return required ? fail(`${label} est obligatoire.`) : ok(null)
    const parsed = amountToCents(cell)
    if (parsed === null) return fail(`${label} : ${quoted(cell)} n'est pas un montant (exemple : 1 234,50).`)
    if ('tooManyDecimals' in parsed) return fail(`${label} : ${quoted(cell)} a plus de deux décimales.`)
    if (Math.abs(parsed.cents) > MAX_AMOUNT_CENTS) return fail(`${label} : ${quoted(cell)} dépasse 100 000 000,00.`)
    return ok(parsed.cents)
  }
}

/** `AAAA-MM-JJ`, `JJ/MM/AAAA`, or the date-time a spreadsheet gives for a date cell (its date part). */
export function parseDateText(text: string): string | null {
  let y: string
  let m: string
  let d: string
  let match = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(text)
  if (match) [, y, m, d] = match
  else if ((match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text))) [, d, m, y] = match
  else return null
  const probe = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)))
  if (probe.getUTCFullYear() !== Number(y) || probe.getUTCMonth() !== Number(m) - 1 || probe.getUTCDate() !== Number(d)) return null
  return `${y}-${m}-${d}`
}

export function dateCell(label: string, required: boolean) {
  return (cell: string | null): CellResult<string | null> => {
    if (cell === null) return required ? fail(`${label} est obligatoire.`) : ok(null)
    const date = parseDateText(cell)
    return date === null ? fail(`${label} : ${quoted(cell)} n'est pas une date (AAAA-MM-JJ ou JJ/MM/AAAA).`) : ok(date)
  }
}

export function sirenCell(label: string, required: boolean) {
  return (cell: string | null): CellResult<string | null> => {
    if (cell === null) return required ? fail(`${label} est obligatoire.`) : ok(null)
    return /^\d{9}$/.test(cell) ? ok(cell) : fail(`${label} : ${quoted(cell)} n'est pas un SIREN de 9 chiffres.`)
  }
}

/** A text of 1 to `max` characters without control character. */
export function textCell(label: string, required: boolean, max: number) {
  return (cell: string | null): CellResult<string | null> => {
    if (cell === null) return required ? fail(`${label} est obligatoire.`) : ok(null)
    if (Array.from(cell).length > max) return fail(`${label} dépasse ${max} caractères.`)
    if (CONTROL.test(cell)) return fail(`${label} contient un caractère de contrôle.`)
    return ok(cell)
  }
}

/** `rule-recouvrement-receivables-control-total`: `^-?[0-9 ]{1,15}([.,][0-9]{1,2})?$`, spaces ignored. */
export const CONTROL_TOTAL_PATTERN = '^-?[0-9 ]{1,15}([.,][0-9]{1,2})?$'
export function parseControlTotal(text: string): number | null {
  if (!new RegExp(CONTROL_TOTAL_PATTERN).test(text)) return null
  const parsed = amountToCents(text)
  return parsed !== null && 'cents' in parsed ? parsed.cents : null
}

/** `1 234,50` style rendering of cents (summaries and reasons). */
export function formatCents(cents: number): string {
  const abs = Math.abs(cents)
  const whole = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
  return `${cents < 0 ? '-' : ''}${whole},${String(abs % 100).padStart(2, '0')}`
}
