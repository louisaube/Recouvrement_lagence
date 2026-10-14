import type { Outcome } from '../useCall'

export interface ImportColumn {
  name: string
  required: boolean
  description: string
}

export interface ImportSpecification {
  columns: ImportColumn[]
  maxFileSizeBytes: number
  maxRows: number
  acceptedExtensions: string[]
}

export interface ImportPreviewSummary {
  importId: string
  fileName: string
  totalRows: number
  validRows: number
  errorRows: number
  /** Recovery imports: false when a file refused as a whole counts its error (rule-recouvrement-import-flow-reuse). */
  accepted?: boolean
  computedTotalCents?: number | null
  controlTotalCents?: number | null
}

export interface ImportRowError {
  row: number
  column: string
  reason: string
}

export interface ImportConfirmation {
  createdCount: number
  skippedCount: number
  /** Recovery imports: what the confirmation did, in French. */
  effects?: { label: string; count: number }[]
}

/** The four API calls of an import; a feature supplies its own (rule-foundation-import-two-steps). */
export interface ImportApi {
  loadSpecification: () => Promise<Outcome<ImportSpecification>>
  preview: (file: File, signal: AbortSignal) => Promise<Outcome<ImportPreviewSummary>>
  errors: (importId: string, from: number, size: number) => Promise<Outcome<{ items: ImportRowError[]; total: number }>>
  confirm: (importId: string) => Promise<Outcome<ImportConfirmation>>
}
