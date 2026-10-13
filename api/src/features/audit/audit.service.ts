import { Injectable } from '@nestjs/common'
import { and, count, desc, eq, isNotNull, sql, SQL } from 'drizzle-orm'
import { Database, InjectDb } from '../../platform/database/database.module'
import { byLowerText, byText } from '../../platform/database/ordering'
import { pageOf } from '../../platform/validation/common'
import { parseZonedDateTime, type AuditEntryDto, type AuditLogFiltersDto, type AuditLogsListQuery } from './audit.schemas'
import { auditLogs } from './audit.tables'

/** rule-foundation-audit-filter-options-from-journal */
const OPTIONS_MAX = 1000

/** Read side of the journal. Nothing here writes: entries are written by the platform (`@Audited`). */
@Injectable()
export class AuditService {
  constructor(@InjectDb() private readonly db: Database) {}

  /**
   * rule-foundation-audit-filters, rule-foundation-audit-filters-combine: exact equality, ANDed, bounds included to the
   * millisecond. rule-foundation-audit-newest-first: `occurred_at` then `id`, both descending (total, stable order).
   */
  async list(query: AuditLogsListQuery): Promise<{ entries: AuditEntryDto[]; total: number }> {
    const { from, size } = pageOf(query)
    const conditions: SQL[] = []
    if (query.actorId !== undefined) conditions.push(eq(auditLogs.actorId, query.actorId.toLowerCase()))
    if (query.action !== undefined) conditions.push(eq(auditLogs.action, query.action))
    if (query.objectType !== undefined) conditions.push(eq(auditLogs.objectType, query.objectType))
    if (query.scope !== undefined) conditions.push(eq(auditLogs.scopeCode, query.scope))
    // bounds are instants computed here (milliseconds since the epoch): PostgreSQL never parses the raw text, whose
    // zone offset it could refuse, and the comparison is exact to the millisecond (rule-foundation-audit-ms-precision)
    const instant = (millis: number): SQL => sql`'epoch'::timestamptz + ${millis}::double precision * interval '1 millisecond'`
    const lower = query.occurredFrom === undefined ? null : parseZonedDateTime(query.occurredFrom)
    const upper = query.occurredTo === undefined ? null : parseZonedDateTime(query.occurredTo)
    if (lower !== null) conditions.push(sql`${auditLogs.occurredAt} >= ${instant(lower)}`)
    if (upper !== null) conditions.push(sql`${auditLogs.occurredAt} <= ${instant(upper)}`)
    const where = conditions.length > 0 ? and(...conditions) : undefined

    const rows = await this.db
      .select()
      .from(auditLogs)
      .where(where)
      .orderBy(desc(auditLogs.occurredAt), desc(auditLogs.id))
      .limit(size)
      .offset(from)
    const [{ total }] = await this.db.select({ total: count() }).from(auditLogs).where(where)
    return {
      entries: rows.map((row) => ({
        id: row.id,
        occurredAt: row.occurredAt.toISOString(),
        actor: { id: row.actorId, email: row.actorEmail },
        action: row.action,
        objectType: row.objectType,
        objectId: row.objectId,
        scope: row.scopeCode,
        summary: row.summary,
      })),
      total: Number(total),
    }
  }

  /**
   * rule-foundation-audit-filter-options-from-journal: computed from the journal only. An author appears once with the
   * e-mail of their latest entry (sorted by e-mail ignoring case, then id); the other lists are distinct, non-null
   * values in byte order; at most 1000 elements each.
   */
  async filters(): Promise<AuditLogFiltersDto> {
    const latest = this.db
      .selectDistinctOn([auditLogs.actorId], { id: auditLogs.actorId, email: auditLogs.actorEmail })
      .from(auditLogs)
      .orderBy(auditLogs.actorId, desc(auditLogs.occurredAt), desc(auditLogs.id))
      .as('latest')
    const [actors, actions, objectTypes, scopes] = await Promise.all([
      this.db
        .select({ id: latest.id, email: latest.email })
        .from(latest)
        .orderBy(byLowerText(latest.email), latest.id)
        .limit(OPTIONS_MAX),
      // distinct values by grouping: `select distinct` refuses an ordering expression (collation) outside the select list
      this.db
        .select({ value: auditLogs.action })
        .from(auditLogs)
        .groupBy(auditLogs.action)
        .orderBy(byText(auditLogs.action))
        .limit(OPTIONS_MAX),
      this.db
        .select({ value: auditLogs.objectType })
        .from(auditLogs)
        .groupBy(auditLogs.objectType)
        .orderBy(byText(auditLogs.objectType))
        .limit(OPTIONS_MAX),
      this.db
        .select({ value: auditLogs.scopeCode })
        .from(auditLogs)
        .where(isNotNull(auditLogs.scopeCode))
        .groupBy(auditLogs.scopeCode)
        .orderBy(byText(auditLogs.scopeCode))
        .limit(OPTIONS_MAX),
    ])
    return {
      actors,
      actions: actions.map((row) => row.value),
      objectTypes: objectTypes.map((row) => row.value),
      scopes: scopes.map((row) => row.value as string),
    }
  }
}
