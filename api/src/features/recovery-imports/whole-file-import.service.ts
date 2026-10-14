import { Inject, Injectable } from '@nestjs/common'
import { sql } from 'drizzle-orm'
import { rm } from 'node:fs/promises'
import { Database, DB } from '../../platform/database/database.module'
import { ApiError, isUniqueViolation, validationFailed } from '../../platform/http/errors'
import type { ApiRequest, AuthenticatedUser } from '../../platform/http/request-context'
import { CaseStateService, StateChange } from '../cases/case-state.service'
import { ClockService, daysBetween } from '../cases/clock.service'
import {
  alreadyImported,
  emptyFile,
  ImportAborted,
  invalidFileType,
  missingColumns,
  previewNotFound,
  tooManyRows,
} from '../imports/imports.errors'
import { MAX_FILE_BYTES, MAX_ROWS } from '../imports/imports.service'
import { CELL_TOO_LONG, fitReason } from '../imports/imports.text'
import type { ColumnFault, ImportColumn, ImportExecutor } from '../imports/imports.types'
import { isBlankRow, MAX_CELL_CHARACTERS, RawRow, readRows } from '../imports/readers'
import { receiveUpload, type ReceivedFile } from '../imports/receive'
import { inspectXlsx, type WorkbookInfo } from '../imports/xlsx-inspect'
import { ImportReportService } from './import-report.service'
import { LettrageService } from './lettrage.service'
import { PAYMENTS_COLUMNS, paymentCrossFaults, RECEIVABLES_COLUMNS, receivableCrossFaults } from './recovery-columns'
import { isoInstant } from '../recovery-common/sql'
import { FEATURE_OF, WholeFileType } from './recovery-imports.constants'
import { CONTROL_TOTAL_PATTERN, formatCents, parseControlTotal, quoted } from './recovery-parsers'

type Row = Record<string, unknown>
type Kind = 'csv' | 'xlsx'
export interface Effect {
  label: string
  count: number
}
export interface WholePreviewResult {
  importId: string
  fileName: string
  totalRows: number
  validRows: number
  errorRows: number
  expiresAt: string
  accepted: boolean
  computedTotalCents: number | null
  controlTotalCents: number | null
}
export interface WholeConfirmResult {
  importId: string
  createdCount: number
  skippedCount: number
  fileName: string
  totalRows: number
  effects: Effect[]
}

const BATCH_SIZE = 1000
const PURGE_PER_CALL = 20
const READER_ROW_MARGIN = 100_000

/** Control-total errors and the like: the file as a whole, attributed to the header row. */
const HEADER_ROW = 1

interface FileFault extends ColumnFault {
  rowNumber: number
}

const columnsOf = (type: WholeFileType): ImportColumn[] => (type === 'receivables' ? RECEIVABLES_COLUMNS : PAYMENTS_COLUMNS)

/**
 * The two files refused as a whole at the first error (rule-recouvrement-import-refuse-whole): Créances and Paiements.
 * Same steps as `ImportsService.preview` (the foundation mechanism is frozen and keeps its helpers private, the few
 * of them used here are copied, each said so), with a different rule of analysis: the reading stops at the first fault
 * of the file, nothing is counted valid, and the preview is `accepted: false`. A valid file keeps its rows in
 * `import_preview_rows`, as the foundation does, and the confirmation applies them with set-based statements.
 *
 * Memory: the keys of the duplicate check (SIREN + number, reference) and the attributes of the debtors seen are kept
 * in two maps for the duration of the analysis, a few tens of bytes per row.
 */
@Injectable()
export class WholeFileImportService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly clock: ClockService,
    private readonly lettrage: LettrageService,
    private readonly states: CaseStateService,
    private readonly reports: ImportReportService,
  ) {}

  // ------------------------------------------------------------------------------------------------ preview

  async preview(type: WholeFileType, controlTotal: string | undefined, req: ApiRequest, actor: AuthenticatedUser): Promise<WholePreviewResult> {
    if (type === 'payments' && controlTotal !== undefined) {
      throw validationFailed([{ path: 'controlTotal', message: 'The control total is only expected for the receivables file' }])
    }
    const file = await receiveUpload(req, MAX_FILE_BYTES)
    const res = req.res!
    let gone = res.destroyed
    const onClose = () => {
      if (!res.writableFinished) gone = true
    }
    res.once('close', onClose)
    const alive = () => {
      if (gone) throw new ImportAborted()
    }
    let previewId: string | undefined
    try {
      let controlCents: number | null = null
      if (type === 'receivables') controlCents = this.readControlTotal(controlTotal)
      await this.assertNotImported(type, file.hash)
      const kind = sniff(file)
      const workbook = kind === 'xlsx' ? await inspectXlsx(file.path, file.size) : undefined
      alive()
      const columns = columnsOf(type)
      const header = await this.readHeader(columns, file.path, kind, workbook)
      const dataRows = await this.countRows(file.path, kind, workbook, alive)
      alive()
      await this.purgeExpired()
      previewId = await this.createPreview(type, actor, file)
      const outcome = await this.analyse(type, previewId, file.path, kind, workbook, header, controlCents, alive)
      return await this.complete(type, previewId, file.fileName, dataRows, outcome, controlCents)
    } catch (error) {
      if (previewId) await this.db.execute(sql`delete from base.import_previews where id = ${previewId}::uuid`).catch(() => undefined)
      throw error
    } finally {
      res.off('close', onClose)
      await rm(file.path, { force: true }).catch(() => undefined)
    }
  }

  /** `rule-recouvrement-receivables-control-total`: required, `^-?[0-9 ]{1,15}([.,][0-9]{1,2})?$`, in cents. */
  private readControlTotal(text: string | undefined): number {
    if (text === undefined || text.trim() === '') {
      throw new ApiError(400, 'imports.control_total_required', 'The control total (query parameter controlTotal) is required for the receivables file')
    }
    const cents = parseControlTotal(text)
    if (cents === null) {
      throw new ApiError(400, 'imports.control_total_invalid', `The control total must match ${CONTROL_TOTAL_PATTERN}`)
    }
    return cents
  }

  /** Copy of `ImportsService.assertNotImported`, with the feature of the type. */
  private async assertNotImported(type: WholeFileType, hash: string): Promise<void> {
    const found = await this.db.execute(sql`
      select 1 from base.import_previews where feature = ${FEATURE_OF[type]} and file_hash = ${hash} and status = 'confirmed' limit 1
    `)
    if (found.rows.length > 0) throw alreadyImported()
  }

  /** Copy of `ImportsService.readHeader`. */
  private async readHeader(columns: ImportColumn[], path: string, kind: Kind, workbook: WorkbookInfo | undefined): Promise<(number | undefined)[]> {
    const rows = readRows(path, kind, workbook, { maxRows: MAX_ROWS + READER_ROW_MARGIN, numbers: true })
    let first: RawRow | undefined
    try {
      const next = await rows.next()
      first = next.done ? undefined : next.value
    } finally {
      await rows.return(undefined)
    }
    const required = columns.filter((c) => c.required).map((c) => c.name)
    if (!first || first.rowNumber !== 1 || isBlankRow(first)) throw missingColumns(required)
    const names = first.cells.map((cell) => cell?.toLowerCase())
    const indexes = columns.map((c) => {
      const at = names.indexOf(c.name.toLowerCase())
      return at >= 0 ? at : undefined
    })
    const missing = columns.filter((c, i) => c.required && indexes[i] === undefined)
    if (missing.length > 0) throw missingColumns(missing.map((c) => c.name))
    return indexes
  }

  /** Copy of `ImportsService.countRows`. */
  private async countRows(path: string, kind: Kind, workbook: WorkbookInfo | undefined, alive: () => void): Promise<number> {
    const rows = readRows(path, kind, workbook, { maxRows: MAX_ROWS + READER_ROW_MARGIN, numbers: false })
    let count = 0
    let header = true
    try {
      for await (const row of rows) {
        if (header) {
          header = false
          continue
        }
        if (isBlankRow(row)) continue
        count += 1
        if (count > MAX_ROWS) throw tooManyRows()
        if (count % BATCH_SIZE === 0) alive()
      }
    } finally {
      await rows.return(undefined)
    }
    if (count === 0) throw emptyFile()
    return count
  }

  /** Copy of `ImportsService.purgeExpired`. */
  private async purgeExpired(): Promise<void> {
    await this.db.execute(sql`
      delete from base.import_previews where id in (
        select id from base.import_previews where status <> 'confirmed' and expires_at < now() order by expires_at limit ${PURGE_PER_CALL}
      )
    `)
  }

  private async createPreview(type: WholeFileType, actor: AuthenticatedUser, file: ReceivedFile): Promise<string> {
    const [created] = (
      await this.db.execute(sql`
        insert into base.import_previews (feature, actor_id, file_name, file_hash, status, expires_at)
        values (${FEATURE_OF[type]}, ${actor.id}::uuid, ${file.fileName}, ${file.hash}, 'analyzing', now() + interval '2 hours') returning id
      `)
    ).rows as Row[]
    return String(created.id)
  }

  /** The maximum age of a bank statement in the active policy, or `null` without active policy. */
  async statementMaxAgeDays(exec: Pick<Database, 'execute'> = this.db): Promise<number | null> {
    const [row] = (
      await exec.execute(sql`select (document->'parameters'->'global'->>'statementMaxAgeDays')::int as days from base.policy_versions where status = 'active'`)
    ).rows as Row[]
    return row ? Number(row.days) : null
  }

  private async lastSnapshotExtraction(): Promise<string | null> {
    const [row] = (await this.db.execute(sql`select max(extraction_date)::text as d from base.receivable_snapshots`)).rows as Row[]
    return (row?.d as string | null) ?? null
  }

  // ------------------------------------------------------------------------------------------------ analysis

  private async analyse(
    type: WholeFileType,
    previewId: string,
    path: string,
    kind: Kind,
    workbook: WorkbookInfo | undefined,
    header: (number | undefined)[],
    controlCents: number | null,
    alive: () => void,
  ): Promise<{ fault: FileFault | null; computed: number; extraction: string | null }> {
    const columns = columnsOf(type)
    const today = this.clock.today()
    const maxAge = type === 'payments' ? await this.statementMaxAgeDays() : null
    const lastSnapshot = type === 'receivables' ? await this.lastSnapshotExtraction() : null

    const keys = new Map<string, number>()
    const debtors = new Map<string, { row: number; nature: unknown; siren: unknown; segment: unknown }>()
    let sharedDate: string | null = null
    let computed = 0
    let fault: FileFault | null = null
    let batch: { rowNumber: number; data: Record<string, unknown> }[] = []

    const rows = readRows(path, kind, workbook, { maxRows: MAX_ROWS + READER_ROW_MARGIN, numbers: true })
    try {
      let first = true
      let seen = 0
      for await (const row of rows) {
        if (first) {
          first = false
          continue
        }
        if (isBlankRow(row)) continue
        seen += 1
        if (seen % BATCH_SIZE === 0) alive()

        // rule of each cell, in the order of the columns
        const faults: ColumnFault[] = []
        const values: Record<string, unknown> = {}
        columns.forEach((column, c) => {
          const at = header[c]
          const cell = at === undefined ? null : (row.cells[at] ?? null)
          if (cell !== null && cell.length > MAX_CELL_CHARACTERS) {
            faults.push({ column: column.name, reason: CELL_TOO_LONG })
            return
          }
          const result = column.parse(cell)
          if (result.ok) values[column.name] = result.value
          else faults.push({ column: column.name, reason: result.reason })
        })
        faults.push(...(type === 'receivables' ? receivableCrossFaults(values, today) : paymentCrossFaults(values, today)))

        // rules between rows
        if (type === 'receivables') {
          this.receivableRowFaults(values, row.rowNumber, faults, keys, debtors, sharedDate)
          if (sharedDate === null && typeof values.date_extraction === 'string') sharedDate = values.date_extraction
        } else {
          this.paymentRowFaults(values, row.rowNumber, faults, keys, sharedDate)
          if (sharedDate === null && typeof values.date_releve === 'string') sharedDate = values.date_releve
        }

        if (faults.length > 0) {
          const order = new Map(columns.map((c, i) => [c.name, i]))
          const [worst] = faults.sort((a, b) => (order.get(a.column) ?? 0) - (order.get(b.column) ?? 0))
          fault = { ...worst, rowNumber: row.rowNumber }
          break
        }

        // rules of the file as a whole, known once its first row is valid
        if (seen === 1) {
          if (type === 'receivables' && lastSnapshot !== null && (values.date_extraction as string) < lastSnapshot) {
            fault = {
              rowNumber: HEADER_ROW,
              column: 'date_extraction',
              reason: `La date d'extraction ${values.date_extraction} est antérieure à celle du dernier cliché confirmé (${lastSnapshot}).`,
            }
            break
          }
          if (type === 'payments' && maxAge !== null && daysBetween(values.date_releve as string, today) > maxAge) {
            fault = {
              rowNumber: HEADER_ROW,
              column: 'date_releve',
              reason: `Relevé trop ancien : date du relevé ${values.date_releve}, fraîcheur maximale ${maxAge} jours.`,
            }
            break
          }
        }

        if (type === 'receivables') computed += values.solde as number
        batch.push({ rowNumber: row.rowNumber, data: this.stagedData(type, values) })
        if (batch.length >= BATCH_SIZE) {
          await this.stage(previewId, batch)
          batch = []
        }
      }
    } finally {
      await rows.return(undefined)
    }

    if (fault === null && type === 'receivables' && controlCents !== null && computed !== controlCents) {
      fault = {
        rowNumber: HEADER_ROW,
        column: 'solde',
        reason: `Le total des soldes (${formatCents(computed)}) diffère du total de contrôle saisi (${formatCents(controlCents)}).`,
      }
    }
    if (fault === null && batch.length > 0) await this.stage(previewId, batch)
    if (fault !== null) await this.db.execute(sql`delete from base.import_preview_rows where preview_id = ${previewId}::uuid`)
    return { fault, computed, extraction: type === 'receivables' ? sharedDate : null }
  }

  /** Faults that depend on the other rows (rule-recouvrement-receivables-duplicate-number, -extraction-date, -case-grouping). */
  private receivableRowFaults(
    v: Record<string, unknown>,
    rowNumber: number,
    faults: ColumnFault[],
    keys: Map<string, number>,
    debtors: Map<string, { row: number; nature: unknown; siren: unknown; segment: unknown }>,
    sharedDate: string | null,
  ): void {
    if (typeof v.entite_siren === 'string' && typeof v.numero === 'string') {
      const key = `${v.entite_siren}|${v.numero}`
      const firstRow = keys.get(key)
      if (firstRow !== undefined) faults.push({ column: 'numero', reason: `Numéro déjà présent à la ligne ${firstRow} pour cette entité.` })
      else keys.set(key, rowNumber)
    }
    if (sharedDate !== null && typeof v.date_extraction === 'string' && v.date_extraction !== sharedDate) {
      faults.push({ column: 'date_extraction', reason: `La date d'extraction ${v.date_extraction} diffère de celle des lignes précédentes (${sharedDate}).` })
    }
    if (typeof v.debiteur_id === 'string') {
      const known = debtors.get(v.debiteur_id)
      if (!known) {
        if (faults.length === 0) debtors.set(v.debiteur_id, { row: rowNumber, nature: v.debiteur_nature, siren: v.debiteur_siren ?? null, segment: v.segment })
      } else {
        if (v.debiteur_nature !== undefined && v.debiteur_nature !== known.nature) {
          faults.push({ column: 'debiteur_nature', reason: `La nature diffère de celle de la ligne ${known.row} pour ce débiteur.` })
        }
        if (v.debiteur_siren !== undefined && (v.debiteur_siren ?? null) !== known.siren) {
          faults.push({ column: 'debiteur_siren', reason: `Le SIREN du débiteur diffère de celui de la ligne ${known.row} pour ce débiteur.` })
        }
        if (v.segment !== undefined && v.segment !== known.segment) {
          faults.push({ column: 'segment', reason: `Le segment diffère de celui de la ligne ${known.row} pour ce débiteur.` })
        }
      }
    }
  }

  /** rule-recouvrement-payments-columns: a reference repeated in the file, a statement date that changes. */
  private paymentRowFaults(
    v: Record<string, unknown>,
    rowNumber: number,
    faults: ColumnFault[],
    keys: Map<string, number>,
    sharedDate: string | null,
  ): void {
    if (typeof v.reference === 'string') {
      const firstRow = keys.get(v.reference)
      if (firstRow !== undefined) faults.push({ column: 'reference', reason: `Référence ${quoted(v.reference)} déjà présente à la ligne ${firstRow}.` })
      else keys.set(v.reference, rowNumber)
    }
    if (sharedDate !== null && typeof v.date_releve === 'string' && v.date_releve !== sharedDate) {
      faults.push({ column: 'date_releve', reason: `La date du relevé ${v.date_releve} diffère de celle des lignes précédentes (${sharedDate}).` })
    }
  }

  private stagedData(type: WholeFileType, v: Record<string, unknown>): Record<string, unknown> {
    if (type === 'payments') {
      return { reference: v.reference, amountCents: v.montant, paymentDate: v.date_paiement, statementDate: v.date_releve }
    }
    return {
      kind: v.type_piece,
      number: v.numero,
      creditorSiren: v.entite_siren,
      debtorId: v.debiteur_id,
      nature: v.debiteur_nature,
      debtorSiren: v.debiteur_siren ?? null,
      payer: v.payeur ?? null,
      amountCents: v.montant,
      balanceCents: v.solde,
      invoiceDate: v.date_facture,
      dueDate: v.echeance,
      segment: v.segment,
      channels: v.canaux,
      extractionDate: v.date_extraction,
      outputReference: v.reference_sortie ?? null,
    }
  }

  private async stage(previewId: string, batch: { rowNumber: number; data: Record<string, unknown> }[]): Promise<void> {
    await this.db.execute(sql`
      insert into base.import_preview_rows (preview_id, row_number, data)
      values ${sql.join(batch.map((b) => sql`(${previewId}::uuid, ${b.rowNumber}, ${JSON.stringify(b.data)}::jsonb)`), sql`, `)}
    `)
  }

  private async complete(
    type: WholeFileType,
    previewId: string,
    fileName: string,
    dataRows: number,
    outcome: { fault: FileFault | null; computed: number; extraction: string | null },
    controlCents: number | null,
  ): Promise<WholePreviewResult> {
    const accepted = outcome.fault === null
    if (outcome.fault) {
      await this.db.execute(sql`
        insert into base.import_preview_errors (preview_id, seq, row_number, "column", reason)
        values (${previewId}::uuid, 0, ${outcome.fault.rowNumber}, ${outcome.fault.column}, ${fitReason(outcome.fault.reason)})
      `)
    }
    const [done] = (
      await this.db.execute(sql`
        update base.import_previews
        set status = 'previewed', total_rows = ${dataRows}, valid_rows = ${accepted ? dataRows : 0}, error_rows = ${accepted ? 0 : 1},
          error_entries = ${accepted ? 0 : 1}, expires_at = now() + interval '2 hours'
        where id = ${previewId}::uuid returning expires_at
      `)
    ).rows as Row[]
    const computed = type === 'receivables' && accepted ? outcome.computed : null
    await this.db.execute(sql`
      insert into base.recovery_import_details (import_id, accepted, extraction_date, control_total_cents, computed_total_cents)
      values (${previewId}::uuid, ${accepted}, ${outcome.extraction}::date, ${controlCents}, ${computed})
      on conflict (import_id) do update set accepted = excluded.accepted, extraction_date = excluded.extraction_date,
        control_total_cents = excluded.control_total_cents, computed_total_cents = excluded.computed_total_cents
    `)
    await this.reports.compute(this.db, type, previewId)
    // the total of the balances is known when the whole file has been read: valid, or refused for the control total only
    const read = accepted || (outcome.fault?.rowNumber === HEADER_ROW && outcome.fault.column === 'solde')
    return {
      importId: previewId,
      fileName,
      totalRows: dataRows,
      validRows: accepted ? dataRows : 0,
      errorRows: accepted ? 0 : 1,
      expiresAt: isoInstant(done.expires_at),
      accepted,
      computedTotalCents: type === 'receivables' && read ? outcome.computed : null,
      controlTotalCents: controlCents,
    }
  }

  // ------------------------------------------------------------------------------------------------ confirmation

  /**
   * rule-recouvrement-import-green-light, -receivables-snapshot: runs in the transaction of the traced route. The
   * preview is locked, the memory of the confirmed files decides between concurrent confirmations, then the file is
   * applied with set-based statements, the lettrage is replayed and every case gets its state recomputed.
   */
  async confirm(type: WholeFileType, importId: string, actor: AuthenticatedUser): Promise<WholeConfirmResult> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('recovery-portfolio'))`)
      const [preview] = (
        await tx.execute(sql`
          select id, file_name, file_hash, status, total_rows, (expires_at > now()) as live
          from base.import_previews
          where id = ${importId.toLowerCase()}::uuid and actor_id = ${actor.id}::uuid and feature = ${FEATURE_OF[type]} for update
        `)
      ).rows as Row[]
      if (!preview) throw previewNotFound()
      if (preview.status === 'confirmed') throw alreadyImported()
      if (preview.status !== 'previewed' || !preview.live) throw previewNotFound()
      const same = await tx.execute(sql`
        select 1 from base.import_previews where feature = ${FEATURE_OF[type]} and file_hash = ${String(preview.file_hash)} and status = 'confirmed' limit 1
      `)
      if (same.rows.length > 0) throw alreadyImported()

      const [details] = (
        await tx.execute(sql`select accepted, extraction_date::text as extraction_date, computed_total_cents, control_total_cents from base.recovery_import_details where import_id = ${String(preview.id)}::uuid`)
      ).rows as Row[]
      if (!details || !details.accepted) throw new ApiError(409, 'imports.file_refused', 'The preview counts an error: the file is refused as a whole')
      if (type === 'receivables') {
        const [snapshot] = (await tx.execute(sql`select max(extraction_date)::text as d from base.receivable_snapshots`)).rows as Row[]
        if (snapshot?.d && String(details.extraction_date) < String(snapshot.d)) {
          throw new ApiError(409, 'imports.stale_extraction', 'A more recent snapshot has been confirmed since the preview')
        }
      }
      try {
        await tx.execute(sql`update base.import_previews set status = 'confirmed', confirmed_at = now() where id = ${String(preview.id)}::uuid`)
      } catch (error) {
        if (isUniqueViolation(error)) throw alreadyImported()
        throw error
      }

      const id = String(preview.id)
      const result = type === 'receivables' ? await this.applyReceivables(tx, id, String(details.extraction_date), Number(details.computed_total_cents), Number(details.control_total_cents)) : await this.applyPayments(tx, id)

      await tx.execute(sql`delete from base.import_preview_rows where preview_id = ${id}::uuid`)
      await tx.execute(sql`delete from base.import_preview_errors where preview_id = ${id}::uuid`)
      await tx.execute(sql`update base.import_previews set created_count = ${result.createdCount}, skipped_count = ${result.skippedCount} where id = ${id}::uuid`)
      await tx.execute(sql`update base.recovery_import_details set effects = ${JSON.stringify(result.effects)}::jsonb where import_id = ${id}::uuid`)
      return { importId: id, fileName: String(preview.file_name), totalRows: Number(preview.total_rows), ...result }
    })
  }

  private async applyReceivables(
    tx: ImportExecutor,
    importId: string,
    extraction: string,
    total: number,
    control: number,
  ): Promise<{ createdCount: number; skippedCount: number; effects: Effect[] }> {
    const staged = sql`
      select data->>'debtorId' as debtor_id, data->>'nature' as nature, data->>'debtorSiren' as debtor_siren, data->>'segment' as segment,
        data->>'kind' as kind, data->>'number' as number, data->>'creditorSiren' as creditor_siren, data->>'payer' as payer,
        (data->>'amountCents')::bigint as amount, (data->>'balanceCents')::bigint as balance,
        (data->>'invoiceDate')::date as invoice_date, (data->>'dueDate')::date as due_date,
        array(select jsonb_array_elements_text(data->'channels')) as channels, data->>'outputReference' as output_reference
      from base.import_preview_rows where preview_id = ${importId}::uuid and data is not null`

    // cases: one per customer id; nature, SIREN and segment follow the snapshot (rule-recouvrement-debtor-attribute-change)
    const cases = (
      await tx.execute(sql`
        with s as (${staged}),
        d as (
          select debtor_id, min(nature) as nature, min(debtor_siren) as debtor_siren, min(segment) as segment,
            coalesce(sum(balance) filter (where kind = 'invoice'), 0) as due
          from s group by debtor_id
        )
        insert into base.cases (debtor_id, nature, debtor_siren, segment, first_seen_on, first_seen_due_cents, first_policy_version_id)
        select d.debtor_id, d.nature, d.debtor_siren, d.segment, ${extraction}::date, d.due, (select id from base.policy_versions where status = 'active')
        from d
        on conflict (debtor_id) do update set nature = excluded.nature, debtor_siren = excluded.debtor_siren, segment = excluded.segment, updated_at = now()
        returning id, (xmax = 0) as created
      `)
    ).rows as { id: string; created: boolean }[]
    const createdCases = cases.filter((c) => c.created).map((c) => c.id)

    const upserted = (
      await tx.execute(sql`
        with s as (${staged})
        insert into base.invoices (case_id, kind, number, creditor_siren, amount_cents, imported_balance_cents, balance_cents, payer, invoice_date, due_date,
          channels, closed_at, first_seen_on, first_seen_balance_cents, last_extraction_date, output_reference)
        select c.id, s.kind, s.number, s.creditor_siren, s.amount, s.balance, s.balance, s.payer, s.invoice_date, s.due_date,
          s.channels, null, ${extraction}::date, s.balance, ${extraction}::date, s.output_reference
        from s join base.cases c on c.debtor_id = s.debtor_id
        on conflict (creditor_siren, number) do update set case_id = excluded.case_id, kind = excluded.kind, amount_cents = excluded.amount_cents,
          imported_balance_cents = excluded.imported_balance_cents, balance_cents = excluded.balance_cents, payer = excluded.payer,
          invoice_date = excluded.invoice_date, due_date = excluded.due_date, channels = excluded.channels, closed_at = null,
          last_extraction_date = excluded.last_extraction_date, output_reference = excluded.output_reference
        returning (xmax = 0) as created
      `)
    ).rows as { created: boolean }[]
    const invoicesCreated = upserted.filter((u) => u.created).length

    // the pieces absent from the snapshot are closed (balance 0)
    const closed = (
      await tx.execute(sql`
        with s as (${staged})
        update base.invoices i set imported_balance_cents = 0, balance_cents = 0, closed_at = now()
        where i.closed_at is null and not exists (select 1 from s where s.creditor_siren = i.creditor_siren and s.number = i.number)
        returning i.id
      `)
    ).rows.length

    await tx.execute(sql`
      insert into base.receivable_snapshots (import_id, extraction_date, control_total_cents, total_cents)
      values (${importId}::uuid, ${extraction}::date, ${control}, ${total})
    `)
    await this.states.recordCreation(tx, createdCases, { actor: 'import', reference: importId })

    const lettrage = await this.lettrage.rebuild(tx)
    const changes = await this.recomputeAll(tx, importId)
    const settled = changes.filter((c) => c.to === 'settled').length
    const reopened = changes.filter((c) => c.from === 'settled' && c.to !== 'settled').length

    return {
      createdCount: invoicesCreated,
      skippedCount: 0,
      effects: [
        { label: 'Dossiers créés', count: createdCases.length },
        { label: 'Dossiers soldés', count: settled },
        { label: 'Dossiers rouverts', count: reopened },
        { label: 'Factures créées', count: invoicesCreated },
        { label: 'Factures mises à jour', count: upserted.length - invoicesCreated },
        { label: 'Factures clôturées', count: closed },
        { label: 'Paiements affectés', count: lettrage.assigned },
        { label: 'Paiements non affectés', count: lettrage.unassigned },
        { label: 'Éléments de file ouverts', count: lettrage.queueOpened },
        { label: 'Éléments de file clos sans décision', count: lettrage.queueClosed },
      ],
    }
  }

  private async applyPayments(tx: ImportExecutor, importId: string): Promise<{ createdCount: number; skippedCount: number; effects: Effect[] }> {
    const staged = sql`
      select data->>'reference' as reference, (data->>'amountCents')::bigint as amount, (data->>'paymentDate')::date as payment_date,
        (data->>'statementDate')::date as statement_date
      from base.import_preview_rows where preview_id = ${importId}::uuid and data is not null`
    const inserted = (
      await tx.execute(sql`
        with s as (${staged})
        insert into base.payments (reference, amount_cents, payment_date, statement_date, import_id, status)
        select reference, amount, payment_date, statement_date, ${importId}::uuid, 'already_in_balances' from s
        on conflict (reference) do nothing returning id
      `)
    ).rows.length
    const [count] = (await tx.execute(sql`select count(*)::int as n from base.import_preview_rows where preview_id = ${importId}::uuid and data is not null`)).rows as Row[]
    const total = Number(count?.n ?? 0)
    await tx.execute(sql`
      insert into base.statements (statement_date, import_id)
      select (data->>'statementDate')::date, ${importId}::uuid from base.import_preview_rows where preview_id = ${importId}::uuid and data is not null limit 1
    `)
    const lettrage = await this.lettrage.rebuild(tx)
    await this.recomputeAll(tx, importId)
    return {
      createdCount: inserted,
      skippedCount: total - inserted,
      effects: [
        { label: 'Paiements enregistrés', count: inserted },
        { label: 'Paiements déjà connus, ignorés', count: total - inserted },
        { label: 'Paiements à affecter (postérieurs au cliché)', count: lettrage.applied },
        { label: 'Paiements affectés', count: lettrage.assigned },
        { label: 'Paiements non affectés', count: lettrage.unassigned },
        { label: 'Éléments de file ouverts', count: lettrage.queueOpened },
        { label: 'Éléments de file clos sans décision', count: lettrage.queueClosed },
      ],
    }
  }

  /** Every case that can still move gets its state recomputed from the facts (rule-recouvrement-evaluation-points). */
  private async recomputeAll(tx: ImportExecutor, importId: string) {
    const ids = ((await tx.execute(sql`select id from base.cases where state <> 'transferred' order by id`)).rows as { id: string }[]).map((r) => r.id)
    const changes: StateChange[] = []
    for (let i = 0; i < ids.length; i += 2000) {
      changes.push(...(await this.states.recomputeMany(tx, ids.slice(i, i + 2000), { actor: 'import', reference: importId })))
    }
    return changes
  }
}

const SIGNATURES: Buffer[] = [
  Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  Buffer.from([0x50, 0x4b, 0x05, 0x06]),
  Buffer.from([0x1f, 0x8b]),
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0]),
  Buffer.from('%PDF'),
]

/** Copy of `sniff` of `ImportsService`: the extension must agree with the content. */
function sniff(file: ReceivedFile): Kind {
  if (file.size === 0) throw invalidFileType('The file is empty')
  if (file.extension === '.csv') {
    if (file.textProblem || SIGNATURES.some((signature) => file.head.subarray(0, signature.length).equals(signature))) {
      throw invalidFileType('The content of the file is not UTF-8 text')
    }
    return 'csv'
  }
  if (file.extension === '.xlsx') return 'xlsx'
  throw invalidFileType('Only .xlsx and .csv files are accepted')
}
