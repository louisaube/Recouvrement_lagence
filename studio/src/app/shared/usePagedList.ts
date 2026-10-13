import { useCallback, useEffect, useRef, useState } from 'react'
import type { Failure, Outcome } from './useCall'

export interface PageResult<T> {
  items: T[]
  total: number
}

export type PageLoader<T> = (from: number, size: number) => Promise<Outcome<PageResult<T>>>

/** The API caps `size` at 100. */
const ALL_PAGE_SIZE = 100

/** rule-foundation-list-pagination: server-side pages of 10, 25 or 50 (10 by default). */
export function usePagedList<T>(load: PageLoader<T>) {
  const [page, setPage] = useState(0)
  const [size, setSize] = useState(10)
  const [version, setVersion] = useState(0)
  const [state, setState] = useState<{ status: 'loading' } | { status: 'error'; failure: Failure } | { status: 'ready'; items: T[]; total: number }>({
    status: 'loading',
  })
  const loadRef = useRef(load)
  loadRef.current = load

  useEffect(() => {
    let current = true
    setState({ status: 'loading' })
    void loadRef.current(page * size, size).then((outcome) => {
      if (!current) return
      setState(outcome.ok ? { status: 'ready', ...outcome.data } : { status: 'error', failure: outcome.failure })
    })
    return () => {
      current = false
    }
  }, [page, size, version])

  return {
    state,
    page,
    size,
    setPage,
    setSize: (value: number) => {
      setSize(value)
      setPage(0)
    },
    reload: useCallback(() => setVersion((v) => v + 1), []),
    reloadFirst: useCallback(() => {
      setPage(0)
      setVersion((v) => v + 1)
    }, []),
  }
}

/** Choice lists of the forms are loaded in full (rule-foundation-list-pagination). */
export function useAllItems<T>(load: PageLoader<T>) {
  const [state, setState] = useState<{ status: 'loading' } | { status: 'error' } | { status: 'ready'; items: T[] }>({ status: 'loading' })
  const [version, setVersion] = useState(0)
  const loadRef = useRef(load)
  loadRef.current = load

  useEffect(() => {
    let current = true
    setState({ status: 'loading' })
    void (async () => {
      const items: T[] = []
      for (;;) {
        const outcome = await loadRef.current(items.length, ALL_PAGE_SIZE)
        if (!current) return
        if (!outcome.ok) return setState({ status: 'error' })
        items.push(...outcome.data.items)
        if (outcome.data.items.length === 0 || items.length >= outcome.data.total) break
      }
      setState({ status: 'ready', items })
    })()
    return () => {
      current = false
    }
  }, [version])

  return { state, retry: useCallback(() => setVersion((v) => v + 1), []) }
}
