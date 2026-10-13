/**
 * Helpers of the Jest tests (never part of the build): the tests call the RUNNING test API through the typed client
 * (`NODE_ENV=test bash scripts/server/start.sh`) and seed `<slug>_test` with SQL, as the acceptance suite does.
 */
import { createApiClient } from '@recouvrement/api-client'
import bcrypt from 'bcryptjs'
import { Pool } from 'pg'
import { getConfig } from '../config/config'

export const API_URL = process.env.API_URL ?? 'http://localhost:4000'
export const PASSWORD = 'Passw0rd!x'

let pool: Pool | undefined
const getPool = (): Pool => {
  if (!pool) {
    const url = getConfig().databaseUrl
    if (!/_test(\?.*)?$/.test(url)) throw new Error('The tests only run on a database whose name ends with _test')
    pool = new Pool({ connectionString: url, max: 4 })
  }
  return pool
}

export async function sql<T = any>(text: string, params: unknown[] = []): Promise<T[]> {
  return (await getPool().query(text, params)).rows as T[]
}

/** Empties every table of the schema `base` (call in `beforeEach`). */
export async function resetData(): Promise<void> {
  const tables = await sql<{ tablename: string }>("select tablename from pg_tables where schemaname = 'base'")
  if (tables.length === 0) return
  await sql(`truncate ${tables.map((t) => `base."${t.tablename}"`).join(', ')} restart identity cascade`)
}

export async function closePool(): Promise<void> {
  await pool?.end()
  pool = undefined
}

/** Creates an account with its bcrypt credential (data contract: `base.users` + `base.credentials`). */
export async function createUser(params: {
  email: string
  password?: string
  role?: 'user' | 'admin'
}): Promise<{ id: string; email: string; role: 'user' | 'admin' }> {
  const [user] = await sql<{ id: string; email: string; role: 'user' | 'admin' }>(
    'insert into base.users (email, role) values ($1, $2) returning id, email, role',
    [params.email, params.role ?? 'user'],
  )
  const hash = await bcrypt.hash(params.password ?? PASSWORD, 10)
  await sql("insert into base.credentials (user_id, password, type) values ($1, $2, 'token')", [user.id, hash])
  return user
}

export const client = (token?: string) =>
  createApiClient({ baseUrl: API_URL, headers: token ? { Authorization: `Bearer ${token}` } : {} })

/** Logs in with a token and returns it. */
export async function login(email: string, password = PASSWORD): Promise<string> {
  const { data } = await client().POST('/auth/login', { body: { email, password, returnToken: true } })
  if (!data?.token) throw new Error('login failed')
  return data.token
}

/** A `fetch` response whose JSON body is loosely typed (the tests assert its shape). */
export type ApiResponse = Omit<Response, 'json'> & { json(): Promise<any> }

export async function call(
  path: string,
  options: { method?: string; headers?: Record<string, string>; body?: unknown; rawBody?: string } = {},
): Promise<ApiResponse> {
  const hasBody = options.body !== undefined || options.rawBody !== undefined
  return fetch(`${API_URL}${path}`, {
    method: options.method ?? 'GET',
    headers: { ...(hasBody ? { 'content-type': 'application/json' } : {}), ...options.headers },
    body: options.rawBody ?? (options.body !== undefined ? JSON.stringify(options.body) : undefined),
  }) as Promise<ApiResponse>
}

export function setCookies(res: ApiResponse): string[] {
  return res.headers.getSetCookie()
}

/** `name=value` of the first Set-Cookie line. */
export const cookiePair = (line: string): string => line.split(';')[0]
