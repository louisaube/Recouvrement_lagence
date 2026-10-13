import { resetData, closePool, sql } from './harness'
import { World, http, get, put, expectRes, ok, UNKNOWN_UUID, makeAccount } from './recouvrement-helpers'
import type { AccountName } from './recouvrement-helpers'

// Version v1-cerveau-recouvrement : profils de recouvrement, garde de profil lue en base à chaque requête,
// matrice des accès de toutes les routes de la version, journal ouvert au superviseur.

const U = UNKNOWN_UUID
type Probe = { m: string; p: string }

const SUPERVISOR_ROUTES: Probe[] = [
  { m: 'GET', p: '/cases' },
  { m: 'GET', p: '/cases/filters' },
  { m: 'GET', p: `/cases/${U}` },
  { m: 'GET', p: `/cases/${U}/decisions` },
  { m: 'GET', p: `/cases/${U}/state-history` },
  { m: 'GET', p: '/invoices?number=a' },
  { m: 'GET', p: '/recovery-imports/receivables/specification' },
  { m: 'POST', p: '/recovery-imports/receivables/preview' },
  { m: 'GET', p: `/recovery-imports/receivables/${U}/errors` },
  { m: 'GET', p: `/recovery-imports/receivables/${U}/report` },
  { m: 'GET', p: `/recovery-imports/receivables/${U}/report/items?category=new` },
  { m: 'POST', p: `/recovery-imports/receivables/${U}/confirm` },
  { m: 'GET', p: '/recovery-imports/history' },
  { m: 'GET', p: '/recovery-imports/status' },
  { m: 'GET', p: '/policy-versions' },
  { m: 'GET', p: `/policy-versions/${U}` },
  { m: 'POST', p: '/policy-versions/previews' },
  { m: 'POST', p: `/policy-versions/previews/${U}/confirm` },
  { m: 'POST', p: `/policy-versions/${U}/activate` },
  { m: 'GET', p: '/decision-queue/items' },
  { m: 'GET', p: '/decision-queue/counts' },
  { m: 'POST', p: `/decision-queue/items/${U}/decision` },
  { m: 'GET', p: '/ledger-outputs' },
  { m: 'GET', p: '/ledger-outputs/counts' },
  { m: 'GET', p: '/ledger-outputs/export' },
  { m: 'POST', p: '/ledger-outputs/approvals' },
  { m: 'POST', p: '/ledger-outputs/write-offs' },
  { m: 'GET', p: '/daily-batches' },
  { m: 'GET', p: `/daily-batches/${U}` },
  { m: 'GET', p: `/daily-batches/${U}/orders` },
  { m: 'POST', p: '/daily-batches' },
  { m: 'POST', p: `/daily-batches/${U}/release` },
  { m: 'GET', p: '/review-samples' },
  { m: 'POST', p: '/review-samples' },
  { m: 'GET', p: `/review-samples/${U}` },
  { m: 'GET', p: `/review-samples/${U}/items` },
  { m: 'POST', p: `/review-samples/${U}/items/${U}/review` },
]

const LITIGATION_ROUTES: Probe[] = [
  { m: 'GET', p: '/disputes' },
  { m: 'GET', p: '/disputes/invoices?number=a' },
  { m: 'GET', p: `/disputes/${U}` },
  { m: 'POST', p: '/disputes' },
  { m: 'POST', p: `/disputes/${U}/close` },
]

const INDICATOR_ROUTES: Probe[] = [
  { m: 'GET', p: '/indicators' },
  { m: 'GET', p: '/indicators/filters' },
]

const AGENT_ROUTES: Probe[] = [
  { m: 'POST', p: '/agent/conversations' },
  { m: 'GET', p: `/agent/cases/${U}` },
  { m: 'POST', p: `/agent/cases/${U}/next-offer` },
  { m: 'POST', p: `/agent/cases/${U}/commitments` },
  { m: 'POST', p: `/agent/cases/${U}/contestations` },
  { m: 'POST', p: `/agent/cases/${U}/human-requests` },
  { m: 'POST', p: `/agent/cases/${U}/complaints` },
  { m: 'POST', p: '/agent/messages/check' },
  { m: 'POST', p: '/mcp' },
  { m: 'GET', p: '/mcp' },
  { m: 'DELETE', p: '/mcp' },
]

const AUDIT_ROUTES: Probe[] = [
  { m: 'GET', p: '/audit-logs' },
  { m: 'GET', p: '/audit-logs/filters' },
]

const ALL_ACCOUNTS: AccountName[] = ['sup', 'agent', 'lit', 'ind', 'admin', 'user']
const profileOf: Record<string, string | null> = { sup: 'supervisor', agent: 'agent', lit: 'litigation', ind: 'indicators', admin: null, user: null }

describe('Recouvrement - profils, garde de profil, matrice des accès', () => {
  let w: World

  beforeEach(async () => {
    await resetData()
    w = new World()
  })
  afterAll(async () => {
    await closePool()
  })

  /** Sonde une route avec chaque compte. `allowed` : profils admis ; un corps invalide est envoyé pour prouver que la garde précède la validation. */
  async function probe(routes: Probe[], allowed: (string | null)[], extraAllowedAccounts: AccountName[] = []) {
    const tokens: Record<string, string> = {}
    for (const name of ALL_ACCOUNTS) tokens[name] = await w.tok(name)
    const failures: string[] = []
    for (const r of routes) {
      const body = r.m === 'GET' || r.m === 'DELETE' ? undefined : { inconnu: true }
      const anon = await http(r.m, r.p, undefined, body)
      if (anon.status !== 401) failures.push(`${r.m} ${r.p} visiteur : ${anon.status}`)
      for (const name of ALL_ACCOUNTS) {
        const res = await http(r.m, r.p, tokens[name], body)
        const admitted = extraAllowedAccounts.includes(name) || (profileOf[name] !== null && allowed.includes(profileOf[name]))
        if (admitted) {
          if (res.status === 401 || res.status === 403) failures.push(`${r.m} ${r.p} ${name} devait être admis : ${res.status} ${JSON.stringify(res.body)?.slice(0, 120)}`)
        } else if (res.status !== 403 || res.body?.code !== 'security.access_denied') {
          failures.push(`${r.m} ${r.p} ${name} devait être refusé (403 security.access_denied) : ${res.status} ${JSON.stringify(res.body)?.slice(0, 120)}`)
        }
      }
    }
    expect(failures).toEqual([])
  }

  describe('matrice des accès', () => {
    it('[rule-recouvrement-cases-supervisor-only][rule-recouvrement-policy-supervisor-only][rule-recouvrement-import-green-light][rule-recouvrement-ledger-supervisor-only][rule-recouvrement-batch-prepared-by-supervisor][rule-recouvrement-review-supervisor-only][rule-recouvrement-profile-server-enforced] the supervisor routes admit the supervisor only: visitor 401, agent, litigation, indicators, admin without profile and user without profile get 403 even with an invalid body', async () => {
      await probe(SUPERVISOR_ROUTES, ['supervisor'])
    })

    it('[rule-recouvrement-disputes-litigation-only] the dispute routes admit the litigation profile only (the supervisor is refused)', async () => {
      await probe(LITIGATION_ROUTES, ['litigation'])
    })

    it('[rule-recouvrement-indicators-aggregate-only] the indicator routes admit the supervisor and the indicators reader only', async () => {
      await probe(INDICATOR_ROUTES, ['supervisor', 'indicators'])
    })

    it('[rule-recouvrement-agent-tools-only][rule-recouvrement-mcp-405-after-auth][rule-recouvrement-agent-two-transports] the agent routes (REST and MCP) admit the agent profile only; GET and DELETE /mcp answer 405 to the agent', async () => {
      await probe(AGENT_ROUTES, ['agent'])
      const token = await w.tok('agent')
      for (const method of ['GET', 'DELETE']) {
        const res = await http(method, '/mcp', token)
        expect(res.status).toBe(405)
        expect(String(res.headers.get('allow')).toUpperCase()).toContain('POST')
      }
    })

    it('[rule-recouvrement-journal-supervisor][rule-recouvrement-journal-others-refused][rule-recouvrement-journal-agent-never] the journal routes admit the administrator and the supervisor; agent, litigation, indicators and user without profile get 403', async () => {
      await probe(AUDIT_ROUTES, ['supervisor'], ['admin'])
    })

    it('[rule-recouvrement-journal-agent-never] the agent never reads the journal, whatever the filter', async () => {
      const token = await w.tok('agent')
      for (const path of ['/audit-logs', '/audit-logs?size=1', '/audit-logs?action=agent:read-case', '/audit-logs/filters']) {
        expectRes(await get(path, token), 403, 'security.access_denied')
      }
    })

    it('[rule-recouvrement-journal-supervisor] the supervisor reads the journal and sees the entry written by their own action', async () => {
      const sup = await w.tok('sup')
      const admin = await w.acc('admin')
      expectRes(await put(`/user-profiles/${(await w.acc('lit')).id}`, admin.token, { profile: 'indicators' }), 200)
      const res = await get('/audit-logs?action=profiles:set', sup)
      expectRes(res, 200)
      expect(res.body.total).toBe(1)
      expect(res.body.entries[0].objectType).toBe('Profil de compte')
      expect((await get('/audit-logs/filters', sup)).status).toBe(200)
    })

    it('[rule-recouvrement-admin-no-business-access][D-0017] an administrator without a recovery profile gets 403 security.access_denied on GET /cases', async () => {
      const admin = await w.tok('admin')
      expectRes(await get('/cases', admin), 403, 'security.access_denied')
    })

    it('[rule-recouvrement-admin-no-business-access] an administrator carrying the supervisor profile exercises it, and only it', async () => {
      const token = await w.tok('adminSup')
      expectRes(await get('/cases', token), 200)
      expectRes(await get('/decision-queue/counts', token), 200)
      expectRes(await get('/disputes', token), 403, 'security.access_denied')
      expectRes(await get('/audit-logs', token), 200)
    })
  })

  describe('GET /profiles/me', () => {
    it('[rule-recouvrement-profiles-assigned-by-admin] returns the profile and the channel of each kind of account, null for an account without profile', async () => {
      expect(ok(await get('/profiles/me', await w.tok('sup')))).toEqual({ profile: 'supervisor', channel: null })
      expect(ok(await get('/profiles/me', await w.tok('lit')))).toEqual({ profile: 'litigation', channel: null })
      expect(ok(await get('/profiles/me', await w.tok('ind')))).toEqual({ profile: 'indicators', channel: null })
      expect(ok(await get('/profiles/me', await w.tok('agent')))).toEqual({ profile: 'agent', channel: 'voice' })
      expect(ok(await get('/profiles/me', await w.tok('agentMail')))).toEqual({ profile: 'agent', channel: 'email_sms' })
      expect(ok(await get('/profiles/me', await w.tok('admin')))).toEqual({ profile: null, channel: null })
      expect(ok(await get('/profiles/me', await w.tok('user')))).toEqual({ profile: null, channel: null })
    })

    it('[rule-recouvrement-profiles-assigned-by-admin] a visitor gets 401', async () => {
      expect((await get('/profiles/me')).status).toBe(401)
    })
  })

  describe('GET /user-profiles', () => {
    it('[rule-recouvrement-profiles-assigned-by-admin] lists only the accounts that have a profile, sorted by e-mail, with the exact shape', async () => {
      await w.acc('user')
      const admin = await w.tok('admin')
      await w.acc('sup')
      await w.acc('agent')
      await w.acc('lit')
      const res = await get('/user-profiles?size=100', admin)
      expectRes(res, 200)
      expect(res.body.total).toBe(3)
      const emails = res.body.items.map((i: any) => i.email)
      expect(emails).toEqual([...emails].sort())
      expect(emails).toEqual(['agent@recette.test', 'lit@recette.test', 'sup@recette.test'])
      const agent = res.body.items.find((i: any) => i.email === 'agent@recette.test')
      expect(Object.keys(agent).sort()).toEqual(['channel', 'email', 'profile', 'userId'])
      expect(agent).toMatchObject({ profile: 'agent', channel: 'voice' })
    })

    it('[rule-recouvrement-profiles-assigned-by-admin] paginates with from and size and rejects out-of-range values with 400', async () => {
      const admin = await w.tok('admin')
      await w.acc('sup')
      await w.acc('agent')
      await w.acc('lit')
      const page = await get('/user-profiles?from=1&size=1', admin)
      expectRes(page, 200)
      expect(page.body.items).toHaveLength(1)
      expect(page.body.total).toBe(3)
      for (const q of ['size=0', 'size=101', 'from=-1', 'size=abc', 'from=2147483648']) {
        expectRes(await get(`/user-profiles?${q}`, admin), 400, 'api.validation.incoming_failed')
      }
    })

    it('[rule-recouvrement-profiles-assigned-by-admin] an ordinary user, even a supervisor, gets 403 and a visitor 401', async () => {
      expectRes(await get('/user-profiles', await w.tok('sup')), 403, 'security.access_denied')
      expect((await get('/user-profiles')).status).toBe(401)
    })
  })

  describe('PUT /user-profiles/:userId', () => {
    it('[rule-recouvrement-profiles-assigned-by-admin][rule-recouvrement-profile-server-enforced] the administrator gives the supervisor profile; effective on the very next request with the same token', async () => {
      const admin = await w.tok('admin')
      const target = await makeAccount('cible@recette.test', { role: 'user' })
      expectRes(await get('/cases', target.token), 403, 'security.access_denied')
      const res = await put(`/user-profiles/${target.id}`, admin, { profile: 'supervisor' })
      expectRes(res, 200)
      expect(res.body.userProfile).toEqual({ userId: target.id, email: 'cible@recette.test', profile: 'supervisor', channel: null })
      expectRes(await get('/cases', target.token), 200)
    })

    it('[rule-recouvrement-profile-single][D-0018] a second profile replaces the first: the account reads the disputes and is refused the cases', async () => {
      const admin = await w.tok('admin')
      const target = await makeAccount('cible@recette.test', { role: 'user' })
      expectRes(await put(`/user-profiles/${target.id}`, admin, { profile: 'supervisor' }), 200)
      expectRes(await put(`/user-profiles/${target.id}`, admin, { profile: 'litigation' }), 200)
      expectRes(await get('/cases', target.token), 403, 'security.access_denied')
      expectRes(await get('/disputes', target.token), 200)
      const rows = await sql('select profile from base.user_profiles where user_id = $1', [target.id])
      expect(rows).toEqual([{ profile: 'litigation' }])
    })

    it('[rule-recouvrement-profile-no-delete] profile null removes the profile: the object comes back with null and the very same token is refused at the next request', async () => {
      const admin = await w.tok('admin')
      const target = await makeAccount('cible@recette.test', { role: 'user', profile: 'supervisor' })
      expectRes(await get('/cases', target.token), 200)
      const res = await put(`/user-profiles/${target.id}`, admin, { profile: null })
      expectRes(res, 200)
      expect(res.body.userProfile).toEqual({ userId: target.id, email: 'cible@recette.test', profile: null, channel: null })
      expectRes(await get('/cases', target.token), 403, 'security.access_denied')
      expect(await sql('select 1 from base.users where id = $1', [target.id])).toHaveLength(1)
    })

    it('[rule-recouvrement-profile-no-delete] there is no DELETE and no PATCH on a user profile: 404 api.route_not_found', async () => {
      const admin = await w.tok('admin')
      const target = await makeAccount('cible@recette.test', { role: 'user', profile: 'supervisor' })
      expectRes(await http('DELETE', `/user-profiles/${target.id}`, admin), 404, 'api.route_not_found')
      expectRes(await http('PATCH', `/user-profiles/${target.id}`, admin, { profile: null }), 404, 'api.route_not_found')
    })

    it('[rule-recouvrement-agent-channel-required] the agent profile requires a channel: 409 profiles.channel_required without it (absent or null)', async () => {
      const admin = await w.tok('admin')
      const target = await makeAccount('machine@recette.test', { role: 'user' })
      expectRes(await put(`/user-profiles/${target.id}`, admin, { profile: 'agent' }), 409, 'profiles.channel_required')
      expectRes(await put(`/user-profiles/${target.id}`, admin, { profile: 'agent', channel: null }), 409, 'profiles.channel_required')
      expect(await sql('select 1 from base.user_profiles where user_id = $1', [target.id])).toHaveLength(0)
    })

    it('[rule-recouvrement-agent-channel-required] the agent profile with a channel is accepted and the object carries it', async () => {
      const admin = await w.tok('admin')
      const target = await makeAccount('machine@recette.test', { role: 'user' })
      const res = await put(`/user-profiles/${target.id}`, admin, { profile: 'agent', channel: 'mail' })
      expectRes(res, 200)
      expect(res.body.userProfile).toMatchObject({ profile: 'agent', channel: 'mail' })
    })

    it('[rule-recouvrement-agent-channel-required] a channel on another profile is refused: 409 profiles.channel_not_allowed', async () => {
      const admin = await w.tok('admin')
      const target = await makeAccount('cible@recette.test', { role: 'user' })
      expectRes(await put(`/user-profiles/${target.id}`, admin, { profile: 'supervisor', channel: 'voice' }), 409, 'profiles.channel_not_allowed')
      expectRes(await put(`/user-profiles/${target.id}`, admin, { profile: null, channel: 'voice' }), 409, 'profiles.channel_not_allowed')
    })

    it('[rule-recouvrement-agent-one-per-channel] a second agent account on the same channel is refused: 409 profiles.channel_taken (the database holds it too)', async () => {
      const admin = await w.tok('admin')
      await w.acc('agent')
      const other = await makeAccount('machine2@recette.test', { role: 'user' })
      expectRes(await put(`/user-profiles/${other.id}`, admin, { profile: 'agent', channel: 'voice' }), 409, 'profiles.channel_taken')
      await expect(
        sql("insert into base.user_profiles (user_id, profile, channel, created_at, updated_at) values ($1, 'agent', 'voice', now(), now())", [other.id]),
      ).rejects.toThrow()
      expectRes(await put(`/user-profiles/${other.id}`, admin, { profile: 'agent', channel: 'mail' }), 200)
    })

    it('[rule-recouvrement-agent-user-role] the agent profile is refused to an administrator account: 409 profiles.agent_requires_user_role', async () => {
      const admin = await w.tok('admin')
      const other = await makeAccount('admin2@recette.test', { role: 'admin' })
      expectRes(await put(`/user-profiles/${other.id}`, admin, { profile: 'agent', channel: 'voice' }), 409, 'profiles.agent_requires_user_role')
      await expect(
        sql("insert into base.user_profiles (user_id, profile, channel, created_at, updated_at) values ($1, 'agent', 'mail', now(), now())", [other.id]),
      ).rejects.toThrow()
    })

    it('[rule-recouvrement-agent-user-role] the database refuses to turn an agent account into an administrator', async () => {
      const agent = await w.acc('agent')
      await expect(sql("update base.users set role = 'admin' where id = $1", [agent.id])).rejects.toThrow()
      const rows = await sql('select role from base.users where id = $1', [agent.id])
      expect(rows[0].role).toBe('user')
    })

    it('[rule-recouvrement-own-profile-locked] an administrator cannot change their own profile: 409 profiles.cannot_change_own_profile', async () => {
      const own = await w.acc('adminSup')
      expectRes(await put(`/user-profiles/${own.id}`, own.token, { profile: null }), 409, 'profiles.cannot_change_own_profile')
      const plain = await w.acc('admin')
      expectRes(await put(`/user-profiles/${plain.id}`, plain.token, { profile: 'supervisor' }), 409, 'profiles.cannot_change_own_profile')
      expect(await sql('select 1 from base.user_profiles where user_id = $1', [own.id])).toHaveLength(1)
    })

    it('[rule-recouvrement-profiles-assigned-by-admin] invalid bodies answer 400: unknown profile, unknown key, unknown channel, missing profile, malformed user id', async () => {
      const admin = await w.tok('admin')
      const target = await makeAccount('cible@recette.test', { role: 'user' })
      const path = `/user-profiles/${target.id}`
      expectRes(await put(path, admin, { profile: 'boss' }), 400, 'api.validation.incoming_failed')
      expectRes(await put(path, admin, { profile: 'supervisor', extra: 1 }), 400, 'api.validation.incoming_failed')
      expectRes(await put(path, admin, { profile: 'agent', channel: 'fax' }), 400, 'api.validation.incoming_failed')
      expectRes(await put(path, admin, {}), 400, 'api.validation.incoming_failed')
      expectRes(await put('/user-profiles/pas-un-uuid', admin, { profile: null }), 400, 'api.validation.incoming_failed')
    })

    it('[rule-recouvrement-profiles-assigned-by-admin] an unknown account answers 404 repository.not_found', async () => {
      const admin = await w.tok('admin')
      expectRes(await put(`/user-profiles/${U}`, admin, { profile: 'supervisor' }), 404, 'repository.not_found')
    })

    it('[rule-recouvrement-profiles-assigned-by-admin] a supervisor, a user without profile and a visitor cannot give a profile, before any validation', async () => {
      const target = await makeAccount('cible@recette.test', { role: 'user' })
      expectRes(await put(`/user-profiles/${target.id}`, await w.tok('sup'), { profile: 'boss' }), 403, 'security.access_denied')
      expectRes(await put(`/user-profiles/${target.id}`, await w.tok('user'), { profile: 'supervisor' }), 403, 'security.access_denied')
      expect((await put(`/user-profiles/${target.id}`, undefined, { profile: 'supervisor' })).status).toBe(401)
      expect(await sql('select 1 from base.user_profiles where user_id = $1', [target.id])).toHaveLength(0)
    })

    it('[rule-recouvrement-profiles-assigned-by-admin] the attribution is traced in the journal with the object type and the French summary', async () => {
      const admin = await w.tok('admin')
      const target = await makeAccount('cible@recette.test', { role: 'user' })
      await put(`/user-profiles/${target.id}`, admin, { profile: 'supervisor' })
      await put(`/user-profiles/${target.id}`, admin, { profile: null })
      const machine = await makeAccount('machine@recette.test', { role: 'user' })
      await put(`/user-profiles/${machine.id}`, admin, { profile: 'agent', channel: 'voice' })
      const res = await get('/audit-logs?action=profiles:set&size=10', admin)
      expect(res.body.total).toBe(3)
      const summaries = res.body.entries.map((e: any) => e.summary)
      expect(summaries).toEqual(
        expect.arrayContaining([
          'Profil Superviseur attribué à cible@recette.test.',
          'Profil retiré à cible@recette.test.',
          'Profil Compte agent (canal Voix) attribué à machine@recette.test.',
        ]),
      )
      expect(res.body.entries.every((e: any) => e.objectType === 'Profil de compte')).toBe(true)
    })
  })

  describe('garde de profil avant validation et sans fuite', () => {
    it('[rule-recouvrement-profile-server-enforced] a wrong profile gets 403 (never 400 or 404) on routes with invalid bodies and unknown identifiers', async () => {
      const lit = await w.tok('lit')
      const bad = [
        await http('POST', `/daily-batches/${U}/release`, lit, { reason: '' }),
        await http('POST', `/decision-queue/items/${U}/decision`, lit, { decision: 1 }),
        await http('POST', '/ledger-outputs/approvals', lit, { outputIds: [] }),
        await http('GET', `/cases/${U}`, lit),
        await http('GET', '/cases/pas-un-uuid', lit),
        await http('GET', `/policy-versions/${U}`, lit),
      ]
      expect(bad.map((r) => [r.status, r.body?.code])).toEqual(bad.map(() => [403, 'security.access_denied']))
    })

    it('[rule-recouvrement-profile-server-enforced] the profile is read from the database at every request: a profile removed by SQL between two requests with the same token is refused', async () => {
      const sup = await w.acc('sup')
      expectRes(await get('/cases', sup.token), 200)
      await sql('delete from base.user_profiles where user_id = $1', [sup.id])
      expectRes(await get('/cases', sup.token), 403, 'security.access_denied')
    })
  })
})
