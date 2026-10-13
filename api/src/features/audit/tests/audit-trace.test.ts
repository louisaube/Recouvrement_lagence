import { call, closePool, createUser, login, PASSWORD, resetData, sql } from '../../../platform/testing/helpers'

const UNKNOWN = '00000000-0000-4000-8000-000000000000'

describe('traces left by the foundation routes', () => {
  let admin: { id: string; token: string }
  let admin2: { id: string; token: string }
  let user: { id: string; token: string }

  const send = (path: string, token: string | undefined, method = 'GET', body?: unknown) =>
    call(path, { method, body, headers: token ? { authorization: `Bearer ${token}` } : {} })
  const entries = async () =>
    (await (await send('/audit-logs?size=100', admin.token)).json()).entries as Array<Record<string, any>>
  const count = async () => (await sql('select 1 from base.audit_logs')).length
  const scope = async (code: string, name = `Site ${code}`) =>
    (await sql<{ id: string }>('insert into base.scopes (code, name) values ($1, $2) returning id', [code, name]))[0]
  const account = async (email: string, role: 'admin' | 'user') => {
    const created = await createUser({ email, role })
    return { id: created.id, token: await login(email) }
  }

  beforeEach(async () => {
    await resetData()
    admin = await account('admin@example.com', 'admin')
    admin2 = await account('admin2@example.com', 'admin')
    user = await account('user@example.com', 'user')
  })
  afterAll(closePool)

  it('[rule-foundation-audit-trace-content] [rule-foundation-audit-declarative-route] each of the six routes leaves exactly one entry with its summary', async () => {
    const s1 = await scope('creche-parc', 'Crèche du Parc')
    const member = await createUser({ email: 'membre@example.com' })
    const target = await createUser({ email: 'cible@example.com' })

    const group = await (await send('/groups', admin.token, 'POST', { name: 'Équipe du Parc', userIds: [], scopeIds: [s1.id] })).json()
    await send('/groups', admin.token, 'POST', { name: 'Deux', userIds: [member.id, target.id], scopeIds: [s1.id] })
    await send(`/groups/${group.group.id}`, admin.token, 'PATCH', { name: 'Renommé', userIds: [member.id] })
    const created = await (await send('/users', admin.token, 'POST', { email: 'nouveau@example.com', password: PASSWORD, role: 'admin', groupIds: [group.group.id] })).json()
    await send(`/users/${target.id}`, admin.token, 'PATCH', { role: 'admin', groupIds: [] })
    const sc = await (await send('/scopes', admin2.token, 'POST', { code: 'site-2', name: 'Site « deux »' })).json()
    await send(`/scopes/${sc.scope.id}`, admin2.token, 'PATCH', { name: 'Nouveau nom' })

    const byAction = (action: string) => entries().then((all) => all.filter((e) => e.action === action))
    expect(await count()).toBe(7)
    const [groupCreated] = await byAction('groups:create').then((all) => all.filter((e) => e.objectId === group.group.id))
    expect(groupCreated).toMatchObject({
      actor: { id: admin.id, email: 'admin@example.com' },
      objectType: 'Groupe',
      scope: null,
      summary: 'Création du groupe « Équipe du Parc » (0 membre, 1 périmètre : creche-parc)',
    })
    expect((await byAction('groups:create')).map((e) => e.summary)).toContain('Création du groupe « Deux » (2 membres, 1 périmètre : creche-parc)')
    expect((await byAction('groups:update'))[0].summary).toBe('Modification du groupe « Renommé » (nom, membres)')
    expect((await byAction('users:create'))[0]).toMatchObject({
      objectType: 'Utilisateur',
      objectId: created.user.id,
      scope: null,
      summary: 'Création du compte nouveau@example.com (rôle Administrateur, 1 groupe)',
    })
    expect((await byAction('users:update'))[0]).toMatchObject({
      objectId: target.id,
      summary: 'Modification du compte cible@example.com (rôle, groupes)',
    })
    expect((await byAction('scopes:create'))[0]).toMatchObject({
      actor: { id: admin2.id, email: 'admin2@example.com' },
      objectType: 'Périmètre',
      scope: 'site-2',
      summary: 'Création du périmètre « Site « deux » » (site-2)',
    })
    expect((await byAction('scopes:update'))[0]).toMatchObject({
      scope: 'site-2',
      summary: 'Modification du périmètre site-2 (nouveau nom : « Nouveau nom »)',
    })
  })

  it('[rule-foundation-audit-no-op-traced] a PATCH that sends nothing is traced, with "aucun champ"', async () => {
    const g = await (await send('/groups', admin.token, 'POST', { name: 'G', userIds: [], scopeIds: [(await scope('s1')).id] })).json()
    expect((await send(`/groups/${g.group.id}`, admin.token, 'PATCH', {})).status).toBe(200)
    expect((await entries())[0].summary).toBe('Modification du groupe « G » (aucun champ)')
    expect(await count()).toBe(2)
  })

  it('[rule-foundation-audit-atomic-with-action] refused requests (400, 401, 403, 404, 409) leave no entry and no data', async () => {
    const s1 = await scope('dup')
    await send('/scopes', admin.token, 'POST', { code: 'un', name: 'Un' })
    expect(await count()).toBe(1)
    expect((await send('/scopes', admin.token, 'POST', { code: 'un', name: 'Autre' })).status).toBe(409)
    expect((await send('/scopes', admin.token, 'POST', { code: 'BAD CODE', name: 'x' })).status).toBe(400)
    expect((await send('/scopes', user.token, 'POST', { code: 'x', name: 'x' })).status).toBe(403)
    expect((await send('/scopes', undefined, 'POST', { code: 'x', name: 'x' })).status).toBe(401)
    expect((await send(`/groups/${UNKNOWN}`, admin.token, 'PATCH', { name: 'X' })).status).toBe(404)
    expect((await send(`/users/${admin.id}`, admin.token, 'PATCH', { role: 'user' })).status).toBe(409)
    const unknownMember = await send('/groups', admin.token, 'POST', { name: 'Fantôme', userIds: [UNKNOWN], scopeIds: [s1.id] })
    expect(unknownMember.status).toBe(400)
    expect(await sql('select 1 from base.groups')).toHaveLength(0)
    expect(await count()).toBe(1)
  })

  it('[rule-foundation-audit-atomic-with-action] parallel creations of one scope leave one 201, one entry', async () => {
    const results = await Promise.all(
      Array.from({ length: 4 }, (_, i) => send('/scopes', admin.token, 'POST', { code: 'race', name: `Course ${i}` })),
    )
    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409, 409])
    expect(await count()).toBe(1)
  })

  it('[rule-foundation-audit-atomic-with-action] a valid token whose account no longer exists is 401 security.invalid_token on a traced route', async () => {
    await sql('delete from base.credentials where user_id = $1', [admin2.id])
    await sql('delete from base.users where id = $1', [admin2.id])
    const res = await send('/scopes', admin2.token, 'POST', { code: 'orphan', name: 'Orphelin' })
    expect(res.status).toBe(401)
    expect((await res.json()).code).toBe('security.invalid_token')
    expect(await sql('select 1 from base.scopes')).toHaveLength(0)
    expect(await count()).toBe(0)
  })

  it('[rule-foundation-audit-reads-not-traced] [rule-foundation-audit-scope-of-trace] reads, login and logout leave no entry', async () => {
    for (const path of ['/users', '/groups', '/scopes', '/audit-logs', '/audit-logs/filters']) {
      expect((await send(path, admin.token)).status).toBe(200)
    }
    const logged = await call('/auth/login', { method: 'POST', body: { email: 'user@example.com', password: PASSWORD, returnToken: true } })
    expect(logged.status).toBe(200)
    expect((await send('/auth/logout', user.token, 'POST')).status).toBe(201)
    expect(await count()).toBe(0)
  })

  it('[rule-foundation-audit-summary-no-secret] the password, its hash and the token appear nowhere in the journal', async () => {
    const secret = 'S3cret-Passw0rd!'
    expect((await send('/users', admin.token, 'POST', { email: 'secret@example.com', password: secret, role: 'user' })).status).toBe(201)
    const dump = (await sql<{ t: string }>('select a::text as t from base.audit_logs a')).map((r) => r.t).join('\n')
    expect(dump).toContain('secret@example.com')
    expect(dump).not.toContain(secret)
    expect(dump).not.toContain(admin.token)
    expect(dump).not.toMatch(/\$2[aby]\$\d{2}\$/)
  })
})
