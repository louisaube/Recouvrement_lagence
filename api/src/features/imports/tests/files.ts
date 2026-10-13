/**
 * Files built by hand for the tests of the import: CSV, and a minimal `.xlsx` written as a ZIP with `node:zlib`
 * (options inject trapped parts). Never part of the build.
 */
import * as zlib from 'node:zlib'

export type Cell = string | number | null | { value: string; formula: string }
export type Row = Cell[]

export const HEADER = ['email', 'role', 'groupes']

const text = (cell: Cell): string => (cell === null ? '' : typeof cell === 'object' ? cell.value : String(cell))

export function csv(rows: Row[], options: { delimiter?: string; eol?: string; bom?: boolean } = {}): Buffer {
  const d = options.delimiter ?? ','
  const eol = options.eol ?? '\n'
  const quote = (v: string) => (/["\r\n]/.test(v) || v.includes(d) ? `"${v.replace(/"/g, '""')}"` : v)
  return Buffer.from((options.bom ? '﻿' : '') + rows.map((r) => r.map((c) => quote(text(c))).join(d)).join(eol) + eol, 'utf8')
}

export const usersCsv = (rows: Row[], options: Parameters<typeof csv>[1] = {}) => csv([HEADER, ...rows], options)

const CRC = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

const crc32 = (buffer: Buffer): number => {
  let c = 0xffffffff
  for (let i = 0; i < buffer.length; i++) c = CRC[(c ^ buffer[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

export interface ZipPart {
  name: string
  data: Buffer | string
  /** Size written in the headers when it differs from the real one (a lying archive). */
  declaredSize?: number
  encrypted?: boolean
}

export function zip(parts: ZipPart[]): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const part of parts) {
    const data = Buffer.isBuffer(part.data) ? part.data : Buffer.from(part.data, 'utf8')
    const name = Buffer.from(part.name, 'utf8')
    const packed = zlib.deflateRawSync(data)
    const flags = 0x800 | (part.encrypted ? 1 : 0)
    const size = part.declaredSize ?? data.length
    const crc = crc32(data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(flags, 6)
    local.writeUInt16LE(8, 8)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(packed.length, 18)
    local.writeUInt32LE(size, 22)
    local.writeUInt16LE(name.length, 26)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(flags, 8)
    central.writeUInt16LE(8, 10)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(packed.length, 20)
    central.writeUInt32LE(size, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(offset, 42)
    locals.push(local, name, packed)
    centrals.push(central, name)
    offset += local.length + name.length + packed.length
  }
  const directory = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(parts.length, 8)
  end.writeUInt16LE(parts.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, directory, end])
}

const escapeXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const letter = (i: number): string => String.fromCharCode(65 + i)
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

export interface XlsxOptions {
  /** Spreadsheet row number of each row, to leave gaps. */
  rowNumbers?: number[]
  extra?: ZipPart[]
  sheetRels?: string
}

export function xlsx(rows: Row[], options: XlsxOptions = {}): Buffer {
  const sheet = rows
    .map((row, i) => {
      const r = options.rowNumbers ? options.rowNumbers[i] : i + 1
      const cells = row.flatMap((cell, j) => {
        if (cell === null) return []
        const ref = `${letter(j)}${r}`
        if (typeof cell === 'number') return [`<c r="${ref}"><v>${cell}</v></c>`]
        if (typeof cell === 'string') return [`<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(cell)}</t></is></c>`]
        return [`<c r="${ref}" t="str"><f>${escapeXml(cell.formula)}</f><v>${escapeXml(cell.value)}</v></c>`]
      })
      return `<row r="${r}">${cells.join('')}</row>`
    })
    .join('')
  const parts: ZipPart[] = [
    {
      name: '[Content_Types].xml',
      data:
        '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>',
    },
    {
      name: '_rels/.rels',
      data: `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    },
    {
      name: 'xl/workbook.xml',
      data: `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${REL}"><sheets><sheet name="Comptes" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    },
    {
      name: 'xl/worksheets/sheet1.xml',
      data: `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheet}</sheetData></worksheet>`,
    },
  ]
  if (options.sheetRels !== undefined) {
    parts.push({
      name: 'xl/worksheets/_rels/sheet1.xml.rels',
      data: `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${options.sheetRels}</Relationships>`,
    })
  }
  parts.push(...(options.extra ?? []))
  return zip(parts)
}

export const usersXlsx = (rows: Row[], options: XlsxOptions = {}) => xlsx([HEADER, ...rows], options)
