/** Longest reason kept (`rule-foundation-import-reason-texts`). */
export const REASON_MAX = 500

/**
 * The faulty value as it may appear in a reason: control characters removed, cut at 100 characters with « … ».
 * Never anything else of the file, of the database or of the server.
 */
export function echo(value: string): string {
  const clean = value.replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
  const characters = Array.from(clean)
  return characters.length > 100 ? `${characters.slice(0, 100).join('')}…` : clean
}

/** A reason of 1 to 500 characters, whatever the rule returned. */
export function fitReason(reason: string): string {
  const flat = reason.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').trim() || 'Valeur invalide.'
  const characters = Array.from(flat)
  return characters.length <= REASON_MAX ? flat : `${characters.slice(0, REASON_MAX - 1).join('')}…`
}

/** `rule-foundation-import-reason-texts`: a cell above 1,000 characters. */
export const CELL_TOO_LONG = 'Valeur trop longue (1 000 caractères au maximum).'
