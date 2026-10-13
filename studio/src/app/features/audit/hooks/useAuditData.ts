import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { components } from '@recouvrement/api-client'
import { api } from '../../../shared/api'
import { useCall } from '../../../shared/useCall'
import type { usePagedList } from '../../../shared/usePagedList'
import { dayEnd, dayStart, periodInverted, type AuditFilters } from './auditFilters'

export type AuditEntry = components['schemas']['AuditEntryDto']
export type AuditFilterValues = components['schemas']['AuditLogFiltersDto']

/** `GET /audit-logs/filters`, loaded once on opening. */
export function useAuditFilterValues() {
  const call = useCall()
  const [version, setVersion] = useState(0)
  const [state, setState] = useState<{ status: 'loading' } | { status: 'error' } | { status: 'ready'; values: AuditFilterValues }>({ status: 'loading' })
  useEffect(() => {
    let current = true
    setState({ status: 'loading' })
    void call(() => api.GET('/audit-logs/filters')).then((outcome) => {
      if (current) setState(outcome.ok ? { status: 'ready', values: outcome.data } : { status: 'error' })
    })
    return () => {
      current = false
    }
  }, [call, version])
  return { state, retry: useCallback(() => setVersion((v) => v + 1), []) }
}

type ListState = ReturnType<typeof usePagedList<AuditEntry>>

/**
 * `GET /audit-logs` for the current filters; same shape as `usePagedList` so that it can feed `AdminList`.
 * A change of filters goes back to the first page; an inverted period makes no call.
 */
export function useAuditList(filters: AuditFilters): ListState {
  const call = useCall()
  const inverted = periodInverted(filters)
  const key = JSON.stringify(filters)
  const [pageState, setPageState] = useState({ key, page: 0 })
  const [size, setSize] = useState(10)
  const [version, setVersion] = useState(0)
  const [state, setState] = useState<ListState['state']>({ status: 'loading' })
  const filtersRef = useRef(filters)
  filtersRef.current = filters
  const page = pageState.key === key ? pageState.page : 0

  // A change of filters goes back to the first page for good: coming back to filters seen earlier must not restore
  // the page that was open then (rule-foundation-audit-shareable-filter).
  useEffect(() => {
    setPageState((previous) => (previous.key === key ? previous : { key, page: 0 }))
  }, [key])

  useEffect(() => {
    if (inverted) return
    let current = true
    setState({ status: 'loading' })
    const f = filtersRef.current
    const query = {
      from: page * size,
      size,
      ...(f.auteur && { actorId: f.auteur }),
      ...(f.action && { action: f.action }),
      ...(f.type && { objectType: f.type }),
      ...(f.perimetre && { scope: f.perimetre }),
      ...(f.du && { occurredFrom: dayStart(f.du) }),
      ...(f.au && { occurredTo: dayEnd(f.au) }),
    }
    void call(() => api.GET('/audit-logs', { params: { query } })).then((outcome) => {
      if (!current) return
      setState(outcome.ok ? { status: 'ready', items: outcome.data.entries, total: outcome.data.total } : { status: 'error', failure: outcome.failure })
    })
    return () => {
      current = false
    }
  }, [call, key, page, size, version, inverted])

  return useMemo(
    () => ({
      state,
      page,
      size,
      setPage: (p) => setPageState({ key, page: typeof p === 'function' ? p(page) : p }),
      setSize: (value: number) => {
        setSize(value)
        setPageState({ key, page: 0 })
      },
      reload: () => setVersion((v) => v + 1),
      reloadFirst: () => {
        setPageState({ key, page: 0 })
        setVersion((v) => v + 1)
      },
    }),
    [state, page, size, key],
  )
}
