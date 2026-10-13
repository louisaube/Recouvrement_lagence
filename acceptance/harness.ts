/**
 * Harnais de recette de Cuisine sauvage (écrit pour la cuisine, indépendant du socle).
 * Boîte noire : les tests parlent à l'API qui tourne, par HTTP, et lisent ou préparent
 * les données par SQL selon le contrat de données (specifications/data-contract.md).
 */
import createClient from 'openapi-fetch'
import { Pool } from 'pg'
import bcrypt from 'bcryptjs'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export const API_URL = process.env.API_URL ?? 'http://localhost:4000'

const slug = (() => {
  try {
    return JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8')).name as string
  } catch {
    return 'recouvrement'
  }
})()
const DATABASE_URL = process.env.ACCEPTANCE_DATABASE_URL ?? `postgres://database:database@localhost:5432/${slug}_test`

let pool: Pool | undefined
const getPool = () => (pool ??= new Pool({ connectionString: DATABASE_URL, max: 4 }))

export type ApiClient = ReturnType<typeof createClient<any>>

/** Client HTTP de l'API ; une réponse non 2xx est levée sous la forme { status, code, message, ... }. */
export function api(token?: string): ApiClient {
  const client = createClient<any>({
    baseUrl: API_URL,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  client.use({
    async onResponse({ response }) {
      if (response.ok) return undefined
      const payload: any = await response
        .clone()
        .json()
        .catch(() => ({ code: 'api.unknown_error', status: response.status }))
      throw { status: response.status, ...(payload?.error ?? payload) }
    },
  })
  return client
}

/** SQL brut sur la base de test (schéma `base`). */
export async function sql<T = any>(text: string, params: unknown[] = []): Promise<T[]> {
  const result = await getPool().query(text, params as any[])
  return result.rows as T[]
}

/** Vide toutes les tables du schéma `base`. */
export async function resetData(): Promise<void> {
  const tables = await sql<{ tablename: string }>("select tablename from pg_tables where schemaname = 'base'")
  if (tables.length === 0) return
  await sql(`truncate ${tables.map((t) => `base."${t.tablename}"`).join(', ')} restart identity cascade`)
}

/** Crée un compte avec mot de passe, selon le contrat de données. Rend { id, email, role }. */
export async function createUser(params: {
  email: string
  password: string
  role: 'user' | 'admin'
}): Promise<{ id: string; email: string; role: string }> {
  const [user] = await sql<{ id: string; email: string; role: string }>(
    'insert into base.users (email, role) values ($1, $2) returning id, email, role',
    [params.email, params.role]
  )
  const hash = await bcrypt.hash(params.password, 10)
  await sql("insert into base.credentials (user_id, password, type) values ($1, $2, 'token')", [user.id, hash])
  return user
}

/** Se connecte par l'API et rend le jeton. */
export async function login(email: string, password: string): Promise<string> {
  const response: any = await api().POST('/auth/login' as any, { body: { email, password, returnToken: true } } as any)
  return response.data.token
}

export async function closePool(): Promise<void> {
  await pool?.end()
  pool = undefined
}
