import { sql, resetData, createUser, login, closePool } from './harness'
import { postJson, logSize, logSince, sleep } from './renfort-helpers'

const PASSWORD = 'Passw0rd!x'
const BOOM_EMAIL = 'boom-secret@example.com'
const BOOM_PASSWORD = 'Secret-Pa55word-xyz'
const CONSTRAINT = 'acceptance_renfort_no_boom'

// Version `socle-renfort-recette`, point 3 : aucun secret dans le journal technique (EXI-PLAT-05).
describe('Socle renfort - aucun secret dans les journaux', () => {
  beforeEach(async () => {
    await resetData()
    await sql(`alter table base.users drop constraint if exists ${CONSTRAINT}`)
  })
  afterAll(async () => {
    await sql(`alter table base.users drop constraint if exists ${CONSTRAINT}`).catch(() => undefined)
    await closePool()
  })

  it('[EXI-PLAT-05][Q-PLAT-06][Q-PLAT-02] an unexpected database failure answers 500 api.unknown_error and the server log holds the request id but no SQL, parameter, hash or e-mail', async () => {
    await createUser({ email: 'boss@example.com', password: PASSWORD, role: 'admin' })
    const token = await login('boss@example.com', PASSWORD)

    await sql(`alter table base.users add constraint ${CONSTRAINT} check (email <> '${BOOM_EMAIL}')`)
    let res
    let logged = ''
    let requestId = ''
    try {
      const offset = logSize()
      res = await postJson(
        '/users',
        JSON.stringify({ email: BOOM_EMAIL, password: BOOM_PASSWORD, role: 'user' }),
        { authorization: `Bearer ${token}` },
      )
      requestId = String(res.headers['x-request-id'] ?? '')
      // the log may be written slightly after the response
      for (let i = 0; i < 30; i++) {
        logged = logSince(offset)
        if (requestId && logged.includes(requestId)) break
        await sleep(100)
      }
    } finally {
      await sql(`alter table base.users drop constraint if exists ${CONSTRAINT}`)
    }

    expect(res.status).toBe(500)
    expect(res.json.code).toBe('api.unknown_error')
    expect(Object.keys(res.json).sort()).toEqual(['code', 'message', 'status'])
    expect(res.text).not.toContain(BOOM_EMAIL)
    expect(res.text.toLowerCase()).not.toContain('insert into')
    expect(requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)

    // the test is not vacuous: the request id is in the log
    expect(logged).toContain(requestId)
    // but nothing sensitive is
    const lower = logged.toLowerCase()
    expect(lower).not.toContain('insert into')
    expect(lower).not.toContain('"base"."users"')
    expect(lower).not.toContain('failed query')
    expect(lower).not.toContain('params')
    expect(logged).not.toContain(BOOM_EMAIL)
    expect(logged).not.toContain(BOOM_PASSWORD)
    expect(logged).not.toContain('$2b$')
    expect(logged).not.toContain('$2a$')
  })

  it('[EXI-PLAT-05][rule-foundation-user-create-fields] the failed creation leaves no account, no secret and no membership behind', async () => {
    await createUser({ email: 'boss@example.com', password: PASSWORD, role: 'admin' })
    const token = await login('boss@example.com', PASSWORD)
    await sql(`alter table base.users add constraint ${CONSTRAINT} check (email <> '${BOOM_EMAIL}')`)
    try {
      const res = await postJson('/users', JSON.stringify({ email: BOOM_EMAIL, password: BOOM_PASSWORD, role: 'user' }), {
        authorization: `Bearer ${token}`,
      })
      expect(res.status).toBe(500)
    } finally {
      await sql(`alter table base.users drop constraint if exists ${CONSTRAINT}`)
    }
    expect(await sql('select 1 from base.users where email = $1', [BOOM_EMAIL])).toHaveLength(0)
    expect(await sql('select 1 from base.credentials')).toHaveLength(1) // the admin only
  })

  it('[EXI-PLAT-05][Q-PLAT-02] the request id differs between two failing requests and a client-supplied id is ignored', async () => {
    await createUser({ email: 'boss@example.com', password: PASSWORD, role: 'admin' })
    const token = await login('boss@example.com', PASSWORD)
    await sql(`alter table base.users add constraint ${CONSTRAINT} check (email <> '${BOOM_EMAIL}')`)
    const ids: string[] = []
    try {
      for (let i = 0; i < 2; i++) {
        const res = await postJson('/users', JSON.stringify({ email: BOOM_EMAIL, password: BOOM_PASSWORD, role: 'user' }), {
          authorization: `Bearer ${token}`,
          'x-request-id': 'client-chosen-id',
        })
        expect(res.status).toBe(500)
        ids.push(String(res.headers['x-request-id']))
      }
    } finally {
      await sql(`alter table base.users drop constraint if exists ${CONSTRAINT}`)
    }
    expect(ids[0]).not.toBe('client-chosen-id')
    expect(ids[0]).not.toBe(ids[1])
  })
})
