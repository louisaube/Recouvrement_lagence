import { Injectable, OnModuleInit } from '@nestjs/common'
import { and, asc, eq, gt, inArray, isNotNull, sql } from 'drizzle-orm'
import { rm } from 'node:fs/promises'
import { Database, InjectDb } from '../../platform/database/database.module'
import { isUniqueViolation, scopeAccessDenied, scopeReadOnly } from '../../platform/http/errors'
import type { ApiRequest, AuthenticatedUser } from '../../platform/http/request-context'
import { ScopeAccessService } from '../../platform/scopes/scope-access'
import {
  alreadyImported,
  emptyFile,
  ImportAborted,
  invalidFileType,
  missingColumns,
  previewNotFound,
  tooManyRows,
} from './imports.errors'
import type {
  ImportConfirmDto,
  ImportErrorsListDto,
  ImportErrorsQuery,
  ImportPreviewDto,
  ImportSpecificationDto,
} from './imports.schemas'
import { CELL_TOO_LONG, fitReason } from './imports.text'
import type { ColumnFault, ImportDefinition, ParsedRow } from './imports.types'
import { importPreviewErrors, importPreviewRows, importPreviews } from './imports.tables'
import { isBlankRow, MAX_CELL_CHARACTERS, RawRow, readRows } from './readers'
import { purgeTempDirectory, receiveUpload, type ReceivedFile } from './receive'
import { inspectXlsx, type WorkbookInfo } from './xlsx-inspect'

/** `rule-foundation-import-limits`, announced by the specification route. */
export const MAX_FILE_BYTES = 104_857_600
export const MAX_ROWS = 1_000_000
export const ACCEPTED_EXTENSIONS = ['.xlsx', '.csv']

/** Rows analysed and staged per round trip (`rule-foundation-import-large-files`). */
const BATCH_SIZE = 1000
/** Expired previews removed per new preview (`rule-foundation-import-preview-expires`). */
const PURGE_PER_CALL = 20
/** The sheet reader counts blank rows that hold cells too: a margin over the limit of non-blank rows. */
const READER_ROW_MARGIN = 100_000
/** Rows per statement: well below the 65,535 parameters of PostgreSQL. */
const ERROR_CHUNK = 5000

interface Counters {
  seq: number
  total: number
  valid: number
  errorRows: number
}

type Kind = 'csv' | 'xlsx'

/**
 * The reusable import mechanism (`rule-foundation-import-declared-columns`): a feature gives an `ImportDefinition`,
 * its four routes call `specification`, `preview`, `errors` and `confirm`. Everything else is here: reception as a
 * stream, limits, nature of the file, trapped files, reading as a stream, preview, errors, duplicates, memory of the
 * imported files, atomic confirmation (the trace is written by the platform around the confirmation route).
 */
@Injectable()
export class ImportsService implements OnModuleInit {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly scopeAccess: ScopeAccessService,
  ) {}

  async onModuleInit(): Promise<void> {
    await purgeTempDirectory()
  }

  /** `rule-foundation-import-limits`, `rule-foundation-import-users-columns`. */
  specification(definition: ImportDefinition): ImportSpecificationDto {
    return {
      columns: definition.columns.map(({ name, required, description }) => ({ name, required, description })),
      maxFileSizeBytes: MAX_FILE_BYTES,
      maxRows: MAX_ROWS,
      acceptedExtensions: ACCEPTED_EXTENSIONS,
    }
  }

  /**
   * `rule-foundation-import-two-steps`: analyses the file and writes nothing but the temporary state of the preview.
   * Order of the checks: authorisation (the route) → scopes → shape of the multipart → size → already imported →
   * nature of the content → archive limits and external links → header → rows.
   */
  async preview(definition: ImportDefinition, req: ApiRequest): Promise<ImportPreviewDto> {
    const actor = req.user!
    if (definition.scoped) await this.assertScopesWritable()
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
      await this.assertNotImported(definition.feature, file.hash)
      const kind = sniff(file)
      const workbook = kind === 'xlsx' ? await inspectXlsx(file.path, file.size) : undefined
      alive()
      const header = await this.readHeader(definition, file.path, kind, workbook)
      await this.countRows(file.path, kind, workbook, alive)
      alive()
      await this.purgeExpired()
      previewId = await this.createPreview(definition, actor, file)
      const counters = await this.analyse(definition, previewId, file.path, kind, workbook, header, alive)
      return await this.complete(previewId, file.fileName, counters)
    } catch (error) {
      // an interrupted, refused or failed analysis keeps nothing
      if (previewId) await this.discard(previewId)
      throw error
    } finally {
      res.off('close', onClose)
      await rm(file.path, { force: true }).catch(() => undefined)
    }
  }

  /** `rule-foundation-import-errors-paginated`, `rule-foundation-import-preview-owner`. */
  async errors(
    definition: ImportDefinition,
    importId: string,
    query: ImportErrorsQuery,
    actor: AuthenticatedUser,
  ): Promise<ImportErrorsListDto> {
    const [preview] = await this.db
      .select({ id: importPreviews.id, total: importPreviews.errorEntries })
      .from(importPreviews)
      .where(
        and(
          eq(importPreviews.id, importId.toLowerCase()),
          eq(importPreviews.actorId, actor.id),
          eq(importPreviews.feature, definition.feature),
          eq(importPreviews.status, 'previewed'),
          sql`${importPreviews.expiresAt} > now()`,
        ),
      )
    if (!preview) throw previewNotFound()
    const rows = await this.db
      .select({ row: importPreviewErrors.rowNumber, column: importPreviewErrors.column, reason: importPreviewErrors.reason })
      .from(importPreviewErrors)
      .where(eq(importPreviewErrors.previewId, preview.id))
      .orderBy(asc(importPreviewErrors.seq))
      .limit(query.size ?? 10)
      .offset(query.from ?? 0)
    return { errors: rows, total: preview.total }
  }

  /**
   * `rule-foundation-import-confirm-valid-only`, `-confirm-revalidates`, `-confirm-atomic`, `-no-double`: writes the
   * valid rows of the preview. One transaction (the one of the traced route when there is one): the memory of the
   * file, the rows, the clean-up of the staging and the audit entry are committed together or not at all.
   */
  async confirm(definition: ImportDefinition, importId: string, actor: AuthenticatedUser): Promise<ImportConfirmDto> {
    if (definition.scoped) await this.assertScopesWritable()
    return this.db.transaction(async (tx) => {
      const [preview] = await tx
        .select({
          id: importPreviews.id,
          fileName: importPreviews.fileName,
          fileHash: importPreviews.fileHash,
          status: importPreviews.status,
          live: sql<boolean>`${importPreviews.expiresAt} > now()`,
        })
        .from(importPreviews)
        .where(
          and(
            eq(importPreviews.id, importId.toLowerCase()),
            eq(importPreviews.actorId, actor.id),
            eq(importPreviews.feature, definition.feature),
          ),
        )
        .for('update')
      if (!preview) throw previewNotFound()
      if (preview.status === 'confirmed') throw alreadyImported()
      if (preview.status !== 'previewed' || !preview.live) throw previewNotFound()

      const [other] = await tx
        .select({ id: importPreviews.id })
        .from(importPreviews)
        .where(
          and(
            eq(importPreviews.feature, definition.feature),
            eq(importPreviews.fileHash, preview.fileHash),
            eq(importPreviews.status, 'confirmed'),
          ),
        )
        .limit(1)
      if (other) throw alreadyImported()
      try {
        // the unique index on (feature, file hash) of the confirmed previews decides between concurrent confirmations
        await tx
          .update(importPreviews)
          .set({ status: 'confirmed', confirmedAt: sql`now()` })
          .where(eq(importPreviews.id, preview.id))
      } catch (error) {
        if (isUniqueViolation(error)) throw alreadyImported()
        throw error
      }

      let created = 0
      let skipped = 0
      let after = 0
      for (;;) {
        const rows = await tx
          .select({ rowNumber: importPreviewRows.rowNumber, data: importPreviewRows.data })
          .from(importPreviewRows)
          .where(
            and(
              eq(importPreviewRows.previewId, preview.id),
              isNotNull(importPreviewRows.data),
              gt(importPreviewRows.rowNumber, after),
            ),
          )
          .orderBy(asc(importPreviewRows.rowNumber))
          .limit(BATCH_SIZE)
        if (rows.length === 0) break
        after = rows[rows.length - 1].rowNumber
        const saved = await definition.saveBatch(
          rows.map((row) => ({ rowNumber: row.rowNumber, data: row.data as Record<string, unknown> })),
          tx,
        )
        created += saved.created
        skipped += saved.skipped
      }

      await tx.delete(importPreviewRows).where(eq(importPreviewRows.previewId, preview.id))
      await tx.delete(importPreviewErrors).where(eq(importPreviewErrors.previewId, preview.id))
      await tx
        .update(importPreviews)
        .set({ createdCount: created, skippedCount: skipped })
        .where(eq(importPreviews.id, preview.id))
      return { importId: preview.id, createdCount: created, skippedCount: skipped, fileName: preview.fileName }
    })
  }

  // ------------------------------------------------------------------------------------------------ preview steps

  /** `rule-foundation-import-respects-scopes`: before any analysis, a caller who cannot write gets the usual 403. */
  private async assertScopesWritable(): Promise<void> {
    const access = await this.scopeAccess.current()
    if (access.write === 'read_only') throw scopeReadOnly()
    if (access.write === 'none') throw scopeAccessDenied()
  }

  /** `rule-foundation-import-no-double`: the fingerprint is known from the last byte received. */
  private async assertNotImported(feature: string, hash: string): Promise<void> {
    const [found] = await this.db
      .select({ id: importPreviews.id })
      .from(importPreviews)
      .where(and(eq(importPreviews.feature, feature), eq(importPreviews.fileHash, hash), eq(importPreviews.status, 'confirmed')))
      .limit(1)
    if (found) throw alreadyImported()
  }

  /** `rule-foundation-import-header-matching`: row 1 of the first sheet; column index of each declared column. */
  private async readHeader(
    definition: ImportDefinition,
    path: string,
    kind: Kind,
    workbook: WorkbookInfo | undefined,
  ): Promise<(number | undefined)[]> {
    const rows = readRows(path, kind, workbook, { maxRows: MAX_ROWS + READER_ROW_MARGIN, numbers: true })
    let first: RawRow | undefined
    try {
      const next = await rows.next()
      first = next.done ? undefined : next.value
    } finally {
      await rows.return(undefined)
    }
    const required = definition.columns.filter((column) => column.required).map((column) => column.name)
    if (!first || first.rowNumber !== 1 || isBlankRow(first)) throw missingColumns(required)
    const names = first.cells.map((cell) => cell?.toLowerCase())
    const indexes = definition.columns.map((column) => {
      const at = names.indexOf(column.name.toLowerCase())
      return at >= 0 ? at : undefined
    })
    const missing = definition.columns.filter((column, i) => column.required && indexes[i] === undefined)
    if (missing.length > 0) throw missingColumns(missing.map((column) => column.name))
    return indexes
  }

  /** `rule-foundation-import-limits`: 1,000,000 data rows at most, at least one. Nothing is staged yet. */
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
        // a client that left stops the counting pass too (`rule-foundation-import-cancel-analysis`)
        if (count % BATCH_SIZE === 0) alive()
      }
    } finally {
      await rows.return(undefined)
    }
    if (count === 0) throw emptyFile()
    return count
  }

  /** Expired previews that are not confirmed disappear with their rows and errors, a score at a time. */
  private async purgeExpired(): Promise<void> {
    await this.db.delete(importPreviews).where(
      inArray(
        importPreviews.id,
        this.db
          .select({ id: importPreviews.id })
          .from(importPreviews)
          .where(and(sql`${importPreviews.status} <> 'confirmed'`, sql`${importPreviews.expiresAt} < now()`))
          .orderBy(asc(importPreviews.expiresAt))
          .limit(PURGE_PER_CALL),
      ),
    )
  }

  private async createPreview(definition: ImportDefinition, actor: AuthenticatedUser, file: ReceivedFile): Promise<string> {
    const [created] = await this.db
      .insert(importPreviews)
      .values({
        feature: definition.feature,
        actorId: actor.id,
        fileName: file.fileName,
        fileHash: file.hash,
        status: 'analyzing',
        expiresAt: sql`now() + interval '2 hours'`,
      })
      .returning({ id: importPreviews.id })
    return created.id
  }

  private async discard(previewId: string): Promise<void> {
    await this.db.delete(importPreviews).where(eq(importPreviews.id, previewId)).catch(() => undefined)
  }

  private async complete(previewId: string, fileName: string, counters: Counters): Promise<ImportPreviewDto> {
    const [done] = await this.db
      .update(importPreviews)
      .set({
        status: 'previewed',
        totalRows: counters.total,
        validRows: counters.valid,
        errorRows: counters.errorRows,
        errorEntries: counters.seq,
        expiresAt: sql`now() + interval '2 hours'`,
      })
      .where(eq(importPreviews.id, previewId))
      .returning({ expiresAt: importPreviews.expiresAt })
    return {
      importId: previewId,
      fileName,
      totalRows: counters.total,
      validRows: counters.valid,
      errorRows: counters.errorRows,
      expiresAt: done.expiresAt.toISOString(),
    }
  }

  /**
   * Reads the rows as a stream and processes them by batches; the result goes to the database, not to memory
   * (`rule-foundation-import-large-files`). No transaction spans the analysis: it only reads the business tables.
   */
  private async analyse(
    definition: ImportDefinition,
    previewId: string,
    path: string,
    kind: Kind,
    workbook: WorkbookInfo | undefined,
    header: (number | undefined)[],
    alive: () => void,
  ): Promise<Counters> {
    const counters: Counters = { seq: 0, total: 0, valid: 0, errorRows: 0 }
    const rows = readRows(path, kind, workbook, { maxRows: MAX_ROWS + READER_ROW_MARGIN, numbers: true })
    let batch: RawRow[] = []
    let first = true
    try {
      for await (const row of rows) {
        if (first) {
          first = false
          continue
        }
        if (isBlankRow(row)) continue
        batch.push(row)
        if (batch.length >= BATCH_SIZE) {
          alive()
          await this.processBatch(definition, previewId, header, batch, counters)
          batch = []
        }
      }
      alive()
      if (batch.length > 0) await this.processBatch(definition, previewId, header, batch, counters)
    } finally {
      await rows.return(undefined)
    }
    return counters
  }

  private async processBatch(
    definition: ImportDefinition,
    previewId: string,
    header: (number | undefined)[],
    batch: RawRow[],
    counters: Counters,
  ): Promise<void> {
    const faults: ColumnFault[][] = batch.map(() => [])
    const parsed: ParsedRow[] = batch.map((row) => ({ rowNumber: row.rowNumber, values: {} }))

    // rule of each cell
    batch.forEach((row, r) => {
      definition.columns.forEach((column, c) => {
        const at = header[c]
        const cell = at === undefined ? null : (row.cells[at] ?? null)
        if (cell !== null && cell.length > MAX_CELL_CHARACTERS) {
          faults[r].push({ column: column.name, reason: CELL_TOO_LONG })
          return
        }
        const result = column.parse(cell)
        if (result.ok) parsed[r].values[column.name] = result.value
        else faults[r].push({ column: column.name, reason: result.reason })
      })
    })

    // grouped checks against the database
    const extras: (Record<string, unknown> | undefined)[] = batch.map(() => undefined)
    if (definition.checkBatch) {
      const checks = await definition.checkBatch(parsed, this.db)
      checks.forEach((check, r) => {
        faults[r].push(...check.faults)
        extras[r] = check.extra
      })
    }

    // staging: rows that carry a key (even invalid ones, they keep the key) and valid rows
    const keyColumn = definition.uniqueKey?.column
    const staged: { previewId: string; rowNumber: number; dedupeKey: string | null; data: Record<string, unknown> | null }[] = []
    batch.forEach((row, r) => {
      const key = keyColumn ? parsed[r].values[keyColumn] : undefined
      const dedupeKey = typeof key === 'string' && key !== '' ? key : null
      const valid = faults[r].length === 0
      if (dedupeKey === null && !valid) return
      staged.push({
        previewId,
        rowNumber: row.rowNumber,
        dedupeKey,
        data: valid ? { ...parsed[r].values, ...extras[r] } : null,
      })
    })
    if (staged.length > 0) {
      const inserted = await this.db
        .insert(importPreviewRows)
        .values(staged)
        .onConflictDoNothing()
        .returning({ rowNumber: importPreviewRows.rowNumber })
      // `rule-foundation-import-in-file-duplicates`: the rows that lost the key are duplicates of the first holder
      const kept = new Set(inserted.map((row) => row.rowNumber))
      const lost = staged.filter((s) => s.dedupeKey !== null && !kept.has(s.rowNumber))
      if (lost.length > 0 && definition.uniqueKey) {
        const owners = await this.db
          .select({ key: importPreviewRows.dedupeKey, rowNumber: importPreviewRows.rowNumber })
          .from(importPreviewRows)
          .where(
            and(
              eq(importPreviewRows.previewId, previewId),
              inArray(importPreviewRows.dedupeKey, [...new Set(lost.map((s) => s.dedupeKey as string))]),
            ),
          )
        const firstRow = new Map(owners.map((owner) => [owner.key, owner.rowNumber]))
        const position = new Map(batch.map((row, r) => [row.rowNumber, r]))
        for (const duplicate of lost) {
          faults[position.get(duplicate.rowNumber)!].push({
            column: definition.uniqueKey.column,
            reason: definition.uniqueKey.duplicateReason(firstRow.get(duplicate.dedupeKey) ?? 0),
          })
        }
      }
    }

    // counts and error entries, by row then in the order of the declared columns
    const order = new Map(definition.columns.map((column, i) => [column.name, i]))
    const entries: { previewId: string; seq: number; rowNumber: number; column: string; reason: string }[] = []
    batch.forEach((row, r) => {
      counters.total += 1
      if (faults[r].length === 0) {
        counters.valid += 1
        return
      }
      counters.errorRows += 1
      // one entry per (row, column): the first fault found for a column is the one reported
      const firstPerColumn = faults[r].filter((fault, i) => faults[r].findIndex((other) => other.column === fault.column) === i)
      const sorted = firstPerColumn.sort((a, b) => (order.get(a.column) ?? 0) - (order.get(b.column) ?? 0))
      for (const fault of sorted) {
        entries.push({ previewId, seq: counters.seq, rowNumber: row.rowNumber, column: fault.column, reason: fitReason(fault.reason) })
        counters.seq += 1
      }
    })
    for (let i = 0; i < entries.length; i += ERROR_CHUNK) {
      await this.db.insert(importPreviewErrors).values(entries.slice(i, i + ERROR_CHUNK))
    }
  }
}

const SIGNATURES: Buffer[] = [
  // ZIP local header and empty archive: a bare "PK" can start an ordinary header (`PKey,email,role`)
  Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  Buffer.from([0x50, 0x4b, 0x05, 0x06]),
  Buffer.from([0x1f, 0x8b]),
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0]),
  Buffer.from('%PDF'),
]

/**
 * `rule-foundation-import-content-sniffing`: the extension must agree with the content; the name and the declared
 * type are not enough. Returns the kind of file, or refuses it.
 */
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
