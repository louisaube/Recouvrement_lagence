import { z } from 'zod'
import { uuidFormat, uuidRefinement } from '../../platform/validation/common'

/** Integer query parameter: the contract of record publishes `type: integer` with its bounds and a plain string refinement. */
const queryInteger = (min: number, max: number, description: string) =>
  z
    .string()
    .refine((s) => /^\d{1,10}$/.test(s) && Number(s) >= min && Number(s) <= max, `Must be an integer from ${min} to ${max}`)
    .transform(Number)
    .meta({ type: 'integer', minimum: min, maximum: max, description })
    .optional()

/** `:importId` path parameter: a plain string in the contract, a uuid as a refinement (400 when malformed). */
export const importParamsSchema = z.object({ importId: uuidRefinement() })
export type ImportParams = z.infer<typeof importParamsSchema>

/** `rule-foundation-import-errors-paginated`: `from` 0 to 2147483647 (default 0), `size` 1 to 100 (default 10). */
export const importErrorsQuerySchema = z.object({
  from: queryInteger(0, 2147483647, 'Index of the first entry to return (default 0)'),
  size: queryInteger(1, 100, 'Number of entries to return (default 10)'),
})
export type ImportErrorsQuery = z.infer<typeof importErrorsQuerySchema>

/**
 * Integer of the contract of record: `type: integer` and the bounds it names, nothing else. (`z.number().int()` would
 * add the bounds of a safe integer to the document.)
 */
const integer = (min: number, description: string, max?: number) => {
  const bounded = z.number().min(min)
  return (max === undefined ? bounded : bounded.max(max)).meta({ type: 'integer', description })
}

/** Generic objects of the contract (`90-capacites-pour-le-metier.md` §4): every import reuses them. */
export const importColumnSchema = z
  .object({
    name: z.string().min(1).max(100).meta({ description: 'Name of the column in the header of the file' }),
    required: z.boolean().meta({ description: 'Is the column mandatory?' }),
    description: z.string().min(1).max(500).meta({ description: 'What the column holds and the rule applied to it (French)' }),
  })
  .meta({ id: 'ImportColumnDto' })

export const importSpecificationSchema = z
  .object({
    columns: z
      .array(importColumnSchema)
      .min(1)
      .max(100)
      .meta({ description: 'Columns the file may hold, in the order of the screen' }),
    maxFileSizeBytes: integer(1, 'Largest file accepted, in bytes'),
    maxRows: integer(1, 'Largest number of data rows accepted'),
    acceptedExtensions: z
      .array(z.string())
      .min(1)
      .max(10)
      .meta({ description: 'File extensions accepted, with their dot' }),
  })
  .meta({ id: 'ImportSpecificationDto' })
export type ImportSpecificationDto = z.infer<typeof importSpecificationSchema>

export const importPreviewSchema = z
  .object({
    importId: uuidFormat().meta({ description: 'Identifier of the preview, to list its errors or confirm it' }),
    fileName: z.string().min(1).max(255).meta({ description: 'Name of the file as kept (directory part removed)' }),
    totalRows: integer(0, 'Non-blank data rows (validRows + errorRows)'),
    validRows: integer(0, 'Rows that will be imported'),
    errorRows: integer(0, 'Rows in error (a row counts once, whatever its number of faults)'),
    expiresAt: z
      .string()
      .meta({ format: 'date-time', description: 'End of the preview: after it, the file must be sent again' }),
  })
  .meta({ id: 'ImportPreviewDto' })
export type ImportPreviewDto = z.infer<typeof importPreviewSchema>

export const importRowErrorSchema = z
  .object({
    row: integer(2, 'Spreadsheet row number (the header is row 1)', 2147483647),
    column: z.string().min(1).max(100).meta({ description: 'Name of the faulty column' }),
    reason: z.string().min(1).max(500).meta({ description: 'What is wrong, in French' }),
  })
  .meta({ id: 'ImportRowErrorDto' })

export const importErrorsListSchema = z
  .object({
    errors: z.array(importRowErrorSchema).max(100).meta({ description: 'One page of entries, by row then by column' }),
    total: integer(0, 'Number of entries of the whole list (not of the rows)'),
  })
  .meta({ id: 'ImportErrorsListResponseDto' })
export type ImportErrorsListDto = z.infer<typeof importErrorsListSchema>

export const importConfirmSchema = z
  .object({
    importId: uuidFormat().meta({ description: 'Identifier of the confirmed preview' }),
    createdCount: integer(0, 'Rows written'),
    skippedCount: integer(0, 'Valid rows not written because the state changed since the preview'),
    fileName: z.string().min(1).max(255).meta({ description: 'Name of the imported file' }),
  })
  .meta({ id: 'ImportConfirmResponseDto' })
export type ImportConfirmDto = z.infer<typeof importConfirmSchema>

/** The multipart body of a preview is read from the stream, not by the JSON validation: published as such. */
export const MULTIPART_FILE_BODY = {
  type: 'object',
  required: ['file'],
  properties: { file: { type: 'string', format: 'binary' } },
}
