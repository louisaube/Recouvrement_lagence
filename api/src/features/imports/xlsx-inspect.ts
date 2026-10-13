import { createReadStream } from 'node:fs'
import { open } from 'node:fs/promises'
import { StringDecoder } from 'node:string_decoder'
import { createInflateRaw } from 'node:zlib'
import { externalLinks, invalidFileType, unsafeArchive } from './imports.errors'

/**
 * Inspection of a `.xlsx` before any row is read (`rule-foundation-import-archive-limits`,
 * `rule-foundation-import-external-links-refused`): the central directory is parsed without trusting it, every entry
 * is inflated through a counter (the declared sizes may lie), the XML parts are scanned for entity declarations, the
 * relationships for external targets and the formulas for references to another workbook.
 */

const MAX_ENTRIES = 1000
const MAX_TOTAL_BYTES = 1024 * 1024 * 1024
const BOMB_FLOOR = 1024 * 1024
const BOMB_RATIO = 100
const MAX_DIRECTORY_BYTES = 16 * 1024 * 1024
/** Parts read whole (relationships and workbook): they are small, anything bigger is not a workbook. */
const MAX_SMALL_PART = 4 * 1024 * 1024

interface ZipEntry {
  name: string
  lowerName: string
  method: number
  compressedSize: number
  size: number
  localOffset: number
  dataStart: number
}

export interface WorkbookInfo {
  /** Name of the first sheet of the workbook (hidden or not). */
  sheetName: string
  /** Archive path of its XML part. */
  sheetPart: string
}

const NESTED_EXTENSIONS = [
  '.zip', '.gz', '.tgz', '.bz2', '.xz', '.7z', '.rar', '.tar', '.jar', '.war', '.cab', '.iso',
  '.exe', '.dll', '.so', '.dylib', '.bat', '.cmd', '.com', '.scr', '.msi', '.vbs', '.ps1', '.sh',
]
const BINARY_SIGNATURES: Buffer[] = [
  Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  Buffer.from([0x50, 0x4b, 0x05, 0x06]),
  Buffer.from([0x1f, 0x8b]),
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0]),
  Buffer.from([0x37, 0x7a, 0xbc, 0xaf]),
  Buffer.from('Rar!'),
  Buffer.from([0x7f, 0x45, 0x4c, 0x46]),
  Buffer.from([0x4d, 0x5a, 0x90, 0x00]),
]

const isXmlPart = (name: string) => /\.(xml|rels|vml)$/.test(name)

export async function inspectXlsx(path: string, fileSize: number): Promise<WorkbookInfo> {
  const handle = await open(path, 'r')
  let entries: ZipEntry[]
  let directoryOffset: number
  try {
    ;({ entries, directoryOffset } = await readDirectory(handle, fileSize))
  } finally {
    await handle.close()
  }

  // structure: names, sizes, sums, bombs
  const seen = new Set<string>()
  let declaredTotal = 0
  for (const entry of entries) {
    const name = entry.name
    if (
      name.length > 255 ||
      name.includes('\u0000') ||
      name.includes('\\') ||
      name.startsWith('/') ||
      name.includes('..') ||
      /^[a-z]:/i.test(name)
    ) {
      throw unsafeArchive('The archive contains an entry with a suspicious name')
    }
    if (seen.has(entry.lowerName)) throw unsafeArchive('The archive contains duplicate entry names')
    seen.add(entry.lowerName)
    declaredTotal += entry.size
    if (declaredTotal > MAX_TOTAL_BYTES) throw unsafeArchive('The archive expands to too much data')
    if (entry.size > BOMB_FLOOR && entry.size / Math.max(entry.compressedSize, 1) > BOMB_RATIO) {
      throw unsafeArchive('The archive is a decompression bomb')
    }
    if (entry.method === 0 && entry.compressedSize !== entry.size) throw unsafeArchive('The archive declares inconsistent sizes')
  }

  // nature: a workbook has a content-types part and a workbook part
  if (!seen.has('[content_types].xml') || !seen.has('xl/workbook.xml')) throw invalidFileType('The archive is not a workbook')

  for (const entry of entries) {
    const n = entry.lowerName
    const base = n.slice(n.lastIndexOf('/') + 1)
    if (
      base === 'vbaproject.bin' ||
      base === 'vbaprojectsignature.bin' ||
      base === 'vbadata.xml' ||
      n.startsWith('xl/macrosheets/') ||
      n.startsWith('xl/activex/') ||
      NESTED_EXTENSIONS.some((extension) => n.endsWith(extension))
    ) {
      throw unsafeArchive('The archive contains macro code or a nested archive or binary')
    }
  }
  for (const entry of entries) {
    const n = entry.lowerName
    if (
      n.startsWith('xl/externallinks/') ||
      n.startsWith('xl/embeddings/') ||
      n.startsWith('xl/querytables/') ||
      n === 'xl/connections.xml'
    ) {
      throw externalLinks('The workbook contains external links, data connections or embedded objects')
    }
  }

  // the data regions must not overlap and must end before the central directory
  const byOffset = [...entries].sort((a, b) => a.localOffset - b.localOffset)
  const small = new Map<string, string>()
  const handle2 = await open(path, 'r')
  try {
    for (const entry of entries) {
      const header = Buffer.alloc(30)
      const { bytesRead } = await handle2.read(header, 0, 30, entry.localOffset)
      if (bytesRead < 30 || header.readUInt32LE(0) !== 0x04034b50) throw invalidFileType('The archive is damaged')
      entry.dataStart = entry.localOffset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28)
      if (entry.dataStart + entry.compressedSize > directoryOffset) throw invalidFileType('The archive is truncated or damaged')
    }
  } finally {
    await handle2.close()
  }
  for (let i = 0; i + 1 < byOffset.length; i += 1) {
    if (byOffset[i].dataStart + byOffset[i].compressedSize > byOffset[i + 1].localOffset) {
      throw unsafeArchive('The archive has overlapping entries')
    }
  }

  // content: inflate every entry through a counter
  let realTotal = 0
  for (const entry of entries) {
    if (entry.name.endsWith('/')) continue
    const text = await scanEntry(path, entry, (bytes) => {
      realTotal += bytes
      if (realTotal > MAX_TOTAL_BYTES) throw unsafeArchive('The archive expands to too much data')
    })
    if (text !== undefined) small.set(entry.lowerName, text)
  }

  for (const [name, text] of small) {
    if (name.endsWith('.rels')) checkRelationships(text)
  }
  return firstSheet(entries, small)
}

async function readDirectory(
  handle: Awaited<ReturnType<typeof open>>,
  fileSize: number,
): Promise<{ entries: ZipEntry[]; directoryOffset: number }> {
  if (fileSize < 22) throw invalidFileType('The file is not a workbook')
  const tailLength = Math.min(fileSize, 22 + 65535)
  const tail = Buffer.alloc(tailLength)
  await handle.read(tail, 0, tailLength, fileSize - tailLength)
  let at = -1
  for (let i = tailLength - 22; i >= 0; i -= 1) {
    if (tail.readUInt32LE(i) === 0x06054b50 && i + 22 + tail.readUInt16LE(i + 20) <= tailLength) {
      at = i
      break
    }
  }
  if (at < 0) throw invalidFileType('The file is not a ZIP archive, or is truncated')
  const eocdPosition = fileSize - tailLength + at
  const disk = tail.readUInt16LE(at + 4)
  const directoryDisk = tail.readUInt16LE(at + 6)
  const count = tail.readUInt16LE(at + 10)
  const directorySize = tail.readUInt32LE(at + 12)
  const directoryOffset = tail.readUInt32LE(at + 16)
  const zip64Locator = at >= 20 && tail.readUInt32LE(at - 20) === 0x07064b50
  if (zip64Locator || count === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) {
    throw unsafeArchive('The ZIP64 format is not accepted')
  }
  if (count > MAX_ENTRIES) throw unsafeArchive('The archive contains too many entries')
  if (disk !== 0 || directoryDisk !== 0 || count === 0) throw invalidFileType('The archive is damaged')
  if (directorySize > MAX_DIRECTORY_BYTES) throw unsafeArchive('The central directory of the archive is too large')
  if (directoryOffset + directorySize > eocdPosition) throw invalidFileType('The archive is truncated or damaged')

  const directory = Buffer.alloc(directorySize)
  const { bytesRead } = await handle.read(directory, 0, directorySize, directoryOffset)
  if (bytesRead < directorySize) throw invalidFileType('The archive is truncated')

  const entries: ZipEntry[] = []
  let p = 0
  for (let i = 0; i < count; i += 1) {
    if (p + 46 > directory.length || directory.readUInt32LE(p) !== 0x02014b50) throw invalidFileType('The archive is damaged')
    const flags = directory.readUInt16LE(p + 8)
    const method = directory.readUInt16LE(p + 10)
    const compressedSize = directory.readUInt32LE(p + 20)
    const size = directory.readUInt32LE(p + 24)
    const nameLength = directory.readUInt16LE(p + 28)
    const extraLength = directory.readUInt16LE(p + 30)
    const commentLength = directory.readUInt16LE(p + 32)
    const localOffset = directory.readUInt32LE(p + 42)
    if (p + 46 + nameLength + extraLength + commentLength > directory.length) throw invalidFileType('The archive is damaged')
    // an encrypted entry (Q-IMPORT-03), the strong encryption flag included
    if (flags & 0x1 || flags & 0x40) throw unsafeArchive('The archive contains an encrypted entry')
    if (compressedSize === 0xffffffff || size === 0xffffffff || localOffset === 0xffffffff) {
      throw unsafeArchive('The ZIP64 format is not accepted')
    }
    if (method !== 0 && method !== 8) throw invalidFileType('The archive uses an unsupported compression')
    const name = directory.toString('utf8', p + 46, p + 46 + nameLength)
    entries.push({ name, lowerName: name.toLowerCase(), method, compressedSize, size, localOffset, dataStart: 0 })
    p += 46 + nameLength + extraLength + commentLength
  }
  return { entries, directoryOffset }
}

/**
 * Inflates one entry through a counter: the real size may not exceed the declared one. Scans the XML parts for entity
 * declarations and the worksheets for external formulas; returns the text of the small parts that are read whole.
 */
async function scanEntry(path: string, entry: ZipEntry, onBytes: (bytes: number) => void): Promise<string | undefined> {
  if (entry.compressedSize === 0) {
    if (entry.size !== 0) throw invalidFileType('The archive is damaged')
    return isXmlPart(entry.lowerName) ? '' : undefined
  }
  const source = createReadStream(path, { start: entry.dataStart, end: entry.dataStart + entry.compressedSize - 1 })
  const inflater = entry.method === 8 ? createInflateRaw() : undefined
  const stream = inflater ? source.pipe(inflater) : source
  source.on('error', (error) => stream.destroy(error))
  const xml = isXmlPart(entry.lowerName)
  const keep = xml && (entry.lowerName.endsWith('.rels') || entry.lowerName === 'xl/workbook.xml')
  const worksheet = /^xl\/(worksheets|macrosheets)\/[^/]+\.xml$/.test(entry.lowerName) || entry.lowerName === 'xl/workbook.xml'
  const scanDecoder = new StringDecoder('utf8')
  const keepDecoder = new StringDecoder('utf8')
  const formulas = new FormulaScanner(entry.lowerName === 'xl/workbook.xml' ? 'definedName' : 'f')
  const kept: string[] = []
  let keptBytes = 0
  let real = 0
  let tail: Buffer = Buffer.alloc(0)
  let first = true
  try {
    for await (const chunk of stream as AsyncIterable<Buffer>) {
      real += chunk.length
      if (real > entry.size) throw unsafeArchive('An entry is larger than its declared size')
      onBytes(chunk.length)
      if (first) {
        first = false
        if (!xml && BINARY_SIGNATURES.some((signature) => chunk.subarray(0, signature.length).equals(signature))) {
          throw unsafeArchive('The archive contains a nested archive or binary')
        }
      }
      if (xml) {
        tail = scanEntities(tail, chunk)
        if (worksheet) formulas.push(scanDecoder.write(chunk))
        if (keep) {
          keptBytes += chunk.length
          if (keptBytes > MAX_SMALL_PART) throw unsafeArchive('A relationship or workbook part is too large')
          kept.push(keepDecoder.write(chunk))
        }
      }
    }
  } catch (error) {
    if ((error as { code?: string }).code?.startsWith('Z_') || (error as { errno?: number }).errno !== undefined) {
      throw invalidFileType('The archive is damaged')
    }
    throw error
  } finally {
    source.destroy()
    stream.destroy()
  }
  if (real !== entry.size) throw invalidFileType('The archive is damaged')
  return keep ? kept.join('') : undefined
}

/** `<!DOCTYPE` and `<!ENTITY` are refused in every XML part (entity bombs). */
function scanEntities(previous: Buffer, chunk: Buffer): Buffer {
  const hay = previous.length > 0 ? Buffer.concat([previous, chunk]) : chunk
  let i = hay.indexOf('<!')
  while (i !== -1) {
    const word = hay.toString('latin1', i + 2, i + 9).toUpperCase()
    if (word.startsWith('DOCTYPE') || word.startsWith('ENTITY')) throw unsafeArchive('An XML part declares a DOCTYPE or an ENTITY')
    i = hay.indexOf('<!', i + 2)
  }
  return hay.subarray(Math.max(0, hay.length - 8))
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
const decodeEntities = (text: string): string =>
  text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_all, code: string) => {
    if (code[0] === '#') {
      const value = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10)
      return Number.isFinite(value) && value > 0 && value < 0x110000 ? String.fromCodePoint(value) : ''
    }
    return ENTITIES[code.toLowerCase()] ?? ''
  })

/**
 * A formula is never evaluated, but one that points outside the workbook is refused: another workbook (`[1]S!A1`,
 * `'C:\x\[a.xlsx]S'!A1`), a URL or network path, a dynamic data exchange (`DDE(`, `cmd|' /c calc'!A1`).
 */
export function isExternalFormula(formula: string): boolean {
  if (/\[\d+\]/.test(formula)) return true
  if (/\[[^\]]*\.(xlsx?|xlsm|xlsb|xlam|xltx?|xltm|ods|csv)\]/i.test(formula)) return true
  if (/(^|[^a-z0-9_])[a-z]:\\/i.test(formula) || formula.includes('\\\\')) return true
  if (/\b(?:https?|ftp|file):/i.test(formula)) return true
  const withoutLiterals = formula.replace(/"(?:[^"]|"")*"/g, '""')
  return /\bDDE\s*\(/i.test(withoutLiterals) || /[a-z_][\w.]*\s*\|/i.test(withoutLiterals)
}

/** Streams the text of a sheet and checks every `<f>` (or `<definedName>`) element. */
class FormulaScanner {
  private carry = ''
  private readonly pattern: RegExp
  private readonly open: string

  constructor(element: 'f' | 'definedName') {
    this.pattern = new RegExp(`<${element}(?:\\s[^>]*)?>([^<]*)</${element}>`, 'g')
    this.open = `<${element}`
  }

  push(text: string): void {
    if (text === '') return
    const hay = this.carry + text
    if (!hay.includes(this.open)) {
      this.carry = hay.slice(-this.open.length)
      return
    }
    let consumed = 0
    this.pattern.lastIndex = 0
    for (let m = this.pattern.exec(hay); m; m = this.pattern.exec(hay)) {
      consumed = this.pattern.lastIndex
      if (m[1] && isExternalFormula(decodeEntities(m[1]))) throw externalLinks('The workbook contains a formula that points outside of it')
    }
    const rest = hay.slice(consumed)
    const start = rest.lastIndexOf(this.open)
    this.carry = start >= 0 ? rest.slice(start) : rest.slice(-this.open.length)
    // a formula element that never closes cannot grow without bound
    if (this.carry.length > 65536) this.carry = ''
  }
}

/** An external relationship that is not a hyperlink (an object, a linked workbook, a data source) is refused. */
function checkRelationships(text: string): void {
  for (const match of text.matchAll(/<Relationship\b[^>]*>/gi)) {
    const element = match[0]
    const mode = /\bTargetMode\s*=\s*"([^"]*)"/i.exec(element)?.[1]
    if (mode?.toLowerCase() !== 'external') continue
    const type = /\bType\s*=\s*"([^"]*)"/i.exec(element)?.[1] ?? ''
    if (!/\/hyperlink$/i.test(type)) throw externalLinks('The workbook has an external relationship that is not a hyperlink')
  }
}

function normalise(target: string): string {
  const out: string[] = []
  for (const part of target.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') out.pop()
    else out.push(part)
  }
  return out.join('/')
}

/** First sheet of the workbook, in the order of the workbook, hidden or not (`rule-foundation-import-header-matching`). */
function firstSheet(entries: ZipEntry[], small: Map<string, string>): WorkbookInfo {
  const workbook = small.get('xl/workbook.xml') ?? ''
  const sheet = /<(?:\w+:)?sheet\b[^>]*>/i.exec(workbook)?.[0]
  const name = sheet ? /\bname\s*=\s*"([^"]*)"/i.exec(sheet)?.[1] : undefined
  const id = sheet ? /\s(?:\w+:)id\s*=\s*"([^"]*)"/i.exec(sheet)?.[1] : undefined
  if (!sheet || name === undefined || id === undefined) throw invalidFileType('The workbook has no sheet')
  const rels = small.get('xl/_rels/workbook.xml.rels') ?? ''
  let target: string | undefined
  for (const match of rels.matchAll(/<Relationship\b[^>]*>/gi)) {
    if (new RegExp(`\\bId\\s*=\\s*"${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`).test(match[0])) {
      target = /\bTarget\s*=\s*"([^"]*)"/i.exec(match[0])?.[1]
    }
  }
  if (!target) throw invalidFileType('The first sheet of the workbook cannot be found')
  const part = normalise(decodeEntities(target).startsWith('/') ? decodeEntities(target) : `xl/${decodeEntities(target)}`)
  if (!entries.some((entry) => entry.lowerName === part.toLowerCase())) throw invalidFileType('The first sheet of the workbook is missing')
  return { sheetName: decodeEntities(name), sheetPart: entries.find((entry) => entry.lowerName === part.toLowerCase())!.name }
}

/** Streams the archive path of an entry, inflated (used to number the rows of a sheet). */
export async function entryStream(path: string, part: string): Promise<AsyncIterable<Buffer>> {
  const handle = await open(path, 'r')
  try {
    const { size } = await handle.stat()
    const { entries, directoryOffset } = await readDirectory(handle, size)
    const entry = entries.find((e) => e.name === part)
    if (!entry) throw invalidFileType('The sheet is missing')
    const header = Buffer.alloc(30)
    await handle.read(header, 0, 30, entry.localOffset)
    const start = entry.localOffset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28)
    if (entry.compressedSize === 0 || start + entry.compressedSize > directoryOffset) {
      return (async function* () {})()
    }
    const source = createReadStream(path, { start, end: start + entry.compressedSize - 1 })
    if (entry.method !== 8) return source
    const inflater = createInflateRaw()
    source.on('error', (error) => inflater.destroy(error))
    return source.pipe(inflater)
  } finally {
    await handle.close()
  }
}
