import { XlsxError, xlsxRows } from '@maleus/xlsx'
import { createReadStream } from 'node:fs'
import { StringDecoder } from 'node:string_decoder'
import { ApiError } from '../../platform/http/errors'
import { invalidFileType, tooManyRows, unsafeArchive } from './imports.errors'
import { entryStream, type WorkbookInfo } from './xlsx-inspect'

/** One row of the file as the spreadsheet shows it. */
export interface RawRow {
  /** Spreadsheet row number: the header is row 1, blank rows keep their number. */
  rowNumber: number
  /** Cells read as trimmed text, `null` when blank; at most 1,001 characters kept (1,001 means "too long"). */
  cells: (string | null)[]
}

/** `rule-foundation-import-limits`: internal limits. */
export const MAX_CELL_CHARACTERS = 1000
const MAX_COLUMNS = 1000
const CELL_ACCUMULATION_CAP = 5000
const MAX_DECOMPRESSED_BYTES = 1024 * 1024 * 1024

const normaliseCell = (text: string): string | null => {
  const trimmed = text.trim()
  return trimmed === '' ? null : trimmed.slice(0, MAX_CELL_CHARACTERS + 1)
}

export const isBlankRow = (row: RawRow): boolean => row.cells.every((cell) => cell === null)

// ------------------------------------------------------------------------------------------------------- CSV

/**
 * Separator `,` or `;` detected on the header record: the one that appears most outside quotes, `;` on a tie
 * (`rule-foundation-import-formats`).
 */
export async function detectDelimiter(path: string): Promise<string> {
  const decoder = new StringDecoder('utf8')
  let commas = 0
  let semicolons = 0
  let inQuotes = false
  let first = true
  let scanned = 0
  for await (const chunk of createReadStream(path, { highWaterMark: 64 * 1024 })) {
    let text = decoder.write(chunk as Buffer)
    if (first) {
      first = false
      if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
    }
    for (let i = 0; i < text.length; i += 1) {
      const c = text[i]
      if (c === '"') inQuotes = !inQuotes
      else if (!inQuotes) {
        if (c === ',') commas += 1
        else if (c === ';') semicolons += 1
        else if (c === '\n' || c === '\r') return commas > semicolons ? ',' : ';'
      }
    }
    scanned += text.length
    if (scanned > 4 * 1024 * 1024) break
  }
  return commas > semicolons ? ',' : ';'
}

/** RFC 4180 reader: quotes (doubled to escape), line breaks in a quoted field, LF, CRLF or CR, BOM tolerated. */
export async function* readCsvRows(path: string): AsyncGenerator<RawRow> {
  const delimiter = await detectDelimiter(path)
  const decoder = new StringDecoder('utf8')
  let fields: (string | null)[] = []
  let current = ''
  let quoted = false
  let touched = false
  let inQuotes = false
  let quotePending = false
  let skipLineFeed = false
  let first = true
  let rowNumber = 0

  const endField = () => {
    if (fields.length < MAX_COLUMNS) fields.push(normaliseCell(current))
    current = ''
    quoted = false
  }
  const endRecord = (): RawRow => {
    endField()
    rowNumber += 1
    const row: RawRow = { rowNumber, cells: fields }
    fields = []
    touched = false
    return row
  }

  const stream = createReadStream(path, { highWaterMark: 256 * 1024 })
  try {
    for await (const chunk of stream) {
      let text = decoder.write(chunk as Buffer)
      if (first) {
        first = false
        if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
      }
      for (let i = 0; i < text.length; i += 1) {
        const c = text[i]
        if (skipLineFeed) {
          skipLineFeed = false
          if (c === '\n') continue
        }
        if (inQuotes) {
          if (quotePending) {
            quotePending = false
            if (c === '"') {
              if (current.length < CELL_ACCUMULATION_CAP) current += '"'
              continue
            }
            inQuotes = false
            // the quote closed the field: this character is handled below as outside the quotes
          } else if (c === '"') {
            quotePending = true
            continue
          } else {
            if (current.length < CELL_ACCUMULATION_CAP) current += c
            continue
          }
        }
        if (c === '"' && current === '' && !quoted) {
          inQuotes = true
          quoted = true
          touched = true
        } else if (c === delimiter) {
          touched = true
          endField()
        } else if (c === '\n' || c === '\r') {
          if (c === '\r') skipLineFeed = true
          yield endRecord()
        } else {
          touched = true
          if (current.length < CELL_ACCUMULATION_CAP) current += c
        }
      }
    }
    const rest = decoder.end()
    for (const c of rest) if (current.length < CELL_ACCUMULATION_CAP) current += c
    // an unterminated last record is a record; the final line break alone is not
    if (touched || current !== '' || fields.length > 0 || quoted) yield endRecord()
  } finally {
    stream.destroy()
  }
}

// ------------------------------------------------------------------------------------------------------ XLSX

/**
 * Row numbers of the rows that `@maleus/xlsx` yields: a row exists as soon as it holds a cell (`<c>`), even a blank
 * one; a row without any cell is not materialised. The library does not report the number: it is read from the
 * `r` attribute of each `<row>` (or the previous number plus one), so that blank and absent rows keep their number.
 */
async function* sheetRowNumbers(path: string, part: string): AsyncGenerator<number> {
  const decoder = new StringDecoder('utf8')
  const tokens = /<row\b([^>]*?)(\/?)>|<\/row>|<c[\s>/]/g
  let previous = 0
  let current = 0
  let open = false
  let hasCell = false
  let carry = ''
  for await (const chunk of await entryStream(path, part)) {
    const text = carry + decoder.write(chunk)
    tokens.lastIndex = 0
    let consumed = 0
    for (let m = tokens.exec(text); m; m = tokens.exec(text)) {
      consumed = tokens.lastIndex
      if (m[0].startsWith('<row')) {
        const r = /\sr\s*=\s*"(\d+)"/.exec(m[1])
        previous = r ? Number(r[1]) : previous + 1
        if (m[2] === '/') {
          open = false
        } else {
          open = true
          hasCell = false
          current = previous
        }
      } else if (m[0] === '</row>') {
        if (open && hasCell) yield current
        open = false
      } else if (open) {
        hasCell = true
      }
    }
    // keep a possibly incomplete tag
    const rest = text.slice(consumed)
    const lt = rest.lastIndexOf('<')
    carry = lt >= 0 ? rest.slice(lt) : ''
    if (carry.length > 100000) carry = ''
  }
}

const cellText = (value: string | number | boolean | null): string => {
  if (value === null) return ''
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
  return String(value)
}

function xlsxFailure(error: unknown): never {
  if (error instanceof ApiError) throw error
  if (error instanceof XlsxError) {
    if (error.code === 'ROW_BUDGET_EXCEEDED') throw tooManyRows()
    if (error.code === 'DECOMPRESSED_BUDGET_EXCEEDED' || error.code === 'TOO_MANY_ENTRIES') {
      throw unsafeArchive('The workbook expands to too much data')
    }
    throw invalidFileType('The workbook cannot be read')
  }
  throw error
}

/** Rows of the first sheet. `numbers: false` skips the numbering scan (counting only). */
export async function* readXlsxRows(
  path: string,
  workbook: WorkbookInfo,
  options: { maxRows: number; numbers: boolean },
): AsyncGenerator<RawRow> {
  const rows = xlsxRows(path, { sheet: workbook.sheetName, maxDecompressedBytes: MAX_DECOMPRESSED_BYTES, maxRows: options.maxRows })
  const numbers = options.numbers ? sheetRowNumbers(path, workbook.sheetPart) : undefined
  let fallback = 0
  try {
    for await (const row of rows) {
      let rowNumber: number
      if (numbers) {
        const next = await numbers.next()
        rowNumber = next.done ? fallback + 1 : next.value
      } else {
        rowNumber = fallback + 1
      }
      fallback = rowNumber
      const cells: (string | null)[] = []
      const width = Math.min(row.length, MAX_COLUMNS)
      for (let i = 0; i < width; i += 1) cells.push(normaliseCell(cellText(row[i])))
      yield { rowNumber, cells }
    }
  } catch (error) {
    xlsxFailure(error)
  } finally {
    rows.destroy()
    await numbers?.return(undefined)
  }
}

export function readRows(
  path: string,
  kind: 'csv' | 'xlsx',
  workbook: WorkbookInfo | undefined,
  options: { maxRows: number; numbers: boolean },
): AsyncGenerator<RawRow> {
  return kind === 'csv' ? readCsvRows(path) : readXlsxRows(path, workbook!, options)
}
