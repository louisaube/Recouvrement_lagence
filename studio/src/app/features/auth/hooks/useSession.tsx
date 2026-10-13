import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { components } from '@recouvrement/api-client'
import { api } from '../../../shared/api'

export type SessionUser = components['schemas']['AuthUserDto']

type SessionState =
  | { status: 'loading' }
  | { status: 'anonymous' }
  | { status: 'authenticated'; user: SessionUser }

interface SessionContextValue {
  state: SessionState
  /** Reads the current user; true when a session exists. */
  refresh: () => Promise<boolean>
  /** Asks the API to end the session (failure ignored), then clears the local state. */
  logout: (afterClear?: () => void) => Promise<void>
  /** A 401 during use means the session ended: clears the local state. */
  expire: () => void
}

const SessionContext = createContext<SessionContextValue | null>(null)

/** rule-foundation-session-expired: `{}`, 401 or a network error mean "not connected". */
async function fetchCurrentUser(): Promise<SessionUser | null> {
  try {
    const { data } = await api.GET('/auth/current-user')
    const user = (data as { user?: SessionUser } | undefined)?.user
    return user && user.email ? user : null
  } catch {
    return null
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ status: 'loading' })

  const refresh = useCallback(async () => {
    const user = await fetchCurrentUser()
    setState(user ? { status: 'authenticated', user } : { status: 'anonymous' })
    return user !== null
  }, [])

  const logout = useCallback(async (afterClear?: () => void) => {
    try {
      await api.POST('/auth/logout')
    } catch {
      // rule-foundation-logout: the logout succeeds locally even if the call fails
    }
    setState({ status: 'anonymous' })
    afterClear?.()
  }, [])

  const expire = useCallback(() => setState({ status: 'anonymous' }), [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const value = useMemo(() => ({ state, refresh, logout, expire }), [state, refresh, logout, expire])
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error('SessionProvider manquant')
  return ctx
}
