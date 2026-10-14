import { Inject, Injectable } from '@nestjs/common'
import { sql } from 'drizzle-orm'
import { Database, DB } from '../../platform/database/database.module'
import { ApiError, notFound } from '../../platform/http/errors'
import type { AuthenticatedUser } from '../../platform/http/request-context'
import { loadActivePolicy, ruleOf } from '../brain/active-policy'
import { BrainService } from '../brain/brain.service'
import { CaseStateService } from '../cases/case-state.service'
import { facts } from '../cases/cases.service'
import { ClockService } from '../cases/clock.service'
import { LettrageService } from '../recovery-imports/lettrage.service'
import { ALLOWED_DECISIONS } from './decision-queue.constants'
import type { QueueType } from './decision-queue.tables'
import type { QueueDecisionBody, QueueItemDto } from './decision-queue.schemas'
import { QueueReadService } from './queue-read.service'

type Row = Record<string, unknown>

const TRANSFERS = ['transfer', 'approve_transfer']

/**
 * The decisions of the supervisor on the items of the queue. Everything runs in the transaction of the traced route
 * (the decision, its effects, the transitions of the cases and the entry of the audit are committed together).
 */
@Injectable()
export class QueueDecisionService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly read: QueueReadService,
    private readonly brain: BrainService,
    private readonly states: CaseStateService,
    private readonly lettrage: LettrageService,
    private readonly clock: ClockService,
  ) {}

  async decide(id: string, body: QueueDecisionBody, actor: AuthenticatedUser): Promise<QueueItemDto> {
    // rule-recouvrement-queue-decided-final: the row is locked, a concurrent decision waits for this one and then finds it decided.
    const [item] = (
      await this.db.execute(sql`
        select q.id, q.type, q.status, q.case_id, q.object_key, q.details, c.debtor_id, c.segment, c.nature
        from base.queue_items q left join base.cases c on c.id = q.case_id
        where q.id = ${id}::uuid
        for update of q
      `)
    ).rows as Row[]
    if (!item) throw notFound()
    if (item.status !== 'open') throw new ApiError(409, 'queue.already_decided', 'The item has already been decided')
    const type = item.type as QueueType
    // rule-recouvrement-queue-allowed-decisions
    if (!ALLOWED_DECISIONS[type].includes(body.decision)) {
      throw new ApiError(409, 'queue.decision_not_allowed', 'This decision is not allowed for this type of item')
    }
    const caseId = item.case_id === null ? null : String(item.case_id)
    const ctx = { actor: actor.email, reference: id }

    // rule-recouvrement-queue-effects: what can be refused is checked before anything is written.
    const transferKind = TRANSFERS.includes(body.decision) && caseId ? await this.nextStepOf(item) : null
    const assignment = body.decision === 'assign' ? await this.checkAssignment(String(item.object_key), body.invoiceId!) : null

    // rule-recouvrement-queue-decision-motivated: decision, reason, author and instant are kept with the item.
    await this.db.execute(sql`
      update base.queue_items
      set status = 'decided', decided_at = now(), decision_code = ${body.decision}, decision_reason = ${body.reason}, decided_by = ${actor.id}::uuid
      where id = ${id}::uuid
    `)

    const touched = new Set<string>(caseId ? [caseId] : [])
    switch (body.decision) {
      case 'authorize': {
        // the negotiable amount at the decision is the amount authorized
        const [row] = (
          await this.db.execute(sql`
            with ${facts(this.clock.today())}
            select coalesce(a.negotiable_cents, 0)::bigint as negotiable_cents from base.cases c left join agg a on a.case_id = c.id where c.id = ${caseId}::uuid
          `)
        ).rows as Row[]
        await this.db.execute(sql`update base.cases set authorized_cents = ${Number(row?.negotiable_cents ?? 0)}, updated_at = now() where id = ${caseId}::uuid`)
        break
      }
      case 'transfer':
      case 'approve_transfer':
        if (caseId) {
          // the case may have been frozen or settled since the check above: the whole decision is then refused (rolled back)
          if ((await this.states.transfer(this.db, caseId, transferKind, ctx)) === 'blocked') {
            throw new ApiError(409, 'queue.decision_not_allowed', 'A frozen or settled case cannot be transferred')
          }
          touched.delete(caseId)
        }
        break
      case 'reject_transfer': {
        // the brain does not propose the transfer again while the rule applied to the case is the same
        const rule = (Array.isArray(item.details) ? (item.details as { label?: string; value?: string }[]) : []).find((d) => d.label === 'Règle appliquée')?.value
        await this.db.execute(sql`update base.cases set rejected_transfer_rule = ${rule ?? null}, updated_at = now() where id = ${caseId}::uuid`)
        break
      }
      case 'assign':
        for (const touchedCase of await this.assign(assignment!, actor)) touched.add(touchedCase)
        break
      // `acknowledge`, `keep` and `resume` close the item and nothing else; `reapprove` (accounting outputs, lot of the
      // ledger outputs) closes it too until that lot creates the outputs it puts back to `approved`.
      default:
        break
    }

    // the cases the decision touches are evaluated again (the item is no longer open: the state falls back by itself)
    await this.brain.evaluateMany([...touched], ctx)
    return this.read.get(id)
  }

  /** The kind of the next step of the rule applied to the case (null without active policy or rule). */
  private async nextStepOf(item: Row): Promise<string | null> {
    const policy = await loadActivePolicy(this.db)
    const rule = policy && item.segment ? ruleOf(policy, String(item.segment), String(item.nature)) : undefined
    const state = (await this.db.execute(sql`select state from base.cases where id = ${String(item.case_id)}::uuid`)).rows[0] as Row | undefined
    // the referential has no transition from a frozen or a settled case to `transferred`
    if (state && (state.state === 'frozen' || state.state === 'settled')) {
      throw new ApiError(409, 'queue.decision_not_allowed', 'A frozen or settled case cannot be transferred')
    }
    return rule?.nextStep.kind ?? null
  }

  /** rule-recouvrement-queue-effects: the invoice must be an open invoice of the portfolio (409 queue.invoice_not_open). */
  private async checkAssignment(allocationId: string, invoiceId: string) {
    const [allocation] = (
      await this.db.execute(sql`
        select a.id, a.payment_id, a.amount_cents from base.payment_allocations a
        where a.id = ${allocationId}::uuid and a.invoice_id is null and a.origin in ('excess', 'unassigned')
        for update
      `)
    ).rows as Row[]
    if (!allocation) throw notFound()
    const [invoice] = (
      await this.db.execute(sql`
        select id, case_id, balance_cents from base.invoices
        where id = ${invoiceId}::uuid and kind = 'invoice' and balance_cents > 0 and closed_at is null
        for update
      `)
    ).rows as Row[]
    if (!invoice) throw new ApiError(409, 'queue.invoice_not_open', 'The invoice is unknown, settled or not open')
    return {
      allocationId,
      paymentId: String(allocation.payment_id),
      invoiceId: String(invoice.id),
      invoiceCaseId: String(invoice.case_id),
      amount: Math.min(Number(allocation.amount_cents), Number(invoice.balance_cents)),
    }
  }

  /**
   * Applies the payment to the invoice (the applied amount is the smaller of the payment and the balance), then replays
   * the lettrage: the excess, if any, stays an unassigned payment and opens a new item, the freezes the payment no longer
   * justifies fall. Returns the cases to evaluate again.
   */
  private async assign(a: NonNullable<Awaited<ReturnType<QueueDecisionService['checkAssignment']>>>, actor: AuthenticatedUser): Promise<string[]> {
    const frozen = (
      await this.db.execute(sql`
        select distinct case_id from base.freezes
        where code = 'unassigned_payment' and source_type = 'payment_allocation' and source_id = ${a.allocationId}::uuid and released_at is null
      `)
    ).rows as Row[]
    await this.db.execute(sql`
      insert into base.payment_allocations (payment_id, invoice_id, amount_cents, origin, assigned_by, assigned_at)
      values (${a.paymentId}::uuid, ${a.invoiceId}::uuid, ${a.amount}, 'supervisor', ${actor.id}::uuid, now())
    `)
    await this.lettrage.rebuild(this.db)
    return [...new Set([a.invoiceCaseId, ...frozen.map((r) => String(r.case_id))])]
  }
}
