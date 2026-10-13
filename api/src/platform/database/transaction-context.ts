import { AsyncLocalStorage } from 'node:async_hooks'
import type { Database } from './database.module'

/**
 * Transaction opened around a traced route (`rule-foundation-audit-atomic-with-action`). While it is active, the
 * injected `Database` sends every query to it, so the services need no change: their own `db.transaction(...)` becomes
 * a savepoint of the ambient one and the audit entry is committed with the action or not at all.
 */
export const ambientTransaction = new AsyncLocalStorage<{ tx: Database }>()

/** Wraps `db` so that it follows the ambient transaction when there is one. */
export function transactionAware(db: Database): Database {
  return new Proxy(db, {
    get(target, property) {
      const current = (ambientTransaction.getStore()?.tx ?? target) as unknown as Record<string | symbol, unknown>
      const value = current[property]
      return typeof value === 'function' ? (value as Function).bind(current) : value
    },
  })
}
