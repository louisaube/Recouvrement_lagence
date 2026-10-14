import type { PolicyCheckDto, PolicyFile, PolicyRuleFile, PolicyWitnessResultDto } from './policies.schemas'

export const CHECK_CODES = ['floor', 'decreasing_concessions', 'counterparts', 'schedule_limits', 'segments_covered', 'witnesses'] as const

const MAX_PROBLEMS = 50
const NATURE_LABEL = { family: 'famille', company: 'entreprise' } as const

const percent = (bp: number): string => `${String(bp / 100).replace('.', ',')} %`
const where = (rule: PolicyRuleFile): string => `Règle « ${rule.segment} », ${NATURE_LABEL[rule.nature]}`

/** At most 50 problems of at most 300 characters. */
function result(code: PolicyCheckDto['code'], problems: string[]): PolicyCheckDto {
  const kept = problems.slice(0, MAX_PROBLEMS).map((p) => (p.length > 300 ? `${p.slice(0, 299)}…` : p))
  return { code, passed: problems.length === 0, problems: kept }
}

/** rule-recouvrement-policy-floor: every offer is worth at least the next step (the floor of the segment). */
function floor(rules: PolicyRuleFile[]): PolicyCheckDto {
  const problems: string[] = []
  for (const rule of rules) {
    rule.ladder.forEach((rung, i) => {
      if (rung.valueBp < rule.nextStep.expectedValueBp) {
        problems.push(`${where(rule)} : l'offre ${i + 1} (${percent(rung.valueBp)}) est sous le plancher de ${percent(rule.nextStep.expectedValueBp)}.`)
      }
    })
  }
  return result('floor', problems)
}

/**
 * rule-recouvrement-policy-concessions-decreasing, rule-recouvrement-concessions-equal-gaps: the values decrease strictly
 * and each gap is strictly smaller than the previous one (two equal gaps fail).
 */
function decreasingConcessions(rules: PolicyRuleFile[]): PolicyCheckDto {
  const problems: string[] = []
  for (const rule of rules) {
    const values = rule.ladder.map((r) => r.valueBp)
    for (let i = 1; i < values.length; i++) {
      if (values[i] >= values[i - 1]) {
        problems.push(`${where(rule)} : l'offre ${i + 1} (${percent(values[i])}) ne baisse pas par rapport à l'offre ${i} (${percent(values[i - 1])}).`)
        continue
      }
      if (i >= 2 && values[i - 1] < values[i - 2]) {
        const previousGap = values[i - 2] - values[i - 1]
        const gap = values[i - 1] - values[i]
        if (gap >= previousGap) {
          problems.push(
            `${where(rule)} : l'écart de l'offre ${i + 1} (${percent(gap)}) n'est pas inférieur à l'écart précédent (${percent(previousGap)}).`,
          )
        }
      }
    }
  }
  return result('decreasing_concessions', problems)
}

/** rule-recouvrement-policy-counterparts: every concession (second offer and later) carries a complete counterpart. */
function counterparts(rules: PolicyRuleFile[]): PolicyCheckDto {
  const problems: string[] = []
  for (const rule of rules) {
    rule.ladder.forEach((rung, i) => {
      if (i === 0) return
      const c = rung.counterpart
      if (!c) problems.push(`${where(rule)} : l'offre ${i + 1} n'a pas de contrepartie.`)
      else if (c.type === 'firm_date' && c.deadlineDays === undefined) problems.push(`${where(rule)} : l'offre ${i + 1} (date ferme) n'a pas de délai.`)
      else if (c.type === 'first_payment' && c.firstPaymentBp === undefined) {
        problems.push(`${where(rule)} : l'offre ${i + 1} (premier versement) n'a pas de part de premier versement.`)
      }
    })
  }
  return result('counterparts', problems)
}

/**
 * rule-recouvrement-policy-schedule-limits: a schedule lasts `payByDays + (count - 1) x intervalDays` at most
 * `maxScheduleDays`; a family delay carries no fee.
 */
function scheduleLimits(rules: PolicyRuleFile[]): PolicyCheckDto {
  const problems: string[] = []
  for (const rule of rules) {
    rule.ladder.forEach((rung, i) => {
      if (rung.offerKind === 'schedule' && rung.installments) {
        const duration = rung.payByDays + (rung.installments.count - 1) * rung.installments.intervalDays
        if (duration > rule.maxScheduleDays) {
          problems.push(`${where(rule)} : l'échéancier de l'offre ${i + 1} dure ${duration} jours, au-delà de ${rule.maxScheduleDays} jours.`)
        }
      }
      const delayed = rung.payByDays > 0 || rung.offerKind === 'schedule'
      if (rule.nature === 'family' && delayed && rung.delayFeeBp > 0) {
        problems.push(`${where(rule)} : l'offre ${i + 1} accorde un délai avec des frais (${percent(rung.delayFeeBp)}), interdit pour une famille.`)
      }
    })
  }
  return result('schedule_limits', problems)
}

/** rule-recouvrement-policy-segments-covered: every (segment, nature) of the open cases has a rule. */
function segmentsCovered(rules: PolicyRuleFile[], present: { segment: string; nature: 'family' | 'company' }[]): PolicyCheckDto {
  const known = new Set(rules.map((r) => `${r.segment}/${r.nature}`))
  const problems = present
    .filter((p) => !known.has(`${p.segment}/${p.nature}`))
    .map((p) => `Aucune règle pour le segment « ${p.segment} » (${NATURE_LABEL[p.nature]}) présent dans les créances.`)
  return result('segments_covered', problems)
}

/** rule-recouvrement-policy-witnesses: every witness case gives exactly the expected action and rule. */
function witnessesCheck(witnesses: PolicyWitnessResultDto[]): PolicyCheckDto {
  const problems = witnesses
    .filter((w) => !w.passed)
    .map((w) =>
      w.obtained
        ? `Témoin « ${w.id} » : attendu ${w.expected.action} / ${w.expected.rule}, obtenu ${w.obtained.action} / ${w.obtained.rule}.`
        : `Témoin « ${w.id} » : attendu ${w.expected.action} / ${w.expected.rule}, le moteur n'a rien donné.`,
    )
  return result('witnesses', problems)
}

/** rule-recouvrement-policy-activation-checks: the six checks, always in this order. */
export function runChecks(
  file: Pick<PolicyFile, 'parameters'>,
  present: { segment: string; nature: 'family' | 'company' }[],
  witnesses: PolicyWitnessResultDto[],
): PolicyCheckDto[] {
  const rules = file.parameters.rules
  return [
    floor(rules),
    decreasingConcessions(rules),
    counterparts(rules),
    scheduleLimits(rules),
    segmentsCovered(rules, present),
    witnessesCheck(witnesses),
  ]
}
