import { useCallback } from 'react'
import type { components } from '@monappli/api-client'
import { api } from '../../../shared/api'
import { useCall } from '../../../shared/useCall'
import type { PageLoader } from '../../../shared/usePagedList'

export type User = components['schemas']['UserDto']

/** `GET /users?from=&size=` as a page loader. */
export function useUserLoader(): PageLoader<User> {
  const call = useCall()
  return useCallback(
    async (from, size) => {
      const outcome = await call(() => api.GET('/users', { params: { query: { from, size } } }))
      return outcome.ok ? { ok: true, data: { items: outcome.data.users, total: outcome.data.total } } : outcome
    },
    [call],
  )
}
