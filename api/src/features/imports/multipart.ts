import StreamSearch from 'streamsearch'
import { Writable } from 'node:stream'

/**
 * Minimal streaming reader of a `multipart/form-data` body (RFC 7578). A part header is read as UTF-8 text without
 * judging its characters: a file name holding a NUL or a control character is cleaned by the caller
 * (`rule-foundation-import-formats`: never an error), where a stricter reader would refuse the whole request. The
 * content of a file part is written to the sink the caller gives, with back-pressure; the memory used does not
 * depend on the size of the body.
 */

export interface PartHeader {
  name: string
  /** Present for a file part (possibly empty). */
  filename?: string
}

export interface MultipartOptions {
  boundary: string
  /** A file part starts. Returns the writable receiving its bytes, or `null` to discard them. */
  onFile(part: PartHeader): Writable | null
  /** A text part is complete (`truncated` when it exceeded `fieldSize`). */
  onField(part: PartHeader, value: string, truncated: boolean): void
  fieldSize: number
  maxParts: number
}

const HEADER_LIMIT = 16 * 1024
const CRLF2 = Buffer.from('\r\n\r\n')

export class MultipartParser extends Writable {
  private readonly search: StreamSearch
  private state: 'preamble' | 'delimiter' | 'headers' | 'body' | 'epilogue' = 'preamble'
  private pad = Buffer.alloc(0)
  private header = Buffer.alloc(0)
  private parts = 0
  private sink: Writable | null = null
  private field: { part: PartHeader; chunks: Buffer[]; size: number; truncated: boolean } | null = null
  private waiting: Writable | null = null
  private failure: Error | null = null

  constructor(private readonly options: MultipartOptions) {
    super()
    this.search = new StreamSearch(Buffer.from(`\r\n--${options.boundary}`), (isMatch, data, start, end, isSafe) => {
      if (this.failure) return
      try {
        if (data && end > start) this.consume(isSafe ? data.subarray(start, end) : Buffer.from(data.subarray(start, end)))
        if (isMatch) this.delimiter()
      } catch (error) {
        this.failure = error as Error
      }
    })
    // the first delimiter has no line break before it: supply one
    this.search.push(Buffer.from('\r\n'))
  }

  override _write(chunk: Buffer, _encoding: BufferEncoding, done: (error?: Error | null) => void): void {
    this.waiting = null
    this.search.push(chunk)
    if (this.failure) return done(this.failure)
    const sink = this.waiting as Writable | null
    if (sink) sink.once('drain', () => done())
    else done()
  }

  override _final(done: (error?: Error | null) => void): void {
    this.search.destroy()
    if (this.failure) return done(this.failure)
    if (this.state !== 'epilogue') {
      this.sink?.destroy()
      return done(new Error('Unexpected end of the multipart body'))
    }
    done()
  }

  override _destroy(error: Error | null, done: (error?: Error | null) => void): void {
    this.sink?.destroy()
    done(error)
  }

  private delimiter(): void {
    if (this.state === 'preamble') {
      this.state = 'delimiter'
      this.pad = Buffer.alloc(0)
    } else if (this.state === 'body') {
      this.endPart()
      this.state = 'delimiter'
      this.pad = Buffer.alloc(0)
    } else if (this.state !== 'epilogue') {
      throw new Error('Malformed multipart body')
    }
  }

  private consume(buffer: Buffer): void {
    let rest = buffer
    while (rest.length > 0) {
      if (this.state === 'preamble' || this.state === 'epilogue') return
      if (this.state === 'delimiter') {
        // after a delimiter: `--` closes the body, a line break opens the headers of the next part
        const need = 2 - this.pad.length
        this.pad = Buffer.concat([this.pad, rest.subarray(0, need)])
        rest = rest.subarray(need)
        if (this.pad.length < 2) return
        if (this.pad[0] === 0x2d && this.pad[1] === 0x2d) {
          this.state = 'epilogue'
          return
        }
        if (this.pad[0] !== 0x0d || this.pad[1] !== 0x0a) throw new Error('Malformed multipart body')
        this.state = 'headers'
        this.header = Buffer.alloc(0)
        continue
      }
      if (this.state === 'headers') {
        const combined = Buffer.concat([this.header, rest])
        if (combined.length >= 2 && combined[0] === 0x0d && combined[1] === 0x0a) throw new Error('A part has no header')
        const at = combined.indexOf(CRLF2)
        if (at > HEADER_LIMIT || (at < 0 && combined.length > HEADER_LIMIT)) throw new Error('A part header is too large')
        if (at < 0) {
          this.header = combined
          return
        }
        this.startPart(combined.subarray(0, at).toString('utf8'))
        this.header = Buffer.alloc(0)
        rest = combined.subarray(at + 4)
        this.state = 'body'
        continue
      }
      // body
      if (this.sink) {
        if (!this.sink.write(rest)) this.waiting = this.sink
      } else if (this.field) {
        const room = this.options.fieldSize + 1 - this.field.size
        if (room > 0) {
          this.field.chunks.push(rest.subarray(0, room))
          this.field.size += Math.min(rest.length, room)
        }
        if (rest.length > room) this.field.truncated = true
      }
      return
    }
  }

  private startPart(headers: string): void {
    this.parts += 1
    if (this.parts > this.options.maxParts) throw new Error('Too many parts')
    const part = parseDisposition(headers)
    if (!part) throw new Error('A part has no name')
    if (part.filename !== undefined) {
      this.sink = this.options.onFile(part)
      this.field = null
    } else {
      this.sink = null
      this.field = { part, chunks: [], size: 0, truncated: false }
    }
  }

  private endPart(): void {
    if (this.sink) {
      this.sink.end()
      this.sink = null
    } else if (this.field) {
      const { part, chunks, truncated } = this.field
      const value = Buffer.concat(chunks).subarray(0, this.options.fieldSize).toString('utf8')
      this.field = null
      this.options.onField(part, value, truncated)
    }
  }
}

/** Only `\"` is an escape: a Windows path (`C:\Users\x\a.csv`) sent by an old client keeps its backslashes. */
const unquote = (value: string): string => value.replace(/\\"/g, '"')

/** `Content-Disposition: form-data; name="file"; filename="a.csv"` → name and file name. */
export function parseDisposition(headers: string): PartHeader | null {
  const line = headers.split('\r\n').find((l) => /^content-disposition\s*:/i.test(l))
  if (!line) return null
  let name: string | undefined
  let filename: string | undefined
  for (const m of line.matchAll(/;\s*([A-Za-z0-9*_-]+)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^;\s]*))/g)) {
    const key = m[1].toLowerCase()
    const value = m[2] !== undefined ? unquote(m[2]) : m[3]
    if (key === 'name') name = value
    else if (key === 'filename') filename = value
    else if (key === 'filename*') {
      const encoded = /^[^']*'[^']*'(.*)$/.exec(value)?.[1]
      try {
        if (encoded !== undefined && filename === undefined) filename = decodeURIComponent(encoded)
      } catch {
        /* keep the plain name */
      }
    }
  }
  return name === undefined ? null : { name, ...(filename !== undefined ? { filename } : {}) }
}

/** Boundary of a `multipart/form-data` content type, or null. */
export function boundaryOf(contentType: string): string | null {
  const m = /;\s*boundary\s*=\s*(?:"([^"]{1,70})"|([^;\s]{1,70}))/i.exec(contentType)
  return m ? (m[1] ?? m[2]) : null
}
