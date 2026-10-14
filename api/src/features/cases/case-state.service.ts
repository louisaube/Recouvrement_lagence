import { Injectable } from '@nestjs/common'
import { sql } from 'drizzle-orm'
import { ImportExecutor } from '../imports/imports.types'
import { allowedCauses, CaseFacts, CaseState, deriveState, InternalStateError, QUEUE_STOPPING_TYPES } from './case-states'

export interface StateContext {
  /** Who moves the case: `import`, `system`, an e-mail... */
  actor: string
  /** Business reference of the change (import number, dispute, ...). */
  reference?: string | null
  /** Cause to prefer when the transition allows it. */
  cause?: string
}

export interface StateChange {
  caseId: string
  from: CaseState | null
  to: CaseState
  cause: string
}

const FREEZE_CAUSE_OF_CODE: Record<string, string> = {
  dispute: 'dispute_opened',
  contestation: 'contestation',
  unassigned_payment: 'unassigned_payment',
}

interface FactsRow {
  case_id: string
  state: CaseState
  has_open_invoice: boolean
  case_freeze_codes: string[] | null
  all_open_invoices_frozen: boolean
  stopped_by_queue: boolean
}

/**
 * rule-recouvrement-case-state-referential: the only writer of `cases.state`. The state is derived from the facts of
 * the tables (never from the previous state), the cause is chosen among the ones the referential allows, and every
 * change is journaled in `case_state_history` (rule-recouvrement-state-transitions-logged).
 */
@Injectable()
export class CaseStateService {
  async recompute(tx: ImportExecutor, caseId: string, ctx: StateContext): Promise<StateChange[]> {
    return this.recomputeMany(tx, [caseId], ctx)
  }

  async recomputeMany(tx: ImportExecutor, caseIds: string[], ctx: StateContext): Promise<StateChange[]> {
    if (caseIds.length === 0) return []
    const ids = sql.join(
      caseIds.map((id) => sql`${id}::uuid`),
      sql`, `,
    )
    const stopping = sql.join(
      QUEUE_STOPPING_TYPES.map((t) => sql`${t}`),
      sql`, `,
    )
    const result = await tx.execute(sql`
      select c.id as case_id, c.state,
        exists (select 1 from base.invoices i where i.case_id = c.id and i.kind = 'invoice' and i.balance_cents > 0) as has_open_invoice,
        (select array_agg(distinct f.code order by f.code) from base.freezes f
          where f.case_id = c.id and f.scope = 'case' and f.released_at is null) as case_freeze_codes,
        (exists (select 1 from base.invoices i where i.case_id = c.id and i.kind = 'invoice' and i.balance_cents > 0)
          and not exists (
            select 1 from base.invoices i
            where i.case_id = c.id and i.kind = 'invoice' and i.balance_cents > 0
              and not exists (select 1 from base.freezes f where f.case_id = c.id and f.released_at is null and (f.scope = 'case' or f.invoice_id = i.id))
          )) as all_open_invoices_frozen,
        exists (select 1 from base.queue_items q where q.case_id = c.id and q.status = 'open' and q.type in (${stopping})) as stopped_by_queue
      from base.cases c
      where c.id in (${ids})
      order by c.id
      for update of c
    `)
    const changes: StateChange[] = []
    for (const row of result.rows as unknown as FactsRow[]) {
      const facts: CaseFacts = {
        current: row.state,
        hasOpenInvoice: row.has_open_invoice,
        caseFreezeCodes: row.case_freeze_codes ?? [],
        allOpenInvoicesFrozen: row.all_open_invoices_frozen,
        stoppedByQueue: row.stopped_by_queue,
        // Written by the lot of the agent tools: nothing creates an offer or a commitment in this lot.
        pendingCommitment: false,
        activeOffer: false,
      }
      const target = deriveState(facts)
      if (target === row.state) continue
      changes.push(...this.path(row.case_id, row.state, target, facts, ctx))
    }
    if (changes.length === 0) return []

    await tx.execute(sql`
      insert into base.case_state_history (case_id, from_state, to_state, cause, actor, reference)
      values ${sql.join(
        changes.map((c) => sql`(${c.caseId}::uuid, ${c.from}, ${c.to}, ${c.cause}, ${ctx.actor}, ${ctx.reference ?? null})`),
        sql`, `,
      )}
    `)
    const finals = new Map<string, CaseState>()
    for (const c of changes) finals.set(c.caseId, c.to)
    for (const [caseId, state] of finals) {
      await tx.execute(sql`
        update base.cases set state = ${state}, state_since = now(), updated_at = now() where id = ${caseId}::uuid
      `)
    }
    return changes
  }

  /**
   * rule-recouvrement-queue-effects: the supervisor transfers the case to the next step (cause `transfer_approved`).
   * The referential allows it from `open`, `negotiating`, `committed` and `supervisor_queue` only: `blocked` is answered for
   * a frozen or settled case, `already` for one that is transferred (nothing to do).
   */
  async transfer(tx: ImportExecutor, caseId: string, kind: string | null, ctx: StateContext): Promise<'done' | 'already' | 'blocked'> {
    const [row] = (await tx.execute(sql`select state from base.cases where id = ${caseId}::uuid for update`)).rows as { state: CaseState }[]
    if (!row) return 'blocked'
    if (row.state === 'transferred') return 'already'
    if (allowedCauses(row.state, 'transferred').length === 0) return 'blocked'
    await tx.execute(sql`
      insert into base.case_state_history (case_id, from_state, to_state, cause, actor, reference)
      values (${caseId}::uuid, ${row.state}, 'transferred', 'transfer_approved', ${ctx.actor}, ${ctx.reference ?? null})
    `)
    await tx.execute(sql`
      update base.cases
      set state = 'transferred', state_since = now(), transferred_at = now(), transfer_kind = ${kind}, updated_at = now()
      where id = ${caseId}::uuid
    `)
    return 'done'
  }

  /** The first state of a case that has just been created (history row `null -> state`). */
  async recordCreation(tx: ImportExecutor, caseIds: string[], ctx: StateContext): Promise<void> {
    if (caseIds.length === 0) return
    await tx.execute(sql`
      insert into base.case_state_history (case_id, from_state, to_state, cause, actor, reference)
      values ${sql.join(
        caseIds.map((id) => sql`(${id}::uuid, null, 'open', 'import', ${ctx.actor}, ${ctx.reference ?? null})`),
        sql`, `,
      )}
    `)
  }

  /**
   * The transitions that lead from `from` to `to`. A settled case that comes back with a freeze or a queue item goes
   * through `open` first (the referential has no direct `settled -> frozen`).
   */
  private path(caseId: string, from: CaseState, to: CaseState, facts: CaseFacts, ctx: StateContext): StateChange[] {
    if (from === 'settled' && to !== 'open' && allowedCauses(from, to).length === 0) {
      return [
        { caseId, from, to: 'open', cause: this.cause(from, 'open', facts, { ...ctx, cause: 'import' }) },
        { caseId, from: 'open', to, cause: this.cause('open', to, facts, ctx) },
      ]
    }
    return [{ caseId, from, to, cause: this.cause(from, to, facts, ctx) }]
  }

  private cause(from: CaseState, to: CaseState, facts: CaseFacts, ctx: StateContext): string {
    const allowed = allowedCauses(from, to)
    if (allowed.length === 0) throw new InternalStateError(from, to)
    if (ctx.cause && allowed.includes(ctx.cause)) return ctx.cause
    if (allowed.length === 1) return allowed[0]
    if (to === 'frozen') {
      const code = facts.caseFreezeCodes[0]
      const wanted = code ? FREEZE_CAUSE_OF_CODE[code] : 'all_invoices_frozen'
      if (allowed.includes(wanted)) return wanted
    }
    if (to === 'settled' && allowed.includes('balance_cleared')) return 'balance_cleared'
    return allowed[0]
  }
}
