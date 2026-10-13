/**
 * Helpers shared by the acceptance tests of version socle-groupes-perimetres.
 * Black box: raw HTTP calls (status + JSON body) and SQL seeding only.
 */
import { API_URL, sql, createUser, login } from './harness'

export const PASSWORD = 'Passw0rd!x'
export const UNKNOWN_UUID = '00000000-0000-4000-8000-000000000000'

export interface Res {
  status: number
  body: any
}

/** Raw HTTP call. `body` is serialised as JSON when defined. */
export async function call(method: string, path: string, token?: string, body?: unknown): Promise<Res> {
  const headers: Record<string, string> = {}
  if (token) headers.authorization = `Bearer ${token}`
  if (body !== undefined) headers['content-type'] = 'application/json'
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  let parsed: any = undefined
  try {
    parsed = text ? JSON.parse(text) : undefined
  } catch {
    parsed = text
  }
  return { status: res.status, body: parsed }
}

/** Creates an account with a password and returns its token. */
export async function userWithToken(email: string, role: 'user' | 'admin') {
  const user = await createUser({ email, password: PASSWORD, role })
  const token = await login(email, PASSWORD)
  return { ...user, token }
}

export async function seedScope(code: string, name = `Perimetre ${code}`): Promise<{ id: string; code: string; name: string }> {
  const rows = await sql(
    'insert into base.scopes (code, name, created_at, updated_at) values ($1, $2, now(), now()) returning id, code, name',
    [code, name],
  )
  return rows[0]
}

export async function seedGroup(
  name: string,
  opts: { scopeIds?: string[]; userIds?: string[] } = {},
): Promise<{ id: string; name: string }> {
  const rows = await sql('insert into base.groups (name, created_at, updated_at) values ($1, now(), now()) returning id, name', [name])
  const group = rows[0]
  for (const scopeId of opts.scopeIds ?? []) {
    await sql('insert into base.group_scopes (group_id, scope_id, created_at) values ($1, $2, now())', [group.id, scopeId])
  }
  for (const userId of opts.userIds ?? []) {
    await sql('insert into base.group_users (group_id, user_id, created_at) values ($1, $2, now())', [group.id, userId])
  }
  return group
}

export async function memberIdsOf(groupId: string): Promise<string[]> {
  const rows = await sql('select user_id from base.group_users where group_id = $1 order by user_id', [groupId])
  return rows.map((r) => r.user_id)
}

export async function scopeIdsOf(groupId: string): Promise<string[]> {
  const rows = await sql('select scope_id from base.group_scopes where group_id = $1 order by scope_id', [groupId])
  return rows.map((r) => r.scope_id)
}

export async function groupIdsOfUser(userId: string): Promise<string[]> {
  const rows = await sql('select group_id from base.group_users where user_id = $1 order by group_id', [userId])
  return rows.map((r) => r.group_id)
}
