import { z } from 'zod'

/**
 * Q-COMPTES-02: a valid address has at most 254 characters, exactly one "@", a non-empty local part without
 * whitespace, and a domain that contains a dot, has no whitespace and neither starts nor ends with a dot.
 * One validator shared by `POST /users`, `POST /auth/login` and the import. Comparison and storage are untouched
 * (case-sensitive, stored as typed).
 */
export function isValidEmail(value: string): boolean {
  if (value.length > 254) return false
  const parts = value.split('@')
  if (parts.length !== 2) return false
  const [local, domain] = parts
  if (local.length === 0 || /\s/.test(local)) return false
  if (domain.length === 0 || /\s/.test(domain)) return false
  return domain.includes('.') && !domain.startsWith('.') && !domain.endsWith('.')
}

/**
 * Zod schema of an e-mail address. The rule is a refinement, so it adds no bound to the OpenAPI document: use it
 * where the contract of record declares a plain string (login); inputs whose contract declares `maxLength: 254`
 * add it themselves.
 */
export const emailSchema = z.string().refine(isValidEmail, { message: 'Invalid e-mail address' })
