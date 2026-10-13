import { useCallback } from 'react'
import type { components } from '@monappli/api-client'
import { api } from '../../../shared/api'
import { useCall } from '../../../shared/useCall'
import type { PageLoader } from '../../../shared/usePagedList'

export type Group = components['schemas']['GroupDto']

/** `GET /groups?from=&size=` as a page loader. */
export function useGroupLoader(): PageLoader<Group> {
  const call = useCall()
  return useCallback(
    async (from, size) => {
      const outcome = await call(() => api.GET('/groups', { params: { query: { from, size } } }))
      return outcome.ok ? { ok: true, data: { items: outcome.data.groups, total: outcome.data.total } } : outcome
    },
    [call],
  )
}
