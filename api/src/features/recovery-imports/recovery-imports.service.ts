import { Inject, Injectable } from '@nestjs/common'
import { sql } from 'drizzle-orm'
import { Database, DB } from '../../platform/database/database.module'
import { validationFailed } from '../../platform/http/errors'
import type { ApiRequest, AuthenticatedUser } from '../../platform/http/request-context'
import { pageOf } from '../../platform/validation/common'
import { CaseStateService } from '../cases/case-state.service'
import { ClockService, daysBetween } from '../cases/clock.service'
import { previewNotFound } from '../imports/imports.errors'
import { ACCEPTED_EXTENSIONS, ImportsService, MAX_FILE_BYTES, MAX_ROWS } from '../imports/imports.service'
import type { ImportDefinition } from '../imports/imports.types'
import { isoInstant } from '../recovery-common/sql'
import { ImportReportService } from './import-report.service'
import { PAYMENTS_COLUMNS, RECEIVABLES_COLUMNS } from './recovery-columns'
import { FEATURE_OF, IMPORT_TYPES, ImportType, isWholeFile } from './recovery-imports.constants'
import type { ConfirmResponse, HistoryQuery, PreviewQuery, ReportItemsQuery } from './recovery-imports.schemas'
import { contactsDefinition, disputesDefinition, documentsDefinition } from './row-import-definitions'
import { WholeFileImportService } from './whole-file-import.service'

type Row = Record<string, unknown>

const ROW_DEFINITIONS: Record<'disputes' | 'contacts' | 'documents', ImportDefinition> = {
  disputes: disputesDefinition,
  contacts: contactsDefinition,
  documents: documentsDefinition,
}

/**
 * The seven operations of the imports of the module, over the mechanism of the foundation: the three files imported by
 * their valid rows go through `ImportsService` with a definition each; Créances and Paiements, refused as a whole, go
 * through `WholeFileImportService`, which reuses the same primitives and the same preview tables.
 */
@Injectable()
export class RecoveryImportsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly imports: ImportsService,
    private readonly whole: WholeFileImportService,
    private readonly reports: ImportReportService,
    private readonly states: CaseStateService,
    private readonly clock: ClockService,
  ) {}

  specification(type: ImportType) {
    const columns = type === 'receivables' ? RECEIVABLES_COLUMNS : type === 'payments' ? PAYMENTS_COLUMNS : ROW_DEFINITIONS[type].columns
    return {
      columns: columns.map(({ name, required, description }) => ({ name, required, description })),
      maxFileSizeBytes: MAX_FILE_BYTES,
      maxRows: MAX_ROWS,
      acceptedExtensions: ACCEPTED_EXTENSIONS,
      refusedOnFirstError: isWholeFile(type),
      extraFields:
        type === 'receivables'
          ? [
              {
                name: 'controlTotal',
                label: 'Total de contrôle',
                required: true,
                description: "Solde du compte clients à la date d'extraction, saisi par le superviseur (exemple : 1 234 567,89) ; il doit égaler la somme des soldes du fichier.",
              },
            ]
          : [],
    }
  }

  async preview(type: ImportType, query: PreviewQuery, req: ApiRequest) {
    const actor = req.user!
    if (isWholeFile(type)) return this.whole.preview(type, query.controlTotal, req, actor)
    if (query.controlTotal !== undefined) {
      throw validationFailed([{ path: 'controlTotal', message: 'The control total is only expected for the receivables file' }])
    }
    const dto = await this.imports.preview(ROW_DEFINITIONS[type], req)
    await this.reports.compute(this.db, type, dto.importId)
    return { ...dto, accepted: true, computedTotalCents: null, controlTotalCents: null }
  }

  /**
   * The errors of a preview, still readable once the file is confirmed (the screen of the result lists the rows that
   * were left out): same answer as the foundation's, without its restriction to the previews not yet confirmed.
   */
  async errors(type: ImportType, importId: string, query: { from?: number; size?: number }, actor: AuthenticatedUser) {
    const [preview] = (
      await this.db.execute(sql`
        select id, error_entries from base.import_previews
        where id = ${importId.toLowerCase()}::uuid and actor_id = ${actor.id}::uuid and feature = ${FEATURE_OF[type]}
          and (status = 'confirmed' or (status = 'previewed' and expires_at > now()))
      `)
    ).rows as Row[]
    if (!preview) throw previewNotFound()
    const rows = (
      await this.db.execute(sql`
        select row_number as row, "column", reason from base.import_preview_errors
        where preview_id = ${String(preview.id)}::uuid order by seq offset ${query.from ?? 0} limit ${query.size ?? 10}
      `)
    ).rows as Row[]
    return { errors: rows.map((r) => ({ row: Number(r.row), column: String(r.column), reason: String(r.reason) })), total: Number(preview.error_entries) }
  }

  report(type: ImportType, importId: string, actor: AuthenticatedUser) {
    return this.reports.report(type, importId, actor)
  }

  reportItems(type: ImportType, importId: string, query: ReportItemsQuery, actor: AuthenticatedUser) {
    return this.reports.items(type, importId, actor, query.category, query)
  }

  /**
   * Green light of the supervisor (rule-recouvrement-import-green-light). Runs in the transaction of the traced route, so
   * the completions after the foundation's confirmation are atomic with it.
   */
  async confirm(type: ImportType, importId: string, actor: AuthenticatedUser): Promise<ConfirmResponse> {
    if (isWholeFile(type)) {
      const done = await this.whole.confirm(type, importId, actor)
      return { createdCount: done.createdCount, skippedCount: done.skippedCount, effects: done.effects }
    }
    // same lock as the confirmations of Créances and Paiements: a dispute, a contact or a document is never written against
    // an invoice that a concurrent snapshot is closing
    await this.db.execute(sql`select pg_advisory_xact_lock(hashtext('recovery-portfolio'))`)
    // the foundation drops the errors of a preview when it confirms it; the result screen still lists them, so they are
    // put back (same table, same preview) once the confirmation has gone through
    const kept = (
      await this.db.execute(sql`
        select e.preview_id, e.seq, e.row_number, e."column", e.reason from base.import_preview_errors e
        join base.import_previews p on p.id = e.preview_id
        where e.preview_id = ${importId.toLowerCase()}::uuid and p.actor_id = ${actor.id}::uuid
      `)
    ).rows as Row[]
    const done = await this.imports.confirm(ROW_DEFINITIONS[type], importId, actor)
    for (let i = 0; i < kept.length; i += 500) {
      await this.db.execute(sql`
        insert into base.import_preview_errors (preview_id, seq, row_number, "column", reason)
        values ${sql.join(
          kept.slice(i, i + 500).map((e) => sql`(${String(e.preview_id)}::uuid, ${Number(e.seq)}, ${Number(e.row_number)}, ${String(e.column)}, ${String(e.reason)})`),
          sql`, `,
        )}
        on conflict do nothing
      `)
    }
    const effects = await this.complete(type, done.importId, actor)
    return { createdCount: done.createdCount, skippedCount: done.skippedCount, effects }
  }

  /**
   * What the foundation's confirmation cannot do alone. Contacts and documents: the rows left untouched by this file go
   * (the file replaces the whole set; a file without valid row empties it) and the others carry the import. Disputes:
   * the author, then the state of the cases whose invoices have just been frozen (the freezes written by this
   * transaction carry its start instant).
   */
  private async complete(type: ImportType, importId: string, actor: AuthenticatedUser) {
    if (type === 'contacts' || type === 'documents') {
      const table = sql.raw(type === 'contacts' ? 'base.contacts' : 'base.invoice_documents')
      const removed = (await this.db.execute(sql`delete from ${table} where last_import_id is not null returning 1`)).rows.length
      await this.db.execute(sql`update ${table} set last_import_id = ${importId}::uuid where last_import_id is null`)
      return removed > 0 ? [{ label: type === 'contacts' ? 'Interlocuteurs retirés (absents du fichier)' : 'Pièces retirées (absentes du fichier)', count: removed }] : []
    }
    if (type === 'disputes') {
      await this.db.execute(sql`update base.disputes set opened_by = ${actor.id}::uuid where origin = 'import' and opened_by is null`)
      const touched = (
        await this.db.execute(sql`select case_id, invoice_id from base.freezes where code = 'dispute' and since = now() and released_at is null`)
      ).rows as Row[]
      const changes = await this.states.recomputeMany(
        this.db,
        [...new Set(touched.map((r) => String(r.case_id)))],
        { actor: 'import', reference: importId, cause: 'dispute_opened' },
      )
      return [
        { label: 'Factures gelées', count: new Set(touched.map((r) => String(r.invoice_id))).size },
        { label: 'Dossiers gelés', count: changes.filter((c) => c.to === 'frozen').length },
      ]
    }
    return []
  }

  async history(query: HistoryQuery) {
    const { from, size } = pageOf(query)
    const features = (query.type ? [query.type] : [...IMPORT_TYPES]).map((t) => FEATURE_OF[t])
    const filter = sql`p.status = 'confirmed' and p.feature = any(array[${sql.join(features.map((f) => sql`${f}`), sql`, `)}]::text[])`
    const rows = (
      await this.db.execute(sql`
        select p.id, p.feature, p.file_name, p.confirmed_at, p.actor_id, u.email, p.total_rows, p.created_count, p.skipped_count
        from base.import_previews p left join base.users u on u.id = p.actor_id
        where ${filter} order by p.confirmed_at desc, p.id desc offset ${from} limit ${size}
      `)
    ).rows as Row[]
    const [count] = (await this.db.execute(sql`select count(*)::int as total from base.import_previews p where ${filter}`)).rows as Row[]
    const typeOf = new Map(IMPORT_TYPES.map((t) => [FEATURE_OF[t], t]))
    return {
      items: rows.map((r) => ({
        importId: String(r.id),
        type: typeOf.get(String(r.feature))!,
        fileName: String(r.file_name),
        confirmedAt: isoInstant(r.confirmed_at),
        confirmedBy: { id: String(r.actor_id), email: String(r.email ?? '') },
        totalRows: Number(r.total_rows),
        createdCount: Number(r.created_count ?? 0),
        skippedCount: Number(r.skipped_count ?? 0),
      })),
      total: Number(count?.total ?? 0),
    }
  }

  /** rule-recouvrement-statement-fresh: without active policy `maxAgeDays` is null and the statement is never fresh. */
  async status() {
    const [statement] = (
      await this.db.execute(sql`select statement_date::text as d from base.statements order by statement_date desc, confirmed_at desc limit 1`)
    ).rows as Row[]
    const [snapshot] = (await this.db.execute(sql`select max(extraction_date)::text as d from base.receivable_snapshots`)).rows as Row[]
    const maxAge = await this.whole.statementMaxAgeDays()
    const lastStatementDate = (statement?.d as string | undefined) ?? null
    const last = (
      await this.db.execute(sql`
        select distinct on (feature) feature, confirmed_at, file_name from base.import_previews where status = 'confirmed' order by feature, confirmed_at desc
      `)
    ).rows as Row[]
    const typeOf = new Map(IMPORT_TYPES.map((t) => [FEATURE_OF[t], t]))
    return {
      statement: {
        lastStatementDate,
        maxAgeDays: maxAge,
        fresh: lastStatementDate !== null && maxAge !== null && daysBetween(lastStatementDate, this.clock.today()) <= maxAge,
      },
      receivablesExtractionDate: (snapshot?.d as string | null | undefined) ?? null,
      lastConfirmed: last
        .filter((r) => typeOf.has(String(r.feature)))
        .map((r) => ({ type: typeOf.get(String(r.feature))!, confirmedAt: isoInstant(r.confirmed_at), fileName: String(r.file_name) }))
        .sort((a, b) => IMPORT_TYPES.indexOf(a.type) - IMPORT_TYPES.indexOf(b.type)),
    }
  }
}
