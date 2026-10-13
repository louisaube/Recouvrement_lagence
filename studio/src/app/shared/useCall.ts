import { useCallback } from 'react'
import { useSession } from '../features/auth/hooks/useSession'

export interface Failure {
  /** HTTP status, 0 for a network error. */
  status: number
  code?: string
}

export type Outcome<T> = { ok: true; data: T } | { ok: false; failure: Failure }

interface RawResult<T> {
  data?: T
  error?: unknown
  response: Response
}

export const MESSAGE_FORBIDDEN = 'Action non autorisée.'
export const MESSAGE_INVALID = 'Données invalides. Vérifiez les champs.'
export const MESSAGE_GENERIC = 'Une erreur est survenue. Veuillez réessayer.'

/** rule-foundation-api-failure-handling: never a technical message from the API. */
export function failureMessage(failure: Failure, withInvalid = true): string {
  if (failure.status === 403) return MESSAGE_FORBIDDEN
  if (failure.status === 400 && withInvalid) return MESSAGE_INVALID
  return MESSAGE_GENERIC
}

/**
 * Wraps a typed API call: network errors and non-2xx answers become a `Failure`;
 * a 401 ends the session (rule-foundation-api-failure-handling).
 */
export function useCall() {
  const { expire } = useSession()
  return useCallback(
    async <T,>(fn: () => Promise<RawResult<T>>): Promise<Outcome<T>> => {
      try {
        const result = await fn()
        if (result.response.ok && result.data !== undefined) return { ok: true, data: result.data }
        const code = (result.error as { code?: unknown } | undefined)?.code
        const failure: Failure = { status: result.response.status, code: typeof code === 'string' ? code : undefined }
        // Short grace so the screen does not flash away mid-render; the session still ends right after.
        if (failure.status === 401) setTimeout(expire, 300)
        return { ok: false, failure }
      } catch {
        return { ok: false, failure: { status: 0 } }
      }
    },
    [expire],
  )
}
