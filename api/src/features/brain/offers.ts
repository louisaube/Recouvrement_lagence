import { addDays } from '../cases/clock.service'
import type { PolicyRungFile } from '../policies/policies.schemas'

export interface Instalment {
  dueDate: string
  amountCents: number
}

export interface OfferFigures {
  kind: 'lump_sum' | 'schedule'
  totalCents: number
  discountCents: number
  /** Part of the total that is a fee or interest for the delay (already in `totalCents`). */
  delayFeeCents: number
  firstPaymentDate: string
  instalments: Instalment[]
}

const BASIS = 10_000n

/** `bp x amount / 10 000`, rounded to the upper half, in integers (never a floating point). */
export const basisPointsOf = (bp: number, amountCents: number): number => Number((BigInt(bp) * BigInt(amountCents) + BASIS / 2n) / BASIS)

/**
 * rule-recouvrement-offer-computation (inferred): the offer is priced from the rung of the policy, in integers of cents.
 * sum = valueBp x negotiable / 10 000, plus delayFeeBp x negotiable / 10 000 when the offer has a delay or a schedule;
 * discount = max(0, negotiable - sum); first payment = day + payByDays; a schedule is made of equal parts, the cents
 * left over on the last one, one every `intervalDays`.
 */
export function priceOffer(rung: PolicyRungFile, negotiableCents: number, today: string): OfferFigures {
  const hasDelay = rung.payByDays > 0 || rung.installments !== undefined
  const delayFeeCents = hasDelay ? basisPointsOf(rung.delayFeeBp, negotiableCents) : 0
  const totalCents = basisPointsOf(rung.valueBp, negotiableCents) + delayFeeCents
  const firstPaymentDate = addDays(today, rung.payByDays)
  const instalments: Instalment[] = []
  if (rung.installments) {
    const { count, intervalDays } = rung.installments
    const part = Math.floor(totalCents / count)
    for (let k = 0; k < count; k++) {
      instalments.push({
        dueDate: addDays(firstPaymentDate, k * intervalDays),
        amountCents: k === count - 1 ? totalCents - part * (count - 1) : part,
      })
    }
  } else {
    instalments.push({ dueDate: firstPaymentDate, amountCents: totalCents })
  }
  return {
    kind: rung.offerKind,
    totalCents,
    discountCents: Math.max(0, negotiableCents - totalCents),
    delayFeeCents,
    firstPaymentDate,
    instalments,
  }
}

/** `1234567` -> `12345,67` (an amount of cents as a decimal number, exact). */
export const decimalOf = (cents: number): string => {
  const abs = Math.abs(cents)
  return `${cents < 0 ? '-' : ''}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, '0')}`
}
