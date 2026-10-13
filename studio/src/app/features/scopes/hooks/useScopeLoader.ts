import { useCallback } from 'react'
import type { components } from '@recouvrement/api-client'
import { api } from '../../../shared/api'
import { useCall } from '../../../shared/useCall'
import type { PageLoader } from '../../../shared/usePagedList'

export type Scope = components['schemas']['ScopeDto']

/** `GET /scopes?from=&size=` as a page loader. */
export function useScopeLoader(): PageLoader<Scope> {
  const call = useCall()
  return useCallback(
    async (from, size) => {
      const outcome = await call(() => api.GET('/scopes', { params: { query: { from, size } } }))
      return outcome.ok ? { ok: true, data: { items: outcome.data.scopes, total: outcome.data.total } } : outcome
    },
    [call],
  )
}
