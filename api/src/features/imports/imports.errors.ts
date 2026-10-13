import { ApiError } from '../../platform/http/errors'

/** Stable codes of the import (`60-import.md`). A code is added, never renamed. */
export const ImportCode = {
  invalidFileType: 'import.invalid_file_type',
  unsafeArchive: 'import.unsafe_archive',
  externalLinks: 'import.external_links',
  fileTooLarge: 'import.file_too_large',
  tooManyRows: 'import.too_many_rows',
  emptyFile: 'import.empty_file',
  missingColumns: 'import.missing_columns',
  alreadyImported: 'import.already_imported',
  previewNotFound: 'import.preview_not_found',
  aborted: 'import.aborted',
} as const

export const invalidFileType = (message = 'The content of the file does not match its extension'): ApiError =>
  new ApiError(400, ImportCode.invalidFileType, message)

export const unsafeArchive = (message: string): ApiError => new ApiError(400, ImportCode.unsafeArchive, message)

export const externalLinks = (message: string): ApiError => new ApiError(400, ImportCode.externalLinks, message)

export const fileTooLarge = (): ApiError => new ApiError(413, ImportCode.fileTooLarge, 'The file is too large')

export const tooManyRows = (): ApiError => new ApiError(400, ImportCode.tooManyRows, 'The file has too many rows')

export const emptyFile = (): ApiError => new ApiError(400, ImportCode.emptyFile, 'The file has no data row')

export const missingColumns = (names: string[]): ApiError =>
  new ApiError(400, ImportCode.missingColumns, `Missing required column(s): ${names.join(', ')}`)

export const alreadyImported = (): ApiError =>
  new ApiError(409, ImportCode.alreadyImported, 'This file has already been imported')

/** One fixed body for an unknown, foreign, expired or still analysed preview (`rule-foundation-import-preview-owner`). */
export const previewNotFound = (): ApiError => new ApiError(404, ImportCode.previewNotFound, 'Import preview not found')

/** The client left: nobody reads this answer, nothing is kept. */
export class ImportAborted extends ApiError {
  constructor() {
    super(400, ImportCode.aborted, 'The request was abandoned')
  }
}
