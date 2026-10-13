import { createHash, randomUUID } from 'node:crypto'
import { createWriteStream, type WriteStream } from 'node:fs'
import { mkdir, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Writable } from 'node:stream'
import { ApiError, ErrorCode, validationFailed } from '../../platform/http/errors'
import type { ApiRequest } from '../../platform/http/request-context'
import { fileTooLarge, ImportAborted } from './imports.errors'
import { boundaryOf, MultipartParser } from './multipart'

/** Where the received files wait during their analysis. Emptied at startup (`rule-foundation-import-temp-cleanup`). */
export const IMPORT_TEMP_DIR = join(tmpdir(), 'cuisine-imports')

const MIB = 1024 * 1024
/** A text field of the form above 1 KiB is refused (`rule-foundation-import-formats`). */
const FIELD_SIZE = 1024
const MAX_PARTS = 40

export interface ReceivedFile {
  /** Temporary file holding the bytes. The caller deletes it. */
  path: string
  /** Name kept: base name only, no control character, 255 characters at most. */
  fileName: string
  /** Lower case with its dot (`.csv`), or an empty string. */
  extension: string
  size: number
  /** SHA-256 of the received bytes, hexadecimal. */
  hash: string
  /** First bytes of the file (signature sniffing). */
  head: Buffer
  /** Problem found in a `.csv` while receiving it: a NUL byte or a sequence that is not UTF-8. */
  textProblem?: 'nul' | 'utf8'
}

export async function prepareTempDirectory(): Promise<void> {
  await mkdir(IMPORT_TEMP_DIR, { recursive: true })
}

/** At startup no analysis is running: every file left by a previous process is removed. */
export async function purgeTempDirectory(): Promise<void> {
  await prepareTempDirectory()
  for (const name of await readdir(IMPORT_TEMP_DIR)) await rm(join(IMPORT_TEMP_DIR, name), { force: true, recursive: true })
}

/**
 * `rule-foundation-import-formats`: base name only (`../../etc/passwd.csv` is `passwd.csv`), control characters and NUL
 * replaced by a space, trimmed, cut at 255 characters keeping the extension, `fichier.<ext>` when nothing is left.
 */
export function sanitiseFileName(raw: string | undefined): string {
  const segments = (raw ?? '').split(/[\\/]/)
  const base = (segments[segments.length - 1] ?? '').replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').trim()
  const dot = base.lastIndexOf('.')
  const extension = dot >= 0 ? base.slice(dot) : ''
  const stem = dot >= 0 ? base.slice(0, dot).trim() : base
  let name = stem === '' ? `fichier${extension}` : base
  const characters = Array.from(name)
  if (characters.length > 255) {
    const tail = Array.from(extension)
    name = tail.length < 255 ? characters.slice(0, 255 - tail.length).join('') + extension : characters.slice(0, 255).join('')
  }
  return name
}

export const extensionOf = (fileName: string): string => {
  const dot = fileName.lastIndexOf('.')
  return dot > 0 ? fileName.slice(dot).toLowerCase() : ''
}

/** Writes what it receives to a temporary file with back-pressure, hashing and counting on the way. */
class Sink extends Writable {
  size = 0
  overflow = false
  readonly hash = createHash('sha256')
  head = Buffer.alloc(0)
  textProblem?: 'nul' | 'utf8'
  private readonly decoder = new TextDecoder('utf-8', { fatal: true })

  constructor(
    private readonly target: WriteStream,
    private readonly maxBytes: number,
    private readonly checkText: boolean,
  ) {
    super()
  }

  override _write(chunk: Buffer, _encoding: BufferEncoding, done: (error?: Error | null) => void): void {
    this.size += chunk.length
    this.hash.update(chunk)
    if (this.head.length < 16) this.head = Buffer.concat([this.head, chunk.subarray(0, 16 - this.head.length)])
    if (this.checkText && !this.textProblem) {
      if (chunk.includes(0)) this.textProblem = 'nul'
      else {
        try {
          this.decoder.decode(chunk, { stream: true })
        } catch {
          this.textProblem = 'utf8'
        }
      }
    }
    if (this.size > this.maxBytes) {
      // beyond the limit the bytes are counted and dropped: nothing more is written
      this.overflow = true
      done()
      return
    }
    if (this.target.write(chunk)) done()
    else this.target.once('drain', () => done())
  }

  override _final(done: (error?: Error | null) => void): void {
    if (this.checkText && !this.textProblem) {
      try {
        this.decoder.decode()
      } catch {
        this.textProblem = 'utf8'
      }
    }
    this.target.end(() => done())
  }
}

/**
 * Receives the single file part `file` of a multipart body as a stream towards a temporary file
 * (`rule-foundation-import-large-files`: never the whole file in memory).
 *   - a body that is not multipart, a missing `file` part, two files, another field name, a text field above 1 KiB:
 *     `400 api.validation.incoming_failed`;
 *   - a declared length above the limit plus 1 MiB: `413 import.file_too_large` at once, nothing is read;
 *   - above the limit, the rest of the body is ignored (and the connection cut at twice the limit): `413`.
 * On any failure the temporary file is removed. If the client leaves, `ImportAborted` is thrown.
 */
export async function receiveUpload(req: ApiRequest, maxBytes: number): Promise<ReceivedFile> {
  const res = req.res!
  await prepareTempDirectory()
  return new Promise<ReceivedFile>((resolve, reject) => {
    const bad = (message: string) => validationFailed([{ path: 'body', message }], message)
    const type = String(req.headers['content-type'] ?? '')
    const boundary = /^multipart\/form-data\s*;/i.test(type) ? boundaryOf(type) : null
    if (boundary === null) return reject(bad('A multipart/form-data body with one file part "file" is expected'))

    const declared = Number(req.headers['content-length'])
    if (Number.isFinite(declared) && declared > maxBytes + MIB) return reject(refuseAndClose(res, fileTooLarge()))

    const path = join(IMPORT_TEMP_DIR, randomUUID())
    let shapeError: ApiError | undefined
    let files = 0
    let sink: Sink | undefined
    let target: WriteStream | undefined
    let stored: Promise<void> | undefined
    let fileName = ''
    let settled = false
    let received = 0

    const cleanup = () => rm(path, { force: true }).catch(() => undefined)
    const stop = () => {
      req.off('data', onData)
      res.off('close', onClose)
      req.unpipe(parser)
    }
    const fail = (error: ApiError) => {
      if (settled) return
      settled = true
      stop()
      target?.destroy()
      // let the remaining body flow away so that the answer can be delivered
      req.resume()
      void cleanup().then(() => reject(error))
    }
    const onClose = () => {
      if (res.writableFinished || settled) return
      settled = true
      stop()
      target?.destroy()
      void cleanup().then(() => reject(new ImportAborted()))
    }
    const onData = (chunk: Buffer) => {
      received += chunk.length
      // twice the limit at most: beyond, the connection is cut
      if (received > 2 * maxBytes + MIB) fail(refuseAndClose(res, fileTooLarge()))
    }

    const parser = new MultipartParser({
      boundary,
      fieldSize: FIELD_SIZE,
      maxParts: MAX_PARTS,
      onField: (_part, _value, truncated) => {
        if (truncated) shapeError ??= bad('A text field of the form is too long')
      },
      onFile: (part) => {
        files += 1
        if (part.name !== 'file' || files > 1) {
          shapeError ??= bad(part.name !== 'file' ? 'The file must be sent in the part "file"' : 'Only one file may be sent')
          return null
        }
        fileName = sanitiseFileName(part.filename)
        target = createWriteStream(path, { flags: 'wx' })
        sink = new Sink(target, maxBytes, extensionOf(fileName) === '.csv')
        stored = new Promise<void>((done, failed) => {
          target!.once('error', failed)
          sink!.once('error', failed)
          sink!.once('finish', () => done())
        })
        stored.catch(() => undefined)
        return sink
      },
    })

    parser.once('error', () => fail(shapeError ?? bad('The multipart body is malformed')))
    parser.once('finish', () => {
      void (async () => {
        const kept = stored ? await stored.then(() => true, () => false) : true
        if (settled) return
        if (!kept) return fail(new ApiError(500, ErrorCode.unknown, 'The file could not be stored'))
        if (shapeError) return fail(shapeError)
        if (!sink) return fail(bad('A file part "file" is expected'))
        if (sink.overflow) return fail(fileTooLarge())
        settled = true
        stop()
        resolve({
          path,
          fileName,
          extension: extensionOf(fileName),
          size: sink.size,
          hash: sink.hash.digest('hex'),
          head: sink.head,
          ...(sink.textProblem ? { textProblem: sink.textProblem } : {}),
        })
      })()
    })
    res.once('close', onClose)
    req.on('data', onData)
    req.pipe(parser)
  })
}

/** Answers at once and cuts the connection once the answer is delivered (the body will never be read). */
function refuseAndClose(res: NonNullable<ApiRequest['res']>, error: ApiError): ApiError {
  res.setHeader('Connection', 'close')
  res.once('finish', () => res.req.socket.destroy())
  return error
}
