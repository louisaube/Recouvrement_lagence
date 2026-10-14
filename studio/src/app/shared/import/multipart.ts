/**
 * Up to this size the multipart body is assembled as plain bytes (the content is forwarded untouched, never read as
 * text), so that the request carries its body inline; beyond it the file part is streamed by the browser.
 */
const INLINE_LIMIT = 8 * 1024 * 1024

async function multipart(file: File): Promise<{ body: Uint8Array; contentType: string }> {
  const boundary = `----recouvrement${crypto.randomUUID().replace(/-/g, '')}`
  const encoder = new TextEncoder()
  const filename = file.name.replace(/"/g, '%22').replace(/\r/g, '%0D').replace(/\n/g, '%0A')
  const head = encoder.encode(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`)
  const tail = encoder.encode(`\r\n--${boundary}--\r\n`)
  const content = new Uint8Array(await file.arrayBuffer())
  const body = new Uint8Array(head.length + content.length + tail.length)
  body.set(head, 0)
  body.set(content, head.length)
  body.set(tail, head.length + content.length)
  return { body, contentType: `multipart/form-data; boundary=${boundary}` }
}

export interface FileBody {
  bodySerializer: () => FormData | Uint8Array
  headers?: Record<string, string>
}

/**
 * rule-foundation-import-no-client-parsing: the file goes out as is, byte for byte, in a multipart part « file ».
 * Large files stream from disk, the browser never holds them in memory.
 */
export async function fileBody(file: File): Promise<FileBody> {
  if (file.size > INLINE_LIMIT) {
    const form = new FormData()
    form.append('file', file, file.name)
    return { bodySerializer: () => form }
  }
  const { body, contentType } = await multipart(file)
  return { bodySerializer: () => body, headers: { 'Content-Type': contentType } }
}
