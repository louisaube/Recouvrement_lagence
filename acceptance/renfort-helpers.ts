/**
 * Aides de la version `socle-renfort-recette` : requêtes HTTP brutes (en-têtes envoyés tels quels,
 * sans normalisation par fetch), jetons forgés, lecture du journal technique du serveur de test.
 * Boîte noire : aucun import du code de l'API.
 */
import { createHmac } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { request } from 'node:http'
import { join } from 'node:path'
import { API_URL } from './harness'

export type RawResponse = { status: number; headers: Record<string, string | string[] | undefined>; text: string; json: any }

/** Requête HTTP brute : les valeurs d'en-têtes (espaces initiaux, tabulations) partent telles quelles. */
export function raw(
  path: string,
  options: { method?: string; headers?: Record<string, string>; body?: string | Buffer } = {},
): Promise<RawResponse> {
  const url = new URL(path, API_URL)
  const headers = { ...options.headers } as Record<string, string>
  if (options.body !== undefined) headers['content-length'] = String(Buffer.byteLength(options.body))
  return new Promise((resolve, reject) => {
    const req = request(
      { hostname: url.hostname, port: url.port, path: url.pathname + url.search, method: options.method ?? 'GET', headers },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          let json: any
          try {
            json = text ? JSON.parse(text) : undefined
          } catch {
            json = undefined
          }
          resolve({ status: res.statusCode ?? 0, headers: res.headers, text, json })
        })
      },
    )
    req.on('error', reject)
    if (options.body !== undefined) req.write(options.body)
    req.end()
  })
}

export const postJson = (path: string, body: string, headers: Record<string, string> = {}) =>
  raw(path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body })

/** JWT_SECRET du serveur de test, lu dans api/.env.test (le serveur de recette l'utilise). */
export function jwtSecret(): string {
  const text = readFileSync(join(__dirname, '..', 'api', '.env.test'), 'utf8')
  const line = text.split(/\r?\n/).find((l) => l.startsWith('JWT_SECRET='))
  if (!line) throw new Error('JWT_SECRET absent de api/.env.test')
  return line.slice('JWT_SECRET='.length).trim().replace(/^["']|["']$/g, '')
}

const b64url = (input: Buffer | string) => Buffer.from(input).toString('base64url')

export function decodePayload(token: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'))
}

/** Signe les revendications données avec l'algorithme HMAC demandé et le secret du serveur. */
export function forgeHmac(alg: 'HS256' | 'HS384' | 'HS512', payload: Record<string, unknown>, secret = jwtSecret()): string {
  const head = b64url(JSON.stringify({ alg, typ: 'JWT' }))
  const body = b64url(JSON.stringify(payload))
  const hash = { HS256: 'sha256', HS384: 'sha384', HS512: 'sha512' }[alg]
  const sig = createHmac(hash, secret).update(`${head}.${body}`).digest('base64url')
  return `${head}.${body}.${sig}`
}

/** Jeton `alg: none`, avec ou sans point final. */
export function forgeNone(payload: Record<string, unknown>, trailingDot: boolean): string {
  const head = b64url(JSON.stringify({ alg: 'none', typ: 'JWT' }))
  const body = b64url(JSON.stringify(payload))
  return trailingDot ? `${head}.${body}.` : `${head}.${body}`
}

export const SERVER_LOG = join(__dirname, '..', 'api', '.server-test.log')

export function logSize(): number {
  return existsSync(SERVER_LOG) ? statSync(SERVER_LOG).size : 0
}

/** Partie du journal ajoutée depuis le décalage d'octets donné. */
export function logSince(offset: number): string {
  if (!existsSync(SERVER_LOG)) return ''
  return readFileSync(SERVER_LOG).subarray(offset).toString('utf8')
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
