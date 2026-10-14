import { Inject, Injectable } from '@nestjs/common'
import { sql, SQL } from 'drizzle-orm'
import { Database, DB } from '../../platform/database/database.module'
import { notFound } from '../../platform/http/errors'
import { pageOf } from '../../platform/validation/common'
import { isoInstant } from '../recovery-common/sql'
import { CasePageQuery, CasesListQuery, InvoicesSearchQuery } from './cases.schemas'
import { ClockService } from './clock.service'

type Row = Record<string, unknown>

const num = (v: unknown): number => Number(v ?? 0)
const iso = isoInstant

/**
 * Facts of every invoice, computed at read time from the active policy (never stored):
 * rule-recouvrement-prescription (date = start + delay; `expired` from the date, `near` from `date - alertDays`),
 * rule-recouvrement-invoice-dispute-frozen (an active freeze of the invoice or of its case),
 * rule-recouvrement-negotiable-amount and rule-recouvrement-negotiable-credit-notes (only open invoices, not frozen, not
 * expired). The part covered by accounting outputs (rule-recouvrement-negotiable-outputs) is zero until the lot of the outputs.
 */
const facts = (today: string): SQL => sql`
  rules as (
    select r->>'segment' as segment, r->>'nature' as nature,
      (r->'limitation'->>'delayDays')::int as delay_days,
      (r->'limitation'->>'alertDays')::int as alert_days,
      r->'limitation'->>'startsFrom' as starts_from
    from base.policy_versions pv, jsonb_array_elements(pv.document->'parameters'->'rules') r
    where pv.status = 'active'
  ),
  base_facts as (
    select i.id, i.case_id, i.kind, i.number, i.creditor_siren, i.amount_cents, i.balance_cents, i.invoice_date, i.due_date,
      (i.kind = 'invoice' and i.balance_cents > 0) as is_open,
      case when i.kind = 'invoice' and i.balance_cents > 0 and ru.delay_days is not null
        then (case when ru.starts_from = 'invoice_date' then i.invoice_date else i.due_date end) + ru.delay_days end as presc_date,
      ru.alert_days,
      coalesce((select array_agg(distinct f.code order by f.code) from base.freezes f
        where f.case_id = i.case_id and f.released_at is null and (f.scope = 'case' or f.invoice_id = i.id)), '{}'::text[]) as freeze_codes
    from base.invoices i
    join base.cases c on c.id = i.case_id
    left join rules ru on ru.segment = c.segment and ru.nature = c.nature
  ),
  inv as (
    select b.*,
      case when b.presc_date is null then 'none'
        when ${today}::date >= b.presc_date then 'expired'
        when ${today}::date >= b.presc_date - b.alert_days then 'near'
        else 'none' end as prescription,
      cardinality(b.freeze_codes) > 0 as frozen,
      case when b.is_open then greatest(0, ${today}::date - b.due_date) else 0 end as days_late
    from base_facts b
  ),
  inv2 as (
    select inv.*, (inv.is_open and not inv.frozen and inv.prescription <> 'expired') as negotiable from inv
  ),
  agg as (
    select case_id,
      coalesce(sum(balance_cents) filter (where negotiable), 0) as negotiable_cents,
      coalesce(sum(balance_cents) filter (where is_open), 0) as open_balance_cents,
      count(*) filter (where is_open) as open_invoices,
      coalesce(max(days_late), 0) as max_days_late,
      array_agg(distinct creditor_siren order by creditor_siren) as creditors
    from inv2 group by case_id
  )`

function summaryOf(row: Row) {
  return {
    id: String(row.id),
    debtorId: String(row.debtor_id),
    nature: row.nature as 'family' | 'company',
    segment: String(row.segment),
    creditors: ((row.creditors as string[] | null) ?? []).map(String),
    state: row.state as never,
    negotiableCents: Math.max(0, num(row.negotiable_cents)),
    openBalanceCents: num(row.open_balance_cents),
    openInvoices: num(row.open_invoices),
    maxDaysLate: num(row.max_days_late),
    updatedAt: iso(row.updated_at),
  }
}

@Injectable()
export class CasesService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly clock: ClockService,
  ) {}

  private filters(query: CasesListQuery): SQL {
    const parts: SQL[] = [sql`true`]
    if (query.state) parts.push(sql`c.state = ${query.state}`)
    if (query.nature) parts.push(sql`c.nature = ${query.nature}`)
    if (query.segment) parts.push(sql`c.segment = ${query.segment}`)
    if (query.creditor) parts.push(sql`exists (select 1 from base.invoices x where x.case_id = c.id and x.creditor_siren = ${query.creditor})`)
    // Literal substring, case-insensitive: no LIKE wildcard to escape.
    if (query.search) parts.push(sql`position(lower(${query.search}) in lower(c.debtor_id)) > 0`)
    return sql.join(parts, sql` and `)
  }

  private async summaries(where: SQL, today: string, page?: { from: number; size: number }): Promise<ReturnType<typeof summaryOf>[]> {
    const paging = page ? sql`order by coalesce(a.negotiable_cents, 0) desc, c.debtor_id collate "C" offset ${page.from} limit ${page.size}` : sql``
    const result = await this.db.execute(sql`
      with ${facts(today)}
      select c.id, c.debtor_id, c.nature, c.segment, c.state, c.updated_at,
        coalesce(a.negotiable_cents, 0)::bigint as negotiable_cents, coalesce(a.open_balance_cents, 0)::bigint as open_balance_cents,
        coalesce(a.open_invoices, 0)::int as open_invoices, coalesce(a.max_days_late, 0)::int as max_days_late,
        coalesce(a.creditors, '{}'::text[]) as creditors
      from base.cases c left join agg a on a.case_id = c.id
      where ${where}
      ${paging}
    `)
    return (result.rows as Row[]).map(summaryOf)
  }

  /** rule-recouvrement-cases-supervisor-only: sorted by negotiable amount, then customer identifier. */
  async list(query: CasesListQuery) {
    const today = this.clock.today()
    const where = this.filters(query)
    const items = await this.summaries(where, today, pageOf(query))
    const [count] = (await this.db.execute(sql`select count(*)::int as total from base.cases c where ${where}`)).rows as Row[]
    return { items, total: num(count?.total) }
  }

  async filtersLists() {
    const segments = await this.db.execute(sql`select segment as value from base.cases group by segment order by segment collate "C"`)
    const creditors = await this.db.execute(sql`select creditor_siren as value from base.invoices group by creditor_siren order by creditor_siren collate "C"`)
    return {
      segments: (segments.rows as Row[]).map((r) => String(r.value)),
      creditors: (creditors.rows as Row[]).map((r) => String(r.value)),
    }
  }

  async get(id: string) {
    const today = this.clock.today()
    const [summary] = await this.summaries(sql`c.id = ${id}::uuid`, today)
    if (!summary) throw notFound()

    const [caseRow] = (await this.db.execute(sql`select debtor_siren from base.cases where id = ${id}::uuid`)).rows as Row[]
    const invoiceRows = (
      await this.db.execute(sql`
        with ${facts(today)}
        select id, kind, number, creditor_siren, amount_cents, balance_cents, invoice_date::text as invoice_date, due_date::text as due_date,
          days_late, frozen, freeze_codes, prescription, presc_date::text as presc_date, negotiable
        from inv2 where case_id = ${id}::uuid
        order by due_date, number collate "C", id
      `)
    ).rows as Row[]
    const freezeRows = (
      await this.db.execute(sql`
        select f.code, f.scope, i.number as invoice_number, f.since, f.reference
        from base.freezes f left join base.invoices i on i.id = f.invoice_id
        where f.case_id = ${id}::uuid and f.released_at is null
        order by f.since, f.id
      `)
    ).rows as Row[]
    const queueRows = (
      await this.db.execute(sql`
        select id, type from base.queue_items where case_id = ${id}::uuid and status = 'open' order by created_at, id
      `)
    ).rows as Row[]
    const [policy] = (
      await this.db.execute(sql`select id, label from base.policy_versions where status = 'active'`)
    ).rows as Row[]

    return {
      ...summary,
      debtorSiren: (caseRow?.debtor_siren as string | null) ?? null,
      invoices: invoiceRows.map((r) => ({
        id: String(r.id),
        kind: r.kind as 'invoice' | 'credit_note',
        number: String(r.number),
        creditorSiren: String(r.creditor_siren),
        amountCents: num(r.amount_cents),
        balanceCents: num(r.balance_cents),
        invoiceDate: String(r.invoice_date),
        dueDate: String(r.due_date),
        daysLate: num(r.days_late),
        frozen: Boolean(r.frozen),
        freezeCodes: (r.freeze_codes as string[]) as never,
        prescription: r.prescription as 'none' | 'near' | 'expired',
        prescriptionDate: r.presc_date ? String(r.presc_date) : null,
        // Part covered by accounting outputs: the outputs come with their own lot.
        coveredByOutputsCents: 0,
        negotiable: Boolean(r.negotiable),
      })),
      freezes: freezeRows.map((r) => ({
        code: r.code as never,
        scope: r.scope as 'invoice' | 'case',
        invoiceNumber: (r.invoice_number as string | null) ?? null,
        since: iso(r.since),
        reference: String(r.reference),
      })),
      unlockedOffers: [],
      commitments: [],
      ledgerOutputs: [],
      openQueueItems: queueRows.map((r) => ({ id: String(r.id), type: String(r.type) })),
      activePolicy: policy ? { id: String(policy.id), label: String(policy.label) } : null,
    }
  }

  private async requireCase(id: string): Promise<void> {
    const found = await this.db.execute(sql`select 1 from base.cases where id = ${id}::uuid`)
    if (found.rows.length === 0) throw notFound()
  }

  /** rule-recouvrement-decision-journal, rule-recouvrement-internal-reason-private: most recent first. */
  async decisions(id: string, query: CasePageQuery) {
    await this.requireCase(id)
    const { from, size } = pageOf(query)
    const rows = (
      await this.db.execute(sql`
        select d.id, d.decided_at, d.kind, d.outcome, d.rule_id, d.policy_version_id, p.label as policy_label,
          d.probability::float8 as probability, d.inputs, d.internal_reason, d.batch_id
        from base.decisions d left join base.policy_versions p on p.id = d.policy_version_id
        where d.case_id = ${id}::uuid
        order by d.decided_at desc, d.id desc
        offset ${from} limit ${size}
      `)
    ).rows as Row[]
    const [count] = (await this.db.execute(sql`select count(*)::int as total from base.decisions where case_id = ${id}::uuid`)).rows as Row[]
    return {
      items: rows.map((r) => ({
        id: String(r.id),
        decidedAt: iso(r.decided_at),
        kind: r.kind as never,
        outcome: String(r.outcome),
        ruleId: (r.rule_id as string | null) ?? null,
        policyVersion: r.policy_version_id ? { id: String(r.policy_version_id), label: String(r.policy_label) } : null,
        probability: Number(r.probability),
        inputs: r.inputs as { name: string; value: string }[],
        internalReason: r.internal_reason as { name: string; value: string }[],
        batchId: (r.batch_id as string | null) ?? null,
      })),
      total: num(count?.total),
    }
  }

  /** rule-recouvrement-state-transitions-logged: most recent first. */
  async stateHistory(id: string, query: CasePageQuery) {
    await this.requireCase(id)
    const { from, size } = pageOf(query)
    const rows = (
      await this.db.execute(sql`
        select at, from_state, to_state, cause, actor, reference
        from base.case_state_history where case_id = ${id}::uuid
        order by id desc offset ${from} limit ${size}
      `)
    ).rows as Row[]
    const [count] = (await this.db.execute(sql`select count(*)::int as total from base.case_state_history where case_id = ${id}::uuid`)).rows as Row[]
    return {
      items: rows.map((r) => ({
        at: iso(r.at),
        from: (r.from_state as never) ?? null,
        to: r.to_state as never,
        cause: String(r.cause),
        actor: String(r.actor),
        reference: (r.reference as string | null) ?? null,
      })),
      total: num(count?.total),
    }
  }

  /** Open invoices whose number starts with the text (case-insensitive, literal), sorted by number. */
  async searchInvoices(query: InvoicesSearchQuery) {
    const { from, size } = pageOf(query)
    const prefix = sql`left(lower(i.number), char_length(${query.number})) = lower(${query.number})`
    const rows = (
      await this.db.execute(sql`
        select i.id, i.case_id, c.debtor_id, i.number, i.creditor_siren, i.balance_cents,
          exists (select 1 from base.freezes f where f.case_id = i.case_id and f.released_at is null and (f.scope = 'case' or f.invoice_id = i.id)) as frozen
        from base.invoices i join base.cases c on c.id = i.case_id
        where i.kind = 'invoice' and i.balance_cents > 0 and ${prefix}
        order by i.number collate "C", i.creditor_siren, i.id
        offset ${from} limit ${size}
      `)
    ).rows as Row[]
    const [count] = (
      await this.db.execute(sql`select count(*)::int as total from base.invoices i where i.kind = 'invoice' and i.balance_cents > 0 and ${prefix}`)
    ).rows as Row[]
    return {
      items: rows.map((r) => ({
        id: String(r.id),
        caseId: String(r.case_id),
        debtorId: String(r.debtor_id),
        number: String(r.number),
        creditorSiren: String(r.creditor_siren),
        balanceCents: num(r.balance_cents),
        frozen: Boolean(r.frozen),
      })),
      total: num(count?.total),
    }
  }
}
