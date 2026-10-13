/**
 * What a feature declares to get an import (`rule-foundation-import-declared-columns`): its key, its columns and the
 * rule of each cell, optionally a uniqueness key inside the file, grouped checks against the database and the
 * registration of a batch of valid rows. The foundation does the rest (see `imports.service.ts`).
 */

import type { Database } from '../../platform/database/database.module'

/** What a feature may use to read and write: the database, or the transaction of the confirmation. */
export type ImportExecutor = Pick<Database, 'select' | 'insert' | 'update' | 'delete' | 'execute'>

export type CellResult<T = unknown> = { ok: true; value: T } | { ok: false; reason: string }

export interface ImportColumn {
  /** Name expected in the header (1 to 100 characters), compared trimmed and ignoring case. */
  name: string
  required: boolean
  /** French description shown by the specification route (1 to 500 characters). */
  description: string
  /**
   * Rule of one cell. `cell` is the trimmed text, `null` when the cell is blank or the column absent (an optional
   * column may be absent). Returns the normalised value, or the French reason (use `echo` for a faulty value).
   */
  parse(cell: string | null): CellResult
}

export interface ColumnFault {
  column: string
  reason: string
}

export interface ParsedRow {
  rowNumber: number
  /** Normalised values of the columns whose own rule succeeded (a failed column is absent). */
  values: Record<string, unknown>
}

export interface BatchCheckResult {
  /** Faults found against the database, to add to the ones of the cell rules. */
  faults: ColumnFault[]
  /** Complement kept with the row for the registration (for instance identifiers resolved at the preview). */
  extra?: Record<string, unknown>
}

export interface StagedRow {
  rowNumber: number
  data: Record<string, unknown>
}

export interface ImportDefinition {
  /** Key of the feature (1 to 50 characters); also the scope of the memory of the imported files. */
  feature: string
  /** Expected columns, in the order of the screen and of the errors. */
  columns: ImportColumn[]
  /**
   * Uniqueness key inside the file: the first row carrying a value of `column` (its own rule succeeded) keeps it,
   * even if that row is otherwise invalid; the following ones are in error with `duplicateReason(firstRow)`.
   */
  uniqueKey?: { column: string; duplicateReason(firstRow: number): string }
  /** Grouped checks against the database for a batch of rows (never one query per row). Same length and order. */
  checkBatch?(rows: ParsedRow[], db: ImportExecutor): Promise<BatchCheckResult[]>
  /**
   * Registers a batch of valid rows with `tx`, the transaction of the confirmation, revalidating them against the
   * current state: a row that became impossible is `skipped`, never an error. A refusal of authorisation throws.
   */
  saveBatch(rows: StagedRow[], tx: ImportExecutor): Promise<{ created: number; skipped: number }>
  /** The rows are attached to a scope: the access of the caller is checked before any analysis. */
  scoped?: boolean
}
