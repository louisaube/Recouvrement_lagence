import { Inject, Injectable } from '@nestjs/common'
import { sql } from 'drizzle-orm'
import { Database, DB } from '../../platform/database/database.module'
import { ApiError, notFound } from '../../platform/http/errors'
import type { AuthenticatedUser } from '../../platform/http/request-context'
import { pageOf } from '../../platform/validation/common'
import { isoInstant } from '../recovery-common/sql'
import type { BatchCheckDto, BatchesListQuery, BatchOrdersQuery, DailyBatchDetailDto, DecisionShareDto, OrderDto, ReleaseBatchBody } from './batches.schemas'

type Row = Record<string, unknown>

const num = (v: unknown): number => Number(v ?? 0)
const account = (id: unknown, email: unknown) => (id ? { id: String(id), email: String(email ?? '') } : null)

/**
 * Reading and release of the daily batches. rule-recouvrement-batch-prepared-by-supervisor: the routes are for the
 * profile `supervisor` (the guard of the controller). The preparation is in `BatchPreparationService`.
 */
@Injectable()
export class BatchesService {
  constructor(@Inject(DB) private readonly db: Database) {}

  /** Most recent first: `date` descending, then `createdAt` descending (the batch that replaces another comes first). */
  async list(query: BatchesListQuery) {
    const { from, size } = pageOf(query)
    const rows = (
      await this.db.execute(sql`
        select b.id, b.batch_date::text as batch_date, b.status, b.prepared_by, pu.email as prepared_email, b.created_at,
          b.case_count, b.checks, b.released_by, ru.email as released_email, b.released_at,
          (select count(*)::int from base.send_orders o where o.batch_id = b.id) as order_count
        from base.daily_batches b
        left join base.users pu on pu.id = b.prepared_by
        left join base.users ru on ru.id = b.released_by
        order by b.batch_date desc, b.created_at desc, b.id
        offset ${from} limit ${size}
      `)
    ).rows as Row[]
    const [count] = (await this.db.execute(sql`select count(*)::int as total from base.daily_batches`)).rows as Row[]
    return { items: rows.map((r) => this.summaryOf(r)), total: num(count?.total) }
  }

  async get(id: string): Promise<DailyBatchDetailDto> {
    const [row] = (
      await this.db.execute(sql`
        select b.id, b.batch_date::text as batch_date, b.status, b.prepared_by, pu.email as prepared_email, b.created_at,
          b.case_count, b.checks, b.shares, b.excluded, b.released_by, ru.email as released_email, b.released_at, b.release_reason,
          b.replaced_by, b.policy_version_id, p.label as policy_label,
          (select count(*)::int from base.send_orders o where o.batch_id = b.id) as order_count
        from base.daily_batches b
        left join base.users pu on pu.id = b.prepared_by
        left join base.users ru on ru.id = b.released_by
        left join base.policy_versions p on p.id = b.policy_version_id
        where b.id = ${id}::uuid
      `)
    ).rows as Row[]
    if (!row) throw notFound()
    const byType = (
      await this.db.execute(sql`
        select kind, count(*)::int as n from base.send_orders where batch_id = ${id}::uuid group by kind order by kind collate "C"
      `)
    ).rows as Row[]
    return {
      ...this.summaryOf(row),
      checks: row.checks as BatchCheckDto[],
      shares: row.shares as DecisionShareDto[],
      excluded: row.excluded as DailyBatchDetailDto['excluded'],
      ordersByType: byType.map((r) => ({ type: r.kind as never, count: num(r.n) })),
      releaseReason: (row.release_reason as string | null) ?? null,
      replacedBy: (row.replaced_by as string | null) ?? null,
      policyVersion: row.policy_version_id ? { id: String(row.policy_version_id), label: String(row.policy_label) } : null,
    }
  }

  /** Sorted by customer identifier then type; 404 for an unknown batch. */
  async orders(id: string, query: BatchOrdersQuery) {
    const found = await this.db.execute(sql`select 1 from base.daily_batches where id = ${id}::uuid`)
    if (found.rows.length === 0) throw notFound()
    const { from, size } = pageOf(query)
    const where = sql`o.batch_id = ${id}::uuid ${query.type ? sql`and o.kind = ${query.type}` : sql``} ${query.channel ? sql`and o.channel = ${query.channel}` : sql``}`
    const rows = (
      await this.db.execute(sql`
        select o.id, o.kind, o.status, o.case_id, c.debtor_id, o.interlocutor_id, k.role, o.channel, o.conditions, o.block_reason,
          o.order_date::text as order_date, o.batch_id
        from base.send_orders o
        join base.cases c on c.id = o.case_id
        join base.contacts k on k.id = o.interlocutor_id
        where ${where}
        order by c.debtor_id collate "C", o.kind collate "C", o.id
        offset ${from} limit ${size}
      `)
    ).rows as Row[]
    const [count] = (await this.db.execute(sql`select count(*)::int as total from base.send_orders o where ${where}`)).rows as Row[]
    return {
      items: rows.map(
        (r): OrderDto => ({
          id: String(r.id),
          type: r.kind as never,
          status: r.status as never,
          caseId: String(r.case_id),
          debtorId: String(r.debtor_id),
          interlocutorId: String(r.interlocutor_id),
          interlocutorRole: r.role as never,
          channel: r.channel as never,
          conditions: r.conditions as OrderDto['conditions'],
          blockReason: (r.block_reason as string | null) ?? null,
          orderDate: String(r.order_date),
          batchId: (r.batch_id as string | null) ?? null,
        }),
      ),
      total: num(count?.total),
    }
  }

  /**
   * rule-recouvrement-batch-blocked-release-by-decision (user): a blocked batch becomes ready by a reasoned decision of the
   * supervisor; the reason and the releaser are kept and the checks in failure stay displayed. Its orders stop being blocked.
   */
  async release(id: string, body: ReleaseBatchBody, actor: AuthenticatedUser): Promise<DailyBatchDetailDto> {
    const [locked] = (await this.db.execute(sql`select status from base.daily_batches where id = ${id}::uuid for update`)).rows as Row[]
    if (!locked) throw notFound()
    if (locked.status !== 'blocked') {
      throw new ApiError(409, 'batches.not_releasable', 'Only a blocked batch can be released')
    }
    await this.db.execute(sql`
      update base.daily_batches
      set status = 'ready', released_by = ${actor.id}::uuid, released_at = now(), release_reason = ${body.reason}
      where id = ${id}::uuid
    `)
    await this.db.execute(sql`update base.send_orders set status = 'planned', block_reason = null where batch_id = ${id}::uuid and status = 'blocked'`)
    return this.get(id)
  }

  private summaryOf(r: Row) {
    const checks = (r.checks as BatchCheckDto[]) ?? []
    return {
      id: String(r.id),
      date: String(r.batch_date),
      status: r.status as never,
      preparedBy: account(r.prepared_by, r.prepared_email)!,
      createdAt: isoInstant(r.created_at),
      caseCount: num(r.case_count),
      orderCount: num(r.order_count),
      failedChecks: checks.filter((c) => c.status === 'failed').length,
      releasedBy: account(r.released_by, r.released_email),
      releasedAt: r.released_at ? isoInstant(r.released_at) : null,
    }
  }
}
