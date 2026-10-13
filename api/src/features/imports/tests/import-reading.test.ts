import { randomBytes } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Writable } from 'node:stream'
import { echo, fitReason } from '../imports.text'
import { boundaryOf, MultipartParser, parseDisposition } from '../multipart'
import { readCsvRows, readXlsxRows, type RawRow } from '../readers'
import { sanitiseFileName } from '../receive'
import { inspectXlsx, isExternalFormula } from '../xlsx-inspect'
import { csv, usersXlsx, xlsx } from './files'

/**
 * The reading blocks of the import, without the server: the multipart reader, the file names, the CSV and sheet
 * readers (spreadsheet row numbers), the detection of external formulas, the texts of the reasons.
 */
describe('import reading blocks', () => {
  let dir: string
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'import-reading-'))
  })
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  const file = async (name: string, content: Buffer): Promise<string> => {
    const path = join(dir, name)
    await writeFile(path, content)
    return path
  }
  const collect = async (rows: AsyncGenerator<RawRow>): Promise<RawRow[]> => {
    const out: RawRow[] = []
    for await (const row of rows) out.push(row)
    return out
  }

  describe('multipart reader', () => {
    const run = async (body: Buffer, chunks: number[]) => {
      const received: Buffer[] = []
      const fields: [string, string, boolean][] = []
      const files: (string | undefined)[] = []
      const parser = new MultipartParser({
        boundary: 'xyz',
        fieldSize: 16,
        maxParts: 5,
        onField: (part, value, truncated) => fields.push([part.name, value, truncated]),
        onFile: (part) => {
          files.push(part.filename)
          return new Writable({
            write(chunk, _encoding, done) {
              received.push(Buffer.from(chunk))
              done()
            },
          })
        },
      })
      const outcome = new Promise<string>((resolve) => {
        parser.once('error', (error) => resolve(error.message))
        parser.once('finish', () => resolve('ok'))
      })
      let at = 0
      for (const size of chunks) {
        parser.write(body.subarray(at, at + size))
        at += size
        await new Promise((resolve) => setImmediate(resolve))
      }
      parser.write(body.subarray(at))
      parser.end()
      return { outcome: await outcome, content: Buffer.concat(received), fields, files }
    }
    const part = (name: string, filename: string | undefined, content: Buffer) =>
      Buffer.concat([
        Buffer.from(`--xyz\r\nContent-Disposition: form-data; name="${name}"${filename !== undefined ? `; filename="${filename}"` : ''}\r\n\r\n`),
        content,
        Buffer.from('\r\n'),
      ])
    const close = Buffer.from('--xyz--\r\n')

    it('[rule-foundation-import-formats] the content of a file comes out intact whatever the cut of the chunks, even when it looks like a delimiter', async () => {
      const content = Buffer.concat([randomBytes(5000), Buffer.from('\r\n--xy'), Buffer.from([0x41]), Buffer.from('\r\n--')])
      const body = Buffer.concat([part('file', 'a.bin', content), close])
      for (let attempt = 0; attempt < 200; attempt++) {
        const cuts: number[] = []
        for (let left = body.length; left > 1 && Math.random() < 0.95; ) {
          const size = 1 + Math.floor(Math.random() * Math.min(left - 1, 700))
          cuts.push(size)
          left -= size
        }
        const result = await run(body, cuts)
        expect(result.outcome).toBe('ok')
        expect(result.content.equals(content)).toBe(true)
      }
    })

    it('[rule-foundation-import-formats] a file name holding a NUL or a control character does not fail the request', async () => {
      const result = await run(Buffer.concat([part('file', 'co\u0000mp\u0007tes.csv', Buffer.from('x')), close]), [])
      expect(result.outcome).toBe('ok')
      expect(result.files).toEqual(['co\u0000mp\u0007tes.csv'])
    })

    it('[rule-foundation-import-formats] a text field is reported truncated above its size; fields and files can be mixed', async () => {
      const body = Buffer.concat([part('note', undefined, Buffer.from('x'.repeat(40))), part('small', undefined, Buffer.from('ok')), part('file', 'a.csv', Buffer.from('z')), close])
      const result = await run(body, [7, 9, 50])
      expect(result.outcome).toBe('ok')
      expect(result.fields).toEqual([['note', 'x'.repeat(16), true], ['small', 'ok', false]])
      expect(result.content.toString()).toBe('z')
    })

    it('[rule-foundation-import-formats] a truncated body, too many parts and a header-less part are refused', async () => {
      expect((await run(part('file', 'a.csv', Buffer.from('abc')).subarray(0, 60), [])).outcome).toMatch(/Unexpected end|Malformed/)
      const many = Buffer.concat([...Array.from({ length: 6 }, (_, i) => part(`f${i}`, undefined, Buffer.from('v'))), close])
      expect((await run(many, [])).outcome).toBe('Too many parts')
      expect((await run(Buffer.from('--xyz\r\n\r\nbody\r\n--xyz--\r\n'), [])).outcome).toBe('A part has no header')
    })

    it('[rule-foundation-import-formats] the boundary and the disposition are read from their headers', () => {
      expect(boundaryOf('multipart/form-data; boundary=----abc123')).toBe('----abc123')
      expect(boundaryOf('multipart/form-data; boundary="a b"')).toBe('a b')
      expect(boundaryOf('multipart/form-data')).toBeNull()
      expect(parseDisposition('Content-Disposition: form-data; name="file"; filename="C:\\Users\\x\\a.csv"')).toEqual({
        name: 'file',
        filename: 'C:\\Users\\x\\a.csv',
      })
      expect(parseDisposition('Content-Type: text/plain')).toBeNull()
    })
  })

  describe('file names', () => {
    it('[rule-foundation-import-formats] base name only, control characters replaced, cut at 255 with the extension, fichier.<ext> when empty', () => {
      expect(sanitiseFileName('../../etc/passwd.csv')).toBe('passwd.csv')
      expect(sanitiseFileName('C:\\Users\\x\\comptes.csv')).toBe('comptes.csv')
      expect(sanitiseFileName('co\u0000mp\u0007tes.csv')).toBe('co mp tes.csv')
      expect(sanitiseFileName('  espaces.csv  ')).toBe('espaces.csv')
      const long = sanitiseFileName(`${'n'.repeat(300)}.csv`)
      expect(Array.from(long)).toHaveLength(255)
      expect(long.endsWith('.csv')).toBe(true)
      expect(sanitiseFileName('.csv')).toBe('fichier.csv')
      expect(sanitiseFileName('')).toBe('fichier')
      expect(Array.from(sanitiseFileName(`${'é'.repeat(300)}.xlsx`))).toHaveLength(255)
    })
  })

  describe('CSV reader', () => {
    it('[rule-foundation-import-formats] separator detected on the header: `,` or `;`, `;` on a tie; BOM and CRLF tolerated', async () => {
      const comma = await collect(readCsvRows(await file('comma.csv', csv([['a', 'b'], ['1', '2']]))))
      expect(comma.map((r) => r.cells)).toEqual([['a', 'b'], ['1', '2']])
      const semicolon = await collect(readCsvRows(await file('semi.csv', csv([['a', 'b'], ['1', '2']], { delimiter: ';', bom: true, eol: '\r\n' }))))
      expect(semicolon.map((r) => r.cells)).toEqual([['a', 'b'], ['1', '2']])
      const tie = await collect(readCsvRows(await file('tie.csv', Buffer.from('a,b;c\n1,2;3\n'))))
      expect(tie[1].cells).toEqual(['1,2', '3'])
    })

    it('[rule-foundation-import-formats] RFC 4180: doubled quotes, a line break inside quotes stays one record', async () => {
      const rows = await collect(readCsvRows(await file('quotes.csv', Buffer.from('a,b\r\n"x ""y""","l1\r\nl2"\r\nlast,"unterminated'))))
      expect(rows.map((r) => r.cells)).toEqual([['a', 'b'], ['x "y"', 'l1\r\nl2'], ['last', 'unterminated']])
      expect(rows.map((r) => r.rowNumber)).toEqual([1, 2, 3])
    })

    it('[rule-foundation-import-cell-normalisation] blank lines keep their number, cells are trimmed, a blank cell is absent', async () => {
      const rows = await collect(readCsvRows(await file('blank.csv', Buffer.from('a,b\n\n , \nx, y \n'))))
      expect(rows.map((r) => [r.rowNumber, r.cells])).toEqual([[1, ['a', 'b']], [2, [null]], [3, [null, null]], [4, ['x', 'y']]])
    })

    it('[rule-foundation-import-limits] a cell is kept up to 1,001 characters, a row up to 1,000 columns', async () => {
      const rows = await collect(readCsvRows(await file('wide.csv', Buffer.from(`${'x'.repeat(2000)},${Array.from({ length: 1500 }, () => 'c').join(',')}\n`))))
      expect(rows[0].cells[0]).toHaveLength(1001)
      expect(rows[0].cells).toHaveLength(1000)
    })
  })

  describe('workbook', () => {
    it('[rule-foundation-import-cell-normalisation] rows keep their spreadsheet number: absent rows, rows without cell, rows of blank cells', async () => {
      const path = await file('gaps.xlsx', xlsx([['email'], ['a'], [], ['   ', null], ['b']], { rowNumbers: [1, 2, 5, 6, 10] }))
      const workbook = await inspectXlsx(path, (await import('node:fs')).statSync(path).size)
      expect(workbook).toEqual({ sheetName: 'Comptes', sheetPart: 'xl/worksheets/sheet1.xml' })
      const rows = await collect(readXlsxRows(path, workbook, { maxRows: 1000, numbers: true }))
      // the row of 5 holds no cell: it is not materialised by the reader, and neither is its number
      expect(rows.map((r) => [r.rowNumber, r.cells])).toEqual([[1, ['email']], [2, ['a']], [6, [null]], [10, ['b']]])
    })

    it('[rule-foundation-import-cell-normalisation] numbers are read as text, a formula by its cached value', async () => {
      const path = await file('values.xlsx', usersXlsx([[12345, { value: 'calcule', formula: '"cal"&"cule"' }, null]]))
      const workbook = await inspectXlsx(path, (await import('node:fs')).statSync(path).size)
      const rows = await collect(readXlsxRows(path, workbook, { maxRows: 1000, numbers: true }))
      expect(rows[1].cells.slice(0, 2)).toEqual(['12345', 'calcule'])
    })
  })

  describe('external formulas', () => {
    it.each([
      ['[1]Sheet1!A1', true],
      ["'C:\\x\\[a.xlsx]S'!A1", true],
      ["'https://exemple.invalid/[a.xlsx]S'!A1", true],
      ['\\\\serveur\\partage\\[a.xlsx]S!A1', true],
      ['DDE("excel","a","b")', true],
      ["cmd|' /c calc'!A1", true],
      ['LOWER("A@EXAMPLE.COM")', false],
      ['SUM(A1:A9)*Table1[[#This Row],[Total]]', false],
      ['"a|b"&A1', false],
      ['Feuil2!B3+1', false],
    ])('[rule-foundation-import-external-links-refused] %s → external %s', (formula, expected) => {
      expect(isExternalFormula(formula)).toBe(expected)
    })
  })

  describe('reasons', () => {
    it('[rule-foundation-import-reason-texts] the echoed value has no control character and is cut at 100 characters', () => {
      expect(echo('bad\u0001value')).toBe('badvalue')
      expect(echo('x'.repeat(150))).toBe(`${'x'.repeat(100)}…`)
      expect(echo('é'.repeat(100))).toBe('é'.repeat(100))
    })

    it('[rule-foundation-import-reason-texts] a reason has 1 to 500 characters', () => {
      expect(Array.from(fitReason('é'.repeat(900)))).toHaveLength(500)
      expect(fitReason('   ')).not.toBe('')
    })
  })
})
