import { Injectable } from '@nestjs/common'

const PARIS = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' })

/** `AAAA-MM-JJ` of a date-time in the Europe/Paris time zone. */
export const parisDate = (at: Date): string => PARIS.format(at)

/**
 * rule-recouvrement-today-paris: the only access of the business rules to the clock. The civil date is the one of
 * Europe/Paris, never the one of the server.
 */
@Injectable()
export class ClockService {
  now(): Date {
    return new Date()
  }

  today(): string {
    return parisDate(this.now())
  }
}

/** Adds `days` to an `AAAA-MM-JJ` date (calendar arithmetic in UTC: no daylight saving to care about). */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

/** Whole days from `from` to `to` (`to - from`). */
export function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number)
  const [ty, tm, td] = to.split('-').map(Number)
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000)
}
