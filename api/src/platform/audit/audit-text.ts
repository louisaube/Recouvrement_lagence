/** `rule-foundation-audit-summary-no-secret`: the summary is one line of at most 500 characters. */
export const SUMMARY_MAX = 500

/**
 * Consecutive whitespace and control characters become one space, the ends are trimmed, and a text longer than
 * 500 characters is cut with an ellipsis (the result is exactly 500 characters long).
 */
export function normaliseSummary(text: string): string {
  const flat = text.replace(/[\s\p{Cc}]+/gu, ' ').trim()
  const characters = Array.from(flat)
  return characters.length <= SUMMARY_MAX ? flat : `${characters.slice(0, SUMMARY_MAX - 1).join('')}…`
}

/**
 * The names (never the values) of the fields a caller sent, in French and in the order of `labels`, for the summary of
 * a modification: `fieldNames(['groupIds'], { role: 'rôle', groupIds: 'groupes' })` is `groupes`.
 */
export function fieldNames(sent: string[], labels: Record<string, string>): string {
  const names = Object.entries(labels)
    .filter(([key]) => sent.includes(key))
    .map(([, label]) => label)
  return names.length > 0 ? names.join(', ') : 'aucun champ'
}

/** French agreement (Q-AUDIT-01): singular for 0 and 1, plural from 2: `0 membre`, `1 membre`, `2 membres`. */
export const count = (n: number, singular: string, plural = `${singular}s`): string =>
  `${n} ${n < 2 ? singular : plural}`
