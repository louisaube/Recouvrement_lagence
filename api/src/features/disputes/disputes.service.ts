import { Inject, Injectable } from '@nestjs/common'
import { sql, SQL } from 'drizzle-orm'
import { Database, DB } from '../../platform/database/database.module'
import { notFound } from '../../platform/http/errors'
import { pageOf } from '../../platform/validation/common'
import { isoInstant } from '../recovery-common/sql'
import type { DisputeInvoicesQuery, DisputesListQuery } from './disputes.schemas'

type Row = Record<string, unknown>

const num = (v: unknown): number => Number(v ?? 0)

const FROZEN = sql`exists (select 1 from base.freezes f where f.case_id = i.case_id and f.released_at is null and (f.scope = 'case' or f.invoice_id = i.id))`

const invoiceOf = (r: Row) => ({
  id: String(r.invoice_id),
  number: String(r.number),
  creditorSiren: String(r.creditor_siren),
  debtorId: String(r.debtor_id),
  balanceCents: num(r.balance_cents),
  frozen: Boolean(r.frozen),
})

const disputeOf = (r: Row) => ({
  id: String(r.id),
  status: (r.closed_at === null ? 'open' : 'closed') as 'open' | 'closed',
  origin: r.origin as 'import' | 'contestation' | 'service',
  invoiceNumber: String(r.number),
  creditorSiren: String(r.creditor_siren),
  balanceCents: num(r.balance_cents),
  debtorId: String(r.debtor_id),
  caseId: String(r.case_id),
  caseState: r.case_state as never,
  reason: String(r.reason),
  owner: String(r.owner),
  openedAt: isoInstant(r.opened_at),
  closedAt: r.closed_at === null ? null : isoInstant(r.closed_at),
})

const SELECT = sql`
  select d.id, d.origin, d.reason, d.owner, d.opened_at, d.closed_at, d.opened_by, d.closed_by, d.close_note, d.case_id, d.invoice_id,
    i.number, i.creditor_siren, i.balance_cents, c.debtor_id, c.state as case_state, c.nature,
    ${FROZEN} as frozen
  from base.disputes d
  join base.invoices i on i.id = d.invoice_id
  join base.cases c on c.id = d.case_id`

/**
 * Read side of the disputes (rule-recouvrement-disputes-litigation-only: the controller admits the profile `litigation`
 * only). Opening and closing come with the lot of the agent tools.
 */
@Injectable()
export class DisputesService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async list(query: DisputesListQuery) {
    const { from, size } = pageOf(query)
    const parts: SQL[] = [sql`true`]
    if (query.status === 'open') parts.push(sql`d.closed_at is null`)
    if (query.status === 'closed') parts.push(sql`d.closed_at is not null`)
    if (query.origin) parts.push(sql`d.origin = ${query.origin}`)
    if (query.search) {
      parts.push(sql`(position(lower(${query.search}) in lower(i.number)) > 0 or position(lower(${query.search}) in lower(c.debtor_id)) > 0)`)
    }
    const where = sql.join(parts, sql` and `)
    const order =
      query.status === 'open'
        ? sql`d.opened_at asc, d.id`
        : query.status === 'closed'
          ? sql`d.closed_at desc, d.id`
          : sql`(d.closed_at is not null), coalesce(d.closed_at, d.opened_at) desc, d.id`
    const rows = (await this.db.execute(sql`${SELECT} where ${where} order by ${order} offset ${from} limit ${size}`)).rows as Row[]
    const [count] = (
      await this.db.execute(sql`
        select count(*)::int as total from base.disputes d join base.invoices i on i.id = d.invoice_id join base.cases c on c.id = d.case_id where ${where}
      `)
    ).rows as Row[]
    return { items: rows.map(disputeOf), total: num(count?.total) }
  }

  /** Open invoices (balance above zero, not credit notes) by number prefix, to pick the invoice of a new dispute. */
  async invoices(query: DisputeInvoicesQuery) {
    const { from, size } = pageOf(query)
    const where = sql`i.kind = 'invoice' and i.balance_cents > 0 and lower(i.number) like lower(${query.number.replace(/[\\%_]/g, '\\$&')}) || '%'`
    const rows = (
      await this.db.execute(sql`
        select i.id as invoice_id, i.number, i.creditor_siren, i.balance_cents, c.debtor_id, ${FROZEN} as frozen
        from base.invoices i join base.cases c on c.id = i.case_id
        where ${where} order by i.number collate "C", i.creditor_siren offset ${from} limit ${size}
      `)
    ).rows as Row[]
    const [count] = (await this.db.execute(sql`select count(*)::int as total from base.invoices i where ${where}`)).rows as Row[]
    return { items: rows.map(invoiceOf), total: num(count?.total) }
  }

  /** rule-recouvrement-dispute-contestation-origin: the contestations come with the lot of the agent tools (null until then). */
  async get(id: string) {
    const [row] = (await this.db.execute(sql`${SELECT} where d.id = ${id}::uuid`)).rows as Row[]
    if (!row) throw notFound()
    const [counts] = (
      await this.db.execute(sql`
        select count(*) filter (where i.kind = 'invoice' and i.balance_cents > 0)::int as open_invoices,
          count(*) filter (where i.kind = 'invoice' and i.balance_cents > 0 and ${FROZEN})::int as frozen_invoices
        from base.invoices i where i.case_id = ${String(row.case_id)}::uuid
      `)
    ).rows as Row[]
    const accounts = new Map<string, { id: string; email: string }>()
    const ids = [row.opened_by, row.closed_by].filter((v): v is string => typeof v === 'string')
    for (const accountId of ids) {
      const [user] = (await this.db.execute(sql`select id, email from base.users where id = ${accountId}::uuid`)).rows as Row[]
      accounts.set(accountId, { id: accountId, email: String(user?.email ?? '') })
    }
    return {
      ...disputeOf(row),
      invoice: invoiceOf(row),
      case: {
        id: String(row.case_id),
        debtorId: String(row.debtor_id),
        nature: row.nature as 'family' | 'company',
        state: row.case_state as never,
        openInvoices: num(counts?.open_invoices),
        frozenInvoices: num(counts?.frozen_invoices),
      },
      closeNote: row.close_note === null ? null : String(row.close_note),
      closedBy: typeof row.closed_by === 'string' ? accounts.get(row.closed_by)! : null,
      openedBy: typeof row.opened_by === 'string' ? accounts.get(row.opened_by)! : null,
      contestation: null,
    }
  }
}
