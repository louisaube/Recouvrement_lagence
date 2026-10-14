import { z } from 'zod'
import { paginationQuerySchema, uuidFormat, uuidRefinement } from '../../platform/validation/common'
import { importColumnSchema, importPreviewSchema } from '../imports/imports.schemas'
import { dateString, instantString, integer, listOf, uuidField } from '../recovery-common/schemas'
import { CONTROL_TOTAL_PATTERN } from './recovery-parsers'
import { IMPORT_TYPES } from './recovery-imports.constants'
import { REPORT_CATEGORIES } from './recovery-imports.tables'

export const importTypeSchema = z.enum(IMPORT_TYPES).meta({
  id: 'RecoveryImportTypeDto',
  description: 'File type: receivables, payments, disputes, contacts or documents (Créances, Paiements, Litiges, Interlocuteurs, Pièces)',
})

export const typeParamsSchema = z.object({ type: importTypeSchema })
export type TypeParams = z.infer<typeof typeParamsSchema>

export const importParamsSchema = z.object({ type: importTypeSchema, importId: uuidRefinement() })
export type ImportParams = z.infer<typeof importParamsSchema>

/**
 * `controlTotal` travels in the address (the multipart reception of the foundation reads only the file part). Its
 * pattern is published for the contract; the checks (and their stable codes) are made by the service.
 */
export const previewQuerySchema = z.object({
  controlTotal: z
    .string()
    .optional()
    .meta({
      description: 'Control total of the receivables file: balance of the customer account at the extraction date (required for receivables, refused for the other types)',
      pattern: CONTROL_TOTAL_PATTERN,
    }),
})
export type PreviewQuery = z.infer<typeof previewQuerySchema>

export const specificationSchema = z
  .object({
    columns: z.array(importColumnSchema).min(1).max(100).meta({ description: 'Columns the file may hold, in the order of the screen' }),
    maxFileSizeBytes: integer(1, 'Largest file accepted, in bytes'),
    maxRows: integer(1, 'Largest number of data rows accepted'),
    acceptedExtensions: z.array(z.string()).min(1).max(10).meta({ description: 'File extensions accepted, with their dot' }),
    refusedOnFirstError: z.boolean().meta({ description: 'The whole file is refused at its first error (receivables and payments)' }),
    extraFields: z
      .array(
        z.object({
          name: z.string().min(1).max(50).meta({ description: 'Name of the query parameter' }),
          label: z.string().min(1).max(100).meta({ description: 'Label shown on the screen' }),
          required: z.boolean().meta({ description: 'The field is mandatory' }),
          description: z.string().min(1).max(500).meta({ description: 'What the field holds' }),
        }),
      )
      .max(5)
      .meta({ description: 'Fields to send with the file, besides the file itself' }),
  })
  .meta({ id: 'RecoveryImportSpecificationDto' })

export const previewResponseSchema = importPreviewSchema
  .extend({
    accepted: z.boolean().meta({ description: 'The file can be confirmed (false when a file refused as a whole counts its error)' }),
    computedTotalCents: integer(-10_000_000_000_000, 'Sum of the balances of the file, in cents').nullable().meta({ description: 'Sum of the balances of the file (receivables)' }),
    controlTotalCents: integer(-10_000_000_000_000, 'Control total entered, in cents').nullable().meta({ description: 'Control total entered (receivables)' }),
  })
  .meta({ id: 'RecoveryImportPreviewDto' })

export const effectSchema = z.object({
  label: z.string().min(1).max(200).meta({ description: 'What the confirmation did (French)' }),
  count: integer(0, 'How many'),
})

export const confirmResponseSchema = z
  .object({
    createdCount: integer(0, 'Rows written'),
    skippedCount: integer(0, 'Valid rows not written (already known, duplicate or no longer possible)'),
    effects: z.array(effectSchema).max(20).meta({ description: 'Effects of the confirmation' }),
  })
  .meta({ id: 'RecoveryImportConfirmDto' })
export type ConfirmResponse = z.infer<typeof confirmResponseSchema>

export const reportCategorySchema = z.enum(REPORT_CATEGORIES).meta({ id: 'ImportReportCategoryDto', description: 'Category of the report' })

export const reportSchema = z
  .object({
    type: importTypeSchema,
    importId: uuidField('Identifier of the import or of its preview'),
    previous: z
      .object({
        importId: uuidField('Identifier of the last confirmed import of the same type'),
        fileName: z.string().min(1).max(255).meta({ description: 'Name of its file' }),
        confirmedAt: instantString('Its confirmation instant'),
      })
      .nullable()
      .meta({ description: 'Last confirmed import of the same type (null: everything is new)' }),
    categories: z
      .array(
        z.object({
          code: reportCategorySchema,
          label: z.string().min(1).max(100).meta({ description: 'French label' }),
          rows: integer(0, 'Lines of the category'),
          cases: integer(0, 'Cases concerned'),
        }),
      )
      .max(4)
      .meta({ description: 'Differences with the previous import' }),
    notes: z
      .array(
        z.object({
          code: z.string().min(1).max(50).meta({ description: 'Code of the note' }),
          label: z.string().min(1).max(200).meta({ description: 'French label' }),
          count: integer(0, 'How many'),
        }),
      )
      .max(20)
      .meta({ description: 'Remarks about the file' }),
  })
  .meta({ id: 'ImportReportDto' })

export const reportItemsQuerySchema = paginationQuerySchema.extend({
  category: reportCategorySchema.meta({ description: 'Category of the report' }),
})
export type ReportItemsQuery = z.infer<typeof reportItemsQuerySchema>

export const reportItemSchema = z
  .object({
    key: z.string().min(1).max(200).meta({ description: 'Natural key of the line' }),
    debtorId: z.string().min(1).max(50).nullable().meta({ description: 'Customer identifier of the debtor concerned' }),
    detail: z.string().min(1).max(300).meta({ description: 'What changed (French)' }),
  })
  .meta({ id: 'ImportReportItemDto' })
export const reportItemsResponseSchema = listOf(reportItemSchema, 'ImportReportItemsResponseDto', 'Lines of the page, sorted by key')

export const historyQuerySchema = paginationQuerySchema.extend({
  type: importTypeSchema.optional().meta({ description: 'Only the imports of this type' }),
})
export type HistoryQuery = z.infer<typeof historyQuerySchema>

export const historyItemSchema = z
  .object({
    importId: uuidField('Identifier of the import'),
    type: importTypeSchema,
    fileName: z.string().min(1).max(255).meta({ description: 'Name of the file' }),
    confirmedAt: instantString('Confirmation instant'),
    confirmedBy: z.object({ id: uuidFormat().meta({ description: 'Account ID' }), email: z.string().meta({ description: 'E-mail of the account' }) }),
    totalRows: integer(0, 'Non-blank data rows'),
    createdCount: integer(0, 'Rows written'),
    skippedCount: integer(0, 'Rows not written'),
  })
  .meta({ id: 'RecoveryImportHistoryItemDto' })
export const historyResponseSchema = listOf(historyItemSchema, 'RecoveryImportHistoryResponseDto', 'Confirmed imports of the page, newest first')

export const statusSchema = z
  .object({
    statement: z.object({
      lastStatementDate: dateString('Date of the last confirmed bank statement').nullable(),
      maxAgeDays: integer(0, 'Oldest accepted bank statement according to the active policy', 3650).nullable(),
      fresh: z.boolean().meta({ description: 'A confirmed statement exists and is not older than the maximum age' }),
    }),
    receivablesExtractionDate: dateString('Extraction date of the latest receivables snapshot').nullable(),
    lastConfirmed: z
      .array(
        z.object({
          type: importTypeSchema,
          confirmedAt: instantString('Confirmation instant'),
          fileName: z.string().min(1).max(255).meta({ description: 'Name of the file' }),
        }),
      )
      .max(5)
      .meta({ description: 'The last confirmed import of each type' }),
  })
  .meta({ id: 'RecoveryImportStatusDto' })
