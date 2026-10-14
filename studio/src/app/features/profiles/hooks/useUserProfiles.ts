import { useCallback } from 'react'
import type { components } from '@recouvrement/api-client'
import { api } from '../../../shared/api'
import { useCall } from '../../../shared/useCall'
import type { PageLoader } from '../../../shared/usePagedList'

export type UserProfile = components['schemas']['UserProfileDto']

/** `GET /user-profiles?from=&size=` as a page loader (read in full, pages of 100). */
export function useUserProfileLoader(): PageLoader<UserProfile> {
  const call = useCall()
  return useCallback(
    async (from, size) => {
      const outcome = await call(() => api.GET('/user-profiles', { params: { query: { from, size } } }))
      return outcome.ok ? { ok: true, data: { items: outcome.data.items, total: outcome.data.total } } : outcome
    },
    [call],
  )
}
