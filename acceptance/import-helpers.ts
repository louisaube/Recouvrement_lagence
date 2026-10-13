/**
 * Helpers shared by the acceptance tests of version socle-import-excel.
 * Black box: raw HTTP (multipart included), SQL seeding/inspection, and files built by hand
 * (CSV, minimal .xlsx written as a ZIP with node:zlib; options inject trapped parts).
 */
import * as zlib from 'node:zlib'
import * as http from 'node:http'
import { API_URL, sql } from './harness'
import type { Res } from './scope-helpers'

export const PREVIEW = '/users/imports/preview'
export const SPECIFICATION = '/users/imports/specification'
export const errorsPath = (id: string, query = '') => `/users/imports/${id}/errors${query}`
export const confirmPath = (id: string) => `/users/imports/${id}/confirm`
export const HEADER = ['email', 'role', 'groupes']

// ---------------------------------------------------------------- HTTP

async function toRes(res: Response): Promise<Res> {
  const text = await res.text()
  let body: any = undefined
  try {
    body = text ? JSON.parse(text) : undefined
  } catch {
    body = text
  }
  return { status: res.status, body }
}

const authHeaders = (token?: string): Record<string, string> => (token ? { authorization: `Bearer ${token}` } : {})

/** GET/POST without body (confirm, errors, specification). */
export async function plain(method: string, path: string, token?: string): Promise<Res> {
  return toRes(await fetch(`${API_URL}${path}`, { method, headers: authHeaders(token) }))
}

/** Multipart upload of one file in field `file` (or `field`). */
export async function upload(
  token: string | undefined,
  file: Buffer | Uint8Array,
  fileName: string,
  opts: { path?: string; field?: string } = {},
): Promise<Res> {
  const form = new FormData()
  form.append(opts.field ?? 'file', new Blob([file]), fileName)
  return toRes(await fetch(`${API_URL}${opts.path ?? PREVIEW}`, { method: 'POST', headers: authHeaders(token), body: form }))
}

/** Hand-written multipart body, for shapes FormData cannot express (NUL in name, two files...). */
export async function rawMultipart(
  token: string | undefined,
  parts: { name: string; filename?: string; content: Buffer | string }[],
): Promise<Res> {
  const boundary = '----acceptance' + Math.random().toString(16).slice(2)
  const chunks: Buffer[] = []
  for (const p of parts) {
    const disp = `form-data; name="${p.name}"` + (p.filename !== undefined ? `; filename="${p.filename}"` : '')
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: ${disp}\r\n` + (p.filename !== undefined ? 'Content-Type: application/octet-stream\r\n' : '') + '\r\n', 'utf8'))
    chunks.push(Buffer.isBuffer(p.content) ? p.content : Buffer.from(p.content, 'utf8'))
    chunks.push(Buffer.from('\r\n'))
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`))
  return toRes(
    await fetch(`${API_URL}${PREVIEW}`, {
      method: 'POST',
      headers: { ...authHeaders(token), 'content-type': `multipart/form-data; boundary=${boundary}` },
      body: Buffer.concat(chunks),
    }),
  )
}

/** Announces a huge multipart body (Content-Length) and sends none of it; resolves with the first answer. */
export function hugeDeclaredBody(token: string | undefined, declared: number): Promise<{ status: number; body: any; ms: number }> {
  const url = new URL(API_URL)
  const started = Date.now()
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: PREVIEW,
        method: 'POST',
        headers: { ...authHeaders(token), 'content-type': 'multipart/form-data; boundary=xyz', 'content-length': String(declared) },
      },
      (res) => {
        let text = ''
        res.on('data', (c) => (text += c))
        res.on('end', () => {
          let body: any = text
          try {
            body = text ? JSON.parse(text) : undefined
          } catch {
            /* keep text */
          }
          resolve({ status: res.statusCode ?? 0, body, ms: Date.now() - started })
        })
      },
    )
    req.on('error', (e) => reject(e))
    req.setTimeout(20000, () => {
      req.destroy()
      reject(new Error('no answer to a declared huge body within 20 s'))
    })
    req.flushHeaders()
  })
}

// ---------------------------------------------------------------- CSV

export type Cell = string | number | null | undefined | { value: string; formula?: string; error?: boolean }
export type Row = Cell[]

const plainText = (c: Cell): string => (c === null || c === undefined ? '' : typeof c === 'object' ? c.value : String(c))

export function buildCsv(
  rows: Row[],
  opts: { delimiter?: string; bom?: boolean; eol?: string; finalEol?: boolean } = {},
): Buffer {
  const d = opts.delimiter ?? ','
  const eol = opts.eol ?? '\n'
  const esc = (v: string) => (/["\r\n]/.test(v) || v.includes(d) ? `"${v.replace(/"/g, '""')}"` : v)
  const text = rows.map((r) => r.map((c) => esc(plainText(c))).join(d)).join(eol) + (opts.finalEol === false ? '' : eol)
  return Buffer.from((opts.bom ? '﻿' : '') + text, 'utf8')
}

/** Accounts CSV: header + rows [email, role, groupes]. */
export const usersCsv = (rows: Row[], opts: Parameters<typeof buildCsv>[1] = {}) => buildCsv([HEADER, ...rows], opts)

// ---------------------------------------------------------------- ZIP / XLSX

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

export function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

export interface ZipEntry {
  name: string
  data: Buffer | string
  /** stored instead of deflated */
  store?: boolean
  /** uncompressed size written in the headers (a lie when different from the real size) */
  declaredSize?: number
  /** sets the "encrypted" general-purpose bit */
  encrypted?: boolean
}

export function buildZip(entries: ZipEntry[]): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const e of entries) {
    const data = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data, 'utf8')
    const name = Buffer.from(e.name, 'utf8')
    const packed = e.store ? data : zlib.deflateRawSync(data)
    const method = e.store ? 0 : 8
    const flags = 0x800 | (e.encrypted ? 1 : 0)
    const crc = crc32(data)
    const usize = e.declaredSize ?? data.length
    const lh = Buffer.alloc(30)
    lh.writeUInt32LE(0x04034b50, 0)
    lh.writeUInt16LE(20, 4)
    lh.writeUInt16LE(flags, 6)
    lh.writeUInt16LE(method, 8)
    lh.writeUInt16LE(0, 10)
    lh.writeUInt16LE(0x21, 12)
    lh.writeUInt32LE(crc, 14)
    lh.writeUInt32LE(packed.length, 18)
    lh.writeUInt32LE(usize, 22)
    lh.writeUInt16LE(name.length, 26)
    lh.writeUInt16LE(0, 28)
    const ch = Buffer.alloc(46)
    ch.writeUInt32LE(0x02014b50, 0)
    ch.writeUInt16LE(20, 4)
    ch.writeUInt16LE(20, 6)
    ch.writeUInt16LE(flags, 8)
    ch.writeUInt16LE(method, 10)
    ch.writeUInt16LE(0, 12)
    ch.writeUInt16LE(0x21, 14)
    ch.writeUInt32LE(crc, 16)
    ch.writeUInt32LE(packed.length, 20)
    ch.writeUInt32LE(usize, 24)
    ch.writeUInt16LE(name.length, 28)
    ch.writeUInt32LE(offset, 42)
    locals.push(lh, name, packed)
    centrals.push(ch, name)
    offset += lh.length + name.length + packed.length
  }
  const central = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(central.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, central, end])
}

const xmlEscape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function colLetter(i: number): string {
  let s = ''
  let n = i + 1
  while (n > 0) {
    const m = (n - 1) % 26
    s = String.fromCharCode(65 + m) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

export interface XlsxOptions {
  /** spreadsheet row number of each element of `rows` (default 1, 2, 3...), to leave gaps of absent rows */
  rowNumbers?: number[]
  /** parts added to the archive (trapped content) */
  extraEntries?: ZipEntry[]
  /** raw <Relationship .../> elements added to xl/worksheets/_rels/sheet1.xml.rels */
  sheetRels?: string
  /** raw <Relationship .../> elements added to xl/_rels/workbook.xml.rels */
  workbookRels?: string
  /** a second sheet (never read: only the first sheet counts) */
  secondSheetRows?: Row[]
}

function sheetXml(rows: Row[], rowNumbers?: number[]): string {
  const out: string[] = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>']
  rows.forEach((row, i) => {
    const r = rowNumbers ? rowNumbers[i] : i + 1
    const cells: string[] = []
    row.forEach((c, j) => {
      if (c === null || c === undefined) return
      const ref = `${colLetter(j)}${r}`
      if (typeof c === 'number') cells.push(`<c r="${ref}"><v>${c}</v></c>`)
      else if (typeof c === 'string') cells.push(`<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(c)}</t></is></c>`)
      else if (c.error) cells.push(`<c r="${ref}" t="e"><v>${xmlEscape(c.value)}</v></c>`)
      else if (c.formula !== undefined) cells.push(`<c r="${ref}" t="str"><f>${xmlEscape(c.formula)}</f><v>${xmlEscape(c.value)}</v></c>`)
      else cells.push(`<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(c.value)}</t></is></c>`)
    })
    out.push(`<row r="${r}">${cells.join('')}</row>`)
  })
  out.push('</sheetData></worksheet>')
  return out.join('')
}

export function buildXlsx(rows: Row[], opts: XlsxOptions = {}): Buffer {
  const second = opts.secondSheetRows !== undefined
  const entries: ZipEntry[] = [
    {
      name: '[Content_Types].xml',
      data:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
        (second ? '<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' : '') +
        '</Types>',
    },
    {
      name: '_rels/.rels',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    },
    {
      name: 'xl/workbook.xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${REL}"><sheets><sheet name="Comptes" sheetId="1" r:id="rId1"/>${second ? '<sheet name="Autre" sheetId="2" r:id="rId2"/>' : ''}</sheets></workbook>`,
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/>${second ? `<Relationship Id="rId2" Type="${REL}/worksheet" Target="worksheets/sheet2.xml"/>` : ''}${opts.workbookRels ?? ''}</Relationships>`,
    },
    { name: 'xl/worksheets/sheet1.xml', data: sheetXml(rows, opts.rowNumbers) },
  ]
  if (second) entries.push({ name: 'xl/worksheets/sheet2.xml', data: sheetXml(opts.secondSheetRows!) })
  if (opts.sheetRels !== undefined) {
    entries.push({
      name: 'xl/worksheets/_rels/sheet1.xml.rels',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${opts.sheetRels}</Relationships>`,
    })
  }
  entries.push(...(opts.extraEntries ?? []))
  return buildZip(entries)
}

/** Accounts workbook: header + rows. */
export const usersXlsx = (rows: Row[], opts: XlsxOptions = {}) => buildXlsx([HEADER, ...rows], opts)

// ---------------------------------------------------------------- domain helpers

export interface Preview {
  importId: string
  fileName: string
  totalRows: number
  validRows: number
  errorRows: number
  expiresAt: string
}

/** Previews and expects 200. */
export async function previewOk(token: string, file: Buffer, fileName = 'comptes.csv'): Promise<Preview> {
  const res = await upload(token, file, fileName)
  if (res.status !== 200) throw new Error(`preview of ${fileName} answered ${res.status}: ${JSON.stringify(res.body)}`)
  return res.body as Preview
}

export interface RowError {
  row: number
  column: string
  reason: string
}

/** Every error entry of a preview (pages of 100). */
export async function allErrors(token: string, importId: string): Promise<RowError[]> {
  const out: RowError[] = []
  for (let from = 0; ; from += 100) {
    const res = await plain('GET', errorsPath(importId, `?from=${from}&size=100`), token)
    if (res.status !== 200) throw new Error(`errors answered ${res.status}: ${JSON.stringify(res.body)}`)
    out.push(...res.body.errors)
    if (res.body.errors.length < 100 || out.length >= res.body.total) return out
  }
}

/** Errors of the row `row`, as [column, reason][]. */
export const errorsOfRow = (errors: RowError[], row: number) => errors.filter((e) => e.row === row).map((e) => [e.column, e.reason] as const)

export async function count(table: string): Promise<number> {
  const rows = await sql<{ n: string }>(`select count(*)::text as n from base.${table}`)
  return Number(rows[0].n)
}

export async function emailsInDb(): Promise<string[]> {
  return (await sql<{ email: string }>('select email from base.users order by email')).map((r) => r.email)
}

/** Name of a group seeded by SQL with the right shape for the import (`seedGroup` of scope-helpers). */
export const longEmail = (total: number): string => {
  // local 64 + '@' + domain of (total - 65) characters made of labels <= 63
  const local = 'a'.repeat(64)
  const domainLen = total - 65
  const tld = 'fr'
  let remaining = domainLen - tld.length - 1
  const labels: string[] = []
  while (remaining > 0) {
    const take = Math.min(63, remaining)
    labels.push('b'.repeat(take))
    remaining -= take + 1
  }
  // labels consumed `take + 1` each (the dot); adjust the last label so the total is exact
  let email = `${local}@${labels.join('.')}.${tld}`
  while (email.length > total) {
    const last = labels.length - 1
    labels[last] = labels[last].slice(0, -1)
    email = `${local}@${labels.join('.')}.${tld}`
  }
  while (email.length < total) {
    const last = labels.length - 1
    if (labels[last].length >= 63) break
    labels[last] += 'b'
    email = `${local}@${labels.join('.')}.${tld}`
  }
  return email
}
