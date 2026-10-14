import { BASIS_POINTS, DECISION_TYPES, HISTORY_MIN, MAX_PROBLEM_LENGTH, MAX_PROBLEMS, SIGMA_FACTOR } from './batches.constants'
import type { BatchCheckDto, DecisionShareDto } from './batches.schemas'

type DecisionType = (typeof DECISION_TYPES)[number]

const TYPE_LABEL: Record<DecisionType, string> = {
  none: 'dossiers sans action',
  reminder: 'relances',
  proposal: 'propositions',
  transfer_proposed: 'transferts proposés',
}

const percent = (bp: number): string => `${String(Math.round(bp) / 100).replace('.', ',')} %`
const round2 = (n: number): number => Math.round(n * 100) / 100
const clip = (text: string): string => (text.length > MAX_PROBLEM_LENGTH ? `${text.slice(0, MAX_PROBLEM_LENGTH - 1)}…` : text)

/** A check result: at most 50 problems of at most 300 characters. */
export function checkResult(code: BatchCheckDto['code'], failed: boolean, problems: string[]): BatchCheckDto {
  return { code, status: failed ? 'failed' : 'passed', problems: problems.slice(0, MAX_PROBLEMS).map(clip) }
}

export interface ShareInputs {
  /** Number of decisions of each type in the batch. */
  counts: Record<DecisionType, number>
  /** Number of cases decided (non final). */
  decided: number
  /** `decisionTypeCapsBp` of the active policy. */
  caps: Record<DecisionType, number>
  /** Shares (basis points) of the previous batches, by type: the 20 last ones that are not replaced. */
  history: Record<DecisionType, number>[]
}

/**
 * rule-recouvrement-batch-auto-stop (user), rule-recouvrement-decision-share-sigma (inferred, D-0005): the share of each type
 * of decision is compared to the mean of the previous batches once there are ten of them (a gap strictly above three
 * standard deviations of the population blocks the batch; with a null deviation any other share blocks, which the
 * comparison of squares gives by itself); before that, to the fixed cap of the type of the policy (strictly above blocks).
 * A batch with no case has shares of zero: nothing is divided by zero.
 */
export function computeShares(input: ShareInputs): { shares: DecisionShareDto[]; check: BatchCheckDto } {
  const problems: string[] = []
  const statistical = input.history.length >= HISTORY_MIN
  const shares = DECISION_TYPES.map((type): DecisionShareDto => {
    const count = input.counts[type]
    const shareBp = input.decided === 0 ? 0 : Math.round((count * BASIS_POINTS) / input.decided)
    if (!statistical) {
      const capBp = input.caps[type]
      const exceeded = shareBp > capBp
      if (exceeded) {
        problems.push(`La part des ${TYPE_LABEL[type]} (${percent(shareBp)}) dépasse le plafond de ${percent(capBp)} fixé par la politique.`)
      }
      return { type, count, shareBp, mode: 'fixed_cap', capBp, meanBp: null, sigmaBp: null, thresholdBp: null, exceeded }
    }
    const values = input.history.map((h) => h[type])
    const mean = values.reduce((a, b) => a + b, 0) / values.length
    const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length
    const sigma = Math.sqrt(variance)
    const exceeded = (shareBp - mean) ** 2 > SIGMA_FACTOR ** 2 * variance
    if (exceeded) {
      problems.push(
        `La part des ${TYPE_LABEL[type]} (${percent(shareBp)}) s'écarte de la moyenne des ${values.length} derniers lots (${percent(mean)}) de plus de trois écarts-types (${percent(SIGMA_FACTOR * sigma)}).`,
      )
    }
    return {
      type,
      count,
      shareBp,
      mode: 'statistical',
      capBp: null,
      meanBp: round2(mean),
      sigmaBp: round2(sigma),
      thresholdBp: round2(SIGMA_FACTOR * sigma),
      exceeded,
    }
  })
  return { shares, check: checkResult('decision_share', problems.length > 0, problems) }
}
