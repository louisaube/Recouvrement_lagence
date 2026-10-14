import { Inject, Injectable } from '@nestjs/common'
import { sql } from 'drizzle-orm'
import { Database, DB } from '../../platform/database/database.module'
import { pageOf } from '../../platform/validation/common'
import { isoInstant } from '../recovery-common/sql'
import { QUEUE_TYPES, type QueueType } from './decision-queue.tables'
import type { QueueItemsQuery } from './decision-queue.schemas'

type Row = Record<string, unknown>

/** Decisions allowed by type (referentiel-etats-et-transitions §4, rule-recouvrement-queue-allowed-decisions). */
export const ALLOWED_DECISIONS: Record<QueueType, string[]> = {
  contestation: ['acknowledge'],
  amount_over_threshold: ['authorize', 'transfer'],
  ladder_exhausted: ['keep', 'transfer'],
  unassigned_payment: ['assign'],
  accounting_gap: ['reapprove'],
  prescription_near: ['acknowledge', 'transfer'],
  prescription_expired: ['acknowledge', 'transfer'],
  alert: ['acknowledge'],
  human_request: ['resume', 'transfer'],
  transfer_proposed: ['approve_transfer', 'reject_transfer'],
}

const detailsOf = (raw: unknown): { label: string; value: string }[] =>
  (Array.isArray(raw) ? raw : [])
    .filter((d): d is { label: unknown; value?: unknown } => typeof d === 'object' && d !== null && 'label' in d)
    .slice(0, 20)
    .map((d) => ({ label: String(d.label).slice(0, 100), value: String(d.value ?? '').slice(0, 300) }))
    .filter((d) => d.label.length > 0)

/** Read side of the queue of the supervisor (rule-recouvrement-queue-order). */
@Injectable()
export class QueueReadService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async list(query: QueueItemsQuery) {
    const { from, size } = pageOf(query)
    const where = query.type ? sql`q.status = ${query.status} and q.type = ${query.type}` : sql`q.status = ${query.status}`
    const order = query.status === 'open' ? sql`q.created_at asc, q.id` : sql`q.decided_at desc, q.id`
    const rows = (
      await this.db.execute(sql`
        select q.id, q.type, q.status, q.created_at, q.case_id, q.object_key, q.summary, q.details,
          q.decided_at, q.decision_code, q.decision_reason, q.decided_by, c.debtor_id, u.email as decided_by_email
        from base.queue_items q
        left join base.cases c on c.id = q.case_id
        left join base.users u on u.id = q.decided_by
        where ${where} order by ${order} offset ${from} limit ${size}
      `)
    ).rows as Row[]
    const [count] = (await this.db.execute(sql`select count(*)::int as total from base.queue_items q where ${where}`)).rows as Row[]

    const items = []
    for (const r of rows) {
      const open = r.status === 'open'
      items.push({
        id: String(r.id),
        type: r.type as QueueType,
        status: r.status as 'open' | 'decided',
        createdAt: isoInstant(r.created_at),
        caseId: r.case_id === null ? null : String(r.case_id),
        debtorId: r.debtor_id === null || r.debtor_id === undefined ? null : String(r.debtor_id),
        summary: String(r.summary),
        details: detailsOf(r.details),
        allowedDecisions: open ? ALLOWED_DECISIONS[r.type as QueueType] : [],
        candidates: open && r.type === 'unassigned_payment' ? await this.candidates(String(r.object_key)) : [],
        decision: open
          ? null
          : {
              code: String(r.decision_code),
              reason: r.decision_reason === null ? '' : String(r.decision_reason),
              decidedAt: isoInstant(r.decided_at),
              decidedBy: r.decided_by === null || r.decided_by === undefined || r.decided_by_email === null ? null : { id: String(r.decided_by), email: String(r.decided_by_email) },
            },
      })
    }
    return { items, total: Number(count?.total ?? 0) }
  }

  /** Open invoices of the cases frozen by the unassigned payment (rule-recouvrement-unassigned-payment-freeze). */
  private async candidates(allocationId: string) {
    const rows = (
      await this.db.execute(sql`
        select i.id, i.case_id, c.debtor_id, i.number, i.creditor_siren, i.balance_cents
        from base.invoices i join base.cases c on c.id = i.case_id
        where i.kind = 'invoice' and i.balance_cents > 0
          and i.case_id in (
            select f.case_id from base.freezes f
            where f.code = 'unassigned_payment' and f.source_type = 'payment_allocation' and f.source_id = ${allocationId}::uuid and f.released_at is null
          )
        order by c.debtor_id, i.number, i.id limit 50
      `)
    ).rows as Row[]
    return rows.map((r) => ({
      invoiceId: String(r.id),
      caseId: String(r.case_id),
      debtorId: String(r.debtor_id),
      number: String(r.number),
      creditorSiren: String(r.creditor_siren),
      balanceCents: Number(r.balance_cents),
    }))
  }

  async counts() {
    const rows = (await this.db.execute(sql`select type, count(*)::int as n from base.queue_items where status = 'open' group by type`)).rows as Row[]
    const byType = Object.fromEntries(QUEUE_TYPES.map((t) => [t, 0])) as Record<QueueType, number>
    for (const r of rows) byType[r.type as QueueType] = Number(r.n)
    return { total: Object.values(byType).reduce((a, b) => a + b, 0), byType }
  }
}
