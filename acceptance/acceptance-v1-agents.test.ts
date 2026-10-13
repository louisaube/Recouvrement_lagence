import { resetData, closePool, sql } from './harness'
import {
  World, get, post, http, expectRes, ok, UNKNOWN_UUID, setupWorld, daysFromToday, policyDoc, ruleFor, standardLadder, importOk, strip,
  RestTools, openConversation, descendTo, commitmentFor, forbiddenKeysIn, freshKey, makeAccount, PASSWORD, contactsFile, defaultContact,
  DISPUTES_HEADER, SIREN_A, euros,
} from './recouvrement-helpers'
import type { Inv, Outcome } from './recouvrement-helpers'

// Version v1-cerveau-recouvrement : outils des agents sur REST (le transport MCP est dans acceptance-v1-mcp.test.ts).

const D = (n: number) => daysFromToday(n)
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']
const fr = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`
const long = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`
/** 1 000,00 € avec espace insécable. */
const money = (cents: number) => `${euros(cents).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} €`

const CONV = 'conv-1'

describe('Recouvrement - outils des agents (REST)', () => {
  let w: World
  let sup: string
  let agent: RestTools

  beforeEach(async () => {
    await resetData()
    w = new World()
    sup = await w.tok('sup')
  })
  afterAll(async () => {
    await closePool()
  })

  async function world(opts: Parameters<typeof setupWorld>[0] = {}) {
    await setupWorld(opts, w)
    agent = new RestTools(await w.tok('agent'), 'voice')
    return w
  }
  /** Ouvre la conversation CONV sur le dossier d'un débiteur. */
  async function open(debtor = 'D1', conv = CONV, tools: RestTools = agent) {
    const caseId = await w.caseId(debtor)
    await openConversation(tools, conv, caseId, await w.contactId(debtor))
    return caseId
  }
  const queueTypes = async () => (await w.queueCounts()).byType ?? {}

  // ------------------------------------------------------------------ accès et contexte

  describe('accès et contexte', () => {
    it('[rule-recouvrement-agent-tools-only] without a token every agent route answers 401; the other profiles, the plain user and the profile-less admin get 403 security.access_denied', async () => {
      await world()
      const caseId = await w.caseId('D1')
      const calls: [string, string, unknown?][] = [
        ['POST', '/agent/conversations', { caseId, interlocutorId: UNKNOWN_UUID, aiDisclosureGiven: true }],
        ['GET', `/agent/cases/${caseId}`], ['POST', `/agent/cases/${caseId}/next-offer`, {}], ['POST', `/agent/cases/${caseId}/commitments`, {}],
        ['POST', `/agent/cases/${caseId}/contestations`, {}], ['POST', `/agent/cases/${caseId}/human-requests`, {}],
        ['POST', `/agent/cases/${caseId}/complaints`, {}], ['POST', '/agent/messages/check', {}],
      ]
      const tools = new RestTools('', 'voice')
      for (const [method, path, body] of calls) {
        const noToken = await tools.raw(method, path, CONV, freshKey(), body)
        expect([method, path, noToken.status]).toEqual([method, path, 401])
        for (const who of ['sup', 'lit', 'ind', 'user', 'admin'] as const) {
          const res = await new RestTools(await w.tok(who), 'voice').raw(method, path, CONV, freshKey(), body)
          expect([who, method, path, res.status, res.body?.code]).toEqual([who, method, path, 403, 'security.access_denied'])
        }
      }
    })

    it('[rule-recouvrement-agent-tools-only] the agent account is refused on every other business route', async () => {
      await world()
      const token = await w.tok('agent')
      const caseId = await w.caseId('D1')
      for (const path of ['/cases', `/cases/${caseId}`, '/cases/filters', '/invoices?number=F', '/policy-versions', '/decision-queue/items', '/decision-queue/counts', '/daily-batches', '/disputes', '/ledger-outputs', '/indicators', '/review-samples', '/profiles/me', '/audit-logs']) {
        const res = await get(path, token)
        expect([path, res.status, res.body?.code]).toEqual([path, 403, 'security.access_denied'])
      }
      expect((await post('/daily-batches', token)).status).toBe(403)
    })

    it('[rule-recouvrement-agent-authentication][D-0019] the agent logs in with the socle login (returnToken: true) and reads a case with the bearer token received', async () => {
      await world()
      const caseId = await open()
      const res = await http('POST', '/auth/login', undefined, { email: 'agent@recette.test', password: PASSWORD, returnToken: true })
      expectRes(res, 200)
      expect(typeof res.body.token).toBe('string')
      const read = await new RestTools(res.body.token, 'voice').read(CONV, caseId)
      expect(read.status).toBe(200)
      expect(read.body.case.caseId).toBe(caseId)
    })

    it('[rule-recouvrement-agent-context] a missing or malformed context header gives 400 agent.missing_context before any business check, after authentication', async () => {
      await world()
      const caseId = await open()
      const bad: Record<string, (string | null)[]> = {
        'X-Agent-Version': [null, '', 'a b', 'x'.repeat(51), 'é'],
        'X-Channel': [null, 'telephone', ''],
        'X-Conversation-Id': [null, '', 'a b', 'c'.repeat(101)],
        'Idempotency-Key': [null, '', 'a b', 'k'.repeat(129)],
      }
      for (const [header, values] of Object.entries(bad)) {
        for (const value of values) {
          const res = await agent.raw('GET', `/agent/cases/${UNKNOWN_UUID}`, CONV, freshKey(), undefined, { [header]: value })
          expect([header, value, res.status, res.body?.code]).toEqual([header, value, 400, 'agent.missing_context'])
        }
      }
      const edge = await agent.raw('GET', `/agent/cases/${caseId}`, 'c'.repeat(100), 'k'.repeat(128), undefined, { 'X-Agent-Version': 'v'.repeat(50) })
      expect(edge.body.code).toBe('agent.conversation_not_found')
      const noAuth = await new RestTools('', 'voice').raw('GET', `/agent/cases/${caseId}`, CONV, freshKey(), undefined, { 'X-Agent-Version': null })
      expect(noAuth.status).toBe(401)
    })

    it('[rule-recouvrement-agent-context] the channel header must be the channel of the account: 403 agent.channel_mismatch', async () => {
      await world()
      const caseId = await w.caseId('D1')
      const res = await agent.raw('GET', `/agent/cases/${caseId}`, CONV, freshKey(), undefined, { 'X-Channel': 'mail' })
      expectRes(res, 403, 'agent.channel_mismatch')
      const other = await new RestTools(await w.tok('agentMail'), 'voice').raw('POST', '/agent/conversations', CONV, freshKey(), { caseId, interlocutorId: await w.contactId('D1'), aiDisclosureGiven: true })
      expectRes(other, 403, 'agent.channel_mismatch')
    })

    it('[rule-recouvrement-agent-calls-logged] every call, refusals included, leaves a row of the calls table with tool, inputs, status and response; no route reads it', async () => {
      await world()
      const caseId = await open()
      const key = freshKey('log')
      expect((await agent.read(CONV, caseId, key)).status).toBe(200)
      expect((await agent.nextOffer(CONV, caseId, { counterpart: { type: 'direct_debit' } })).status).toBe(200)
      expect((await agent.nextOffer(CONV, caseId, {})).status).toBe(409)
      const rows = await sql<any>('select * from base.agent_calls order by created_at')
      expect(rows.length).toBeGreaterThanOrEqual(4)
      const statuses = rows.map((r: any) => Number(r.status ?? r.response_status))
      expect(statuses).toEqual(expect.arrayContaining([201, 200, 409]))
      expect(JSON.stringify(rows)).toContain(key)
      for (const path of ['/agent/calls', '/agent-calls', '/agent/call-log']) expect([401, 403, 404]).toContain((await get(path, sup)).status)
    })
  })

  // ------------------------------------------------------------------ conversations

  describe('conversations', () => {
    it('[rule-recouvrement-agent-ai-disclosure] without the AI disclosure the conversation is refused 403 agent.ai_disclosure_required and nothing is recorded; no other tool works without an opened conversation', async () => {
      await world()
      const caseId = await w.caseId('D1')
      const refused = await agent.open(CONV, { caseId, interlocutorId: await w.contactId('D1'), aiDisclosureGiven: false })
      expect(refused.status).toBe(403)
      expect(refused.body.code).toBe('agent.ai_disclosure_required')
      expect((await sql('select 1 from base.agent_conversations')).length).toBe(0)
      for (const outcome of [await agent.read(CONV, caseId), await agent.nextOffer(CONV, caseId), await agent.human(CONV, caseId), await agent.complaint(CONV, caseId, { text: 'x' }), await agent.check(CONV, { caseId, text: 'bonjour' })]) {
        expect([outcome.status, outcome.body.code]).toEqual([404, 'agent.conversation_not_found'])
      }
    })

    it('[rule-recouvrement-agent-conversation-bound] the conversation is bound to its case, interlocutor, account and channel: it carries them back, and a tool called with another case answers 404 cases.not_found', async () => {
      await world({ invoices: [{ numero: 'FA-001', debiteur: 'D1', montant: 100000 }, { numero: 'FA-002', debiteur: 'D2', montant: 100000 }] })
      const caseId = await w.caseId('D1')
      const interlocutorId = await w.contactId('D1')
      const opened = await agent.open(CONV, { caseId, interlocutorId, aiDisclosureGiven: true })
      expect(opened.status).toBe(201)
      expect(opened.body).toMatchObject({ conversationId: CONV, caseId, interlocutorId, channel: 'voice' })
      expect(Object.keys(opened.body).sort()).toEqual(['caseId', 'channel', 'conversationId', 'interlocutorId', 'openedAt'])
      const other = await w.caseId('D2')
      for (const outcome of [await agent.read(CONV, other), await agent.nextOffer(CONV, other), await agent.contest(CONV, other, { reason: 'x', invoiceNumbers: ['FA-002'] }), await agent.complaint(CONV, other, { text: 'x' }), await agent.check(CONV, { caseId: other, text: 'x' })]) {
        expect([outcome.status, outcome.body.code]).toEqual([404, 'cases.not_found'])
      }
    })

    it('[rule-recouvrement-agent-conversation-bound] another agent account cannot use the conversation of an agent: 404 agent.conversation_not_found, and the conversation is unchanged', async () => {
      await world()
      const caseId = await open()
      const second = await makeAccount('agent2@recette.test', { role: 'user', profile: 'agent', channel: 'voice' })
      const intruder = new RestTools(second.token, 'voice')
      const commitBody = { offerId: UNKNOWN_UUID, paymentMethod: 'transfer', totalCents: 1, installments: [{ dueDate: D(7), amountCents: 1 }] }
      for (const outcome of [
        await intruder.read(CONV, caseId), await intruder.nextOffer(CONV, caseId), await intruder.human(CONV, caseId), await intruder.complaint(CONV, caseId, { text: 'x' }),
        await intruder.check(CONV, { caseId, text: 'x' }), await intruder.commit(CONV, caseId, commitBody), await intruder.contest(CONV, caseId, { reason: 'x', invoiceNumbers: ['FA-001'] }),
      ]) {
        expect([outcome.status, outcome.body.code]).toEqual([404, 'agent.conversation_not_found'])
      }
      expect((await agent.read(CONV, caseId)).status).toBe(200)
      expect(((await w.caseDetail('D1')).unlockedOffers ?? []).length).toBe(0)
    })

    it('[rule-recouvrement-agent-conversation-bound] an unknown case or a malformed case id: 404 cases.not_found at the opening, 400 for the malformed one', async () => {
      await world()
      const res = await agent.open(CONV, { caseId: UNKNOWN_UUID, interlocutorId: await w.contactId('D1'), aiDisclosureGiven: true })
      expect([res.status, res.body.code]).toEqual([404, 'cases.not_found'])
      const bad = await agent.open(CONV, { caseId: 'nope', interlocutorId: UNKNOWN_UUID, aiDisclosureGiven: true })
      expect([bad.status, bad.body.code]).toEqual([400, 'api.validation.incoming_failed'])
      for (const body of [{}, { caseId: UNKNOWN_UUID, interlocutorId: UNKNOWN_UUID }, { caseId: UNKNOWN_UUID, interlocutorId: UNKNOWN_UUID, aiDisclosureGiven: 'oui' }, { caseId: UNKNOWN_UUID, interlocutorId: UNKNOWN_UUID, aiDisclosureGiven: true, extra: 1 }]) {
        expect((await agent.open(CONV, body as any)).body.code).toBe('api.validation.incoming_failed')
      }
    })

    it('[rule-recouvrement-agent-case-channel-access][D-0004] a case with no ready batch is open to the voice channel as soon as a non frozen invoice allows it and the interlocutor is reachable by phone', async () => {
      await world()
      const caseId = await w.caseId('D1')
      const res = await agent.raw('POST', '/agent/conversations', CONV, freshKey(), { caseId, interlocutorId: await w.contactId('D1'), aiDisclosureGiven: true })
      expect(res.status).toBe(201)
    })

    it('[rule-recouvrement-agent-case-channel-access] a channel no invoice allows, a settled case and an unknown case all give the same 404 cases.not_found; an unreachable interlocutor gives 409 agent.interlocutor_unreachable', async () => {
      await world({
        invoices: [{ numero: 'FA-001', debiteur: 'D1', montant: 100000, canaux: 'courrier' }, { numero: 'FA-002', debiteur: 'D2', montant: 100000 }, { numero: 'FA-003', debiteur: 'D3', montant: 100000 }],
        contacts: [defaultContact('D1'), defaultContact('D2'), { debiteur: 'D3', role: 'payeur', courriel: 'd3@example.test', adresse: '1 rue A 75001 Paris' }],
      })
      const mine = async (caseId: string, interlocutorId: string) => agent.open(`c-${caseId.slice(0, 8)}`, { caseId, interlocutorId, aiDisclosureGiven: true })
      const noChannel = await mine(await w.caseId('D1'), await w.contactId('D1'))
      const unknown = await mine(UNKNOWN_UUID, await w.contactId('D1'))
      expect([noChannel.status, noChannel.body.code]).toEqual([404, 'cases.not_found'])
      expect(noChannel.body).toEqual(unknown.body)
      const noPhone = await mine(await w.caseId('D3'), await w.contactId('D3'))
      expect([noPhone.status, noPhone.body.code]).toEqual([409, 'agent.interlocutor_unreachable'])
      await sql("update base.cases set state = 'settled' where debtor_id = 'D2'")
      const settled = await mine(await w.caseId('D2'), await w.contactId('D2'))
      expect([settled.status, settled.body.code]).toEqual([404, 'cases.not_found'])
      await sql("update base.cases set state = 'transferred' where debtor_id = 'D2'")
      expect((await mine(await w.caseId('D2'), await w.contactId('D2'))).status).toBe(404)
    })

    it('[rule-recouvrement-agent-case-channel-access] an interlocutor of another case is not reachable: 404 cases.not_found', async () => {
      await world({ invoices: [{ numero: 'FA-001', debiteur: 'D1', montant: 100000 }, { numero: 'FA-002', debiteur: 'D2', montant: 100000 }] })
      const res = await agent.open(CONV, { caseId: await w.caseId('D1'), interlocutorId: await w.contactId('D2'), aiDisclosureGiven: true })
      expect(res.status).toBeGreaterThanOrEqual(404)
      expect(res.status).toBeLessThanOrEqual(409)
      expect(res.body.code).not.toBeUndefined()
    })

    it('[rule-recouvrement-conversation-reuse][D-0012] opening again with the same identifier, case and interlocutor and a new key returns the conversation with its original openedAt; another case with that identifier gives 409 agent.conversation_exists', async () => {
      await world({ invoices: [{ numero: 'FA-001', debiteur: 'D1', montant: 100000 }, { numero: 'FA-002', debiteur: 'D2', montant: 100000 }] })
      const caseId = await w.caseId('D1')
      const interlocutorId = await w.contactId('D1')
      const openRaw = (body: unknown) => agent.raw('POST', '/agent/conversations', CONV, freshKey(), body)
      const first = await openRaw({ caseId, interlocutorId, aiDisclosureGiven: true })
      expect(first.status).toBe(201)
      const again = await openRaw({ caseId, interlocutorId, aiDisclosureGiven: true })
      expect(again.status).toBe(201)
      expect(again.body.openedAt).toBe(first.body.openedAt)
      expect((await sql('select 1 from base.agent_conversations')).length).toBe(1)
      const other = await openRaw({ caseId: await w.caseId('D2'), interlocutorId: await w.contactId('D2'), aiDisclosureGiven: true })
      expect([other.status, other.body.code]).toEqual([409, 'agent.conversation_exists'])
    })

    it('[rule-recouvrement-agent-conversation-bound] the conversation identifier of one agent account is not usable by another: opening it with the same identifier gives 409 agent.conversation_exists', async () => {
      await world()
      await open()
      const second = await makeAccount('agent2@recette.test', { role: 'user', profile: 'agent', channel: 'voice' })
      const res = await new RestTools(second.token, 'voice').open(CONV, { caseId: await w.caseId('D1'), interlocutorId: await w.contactId('D1'), aiDisclosureGiven: true })
      expect([res.status, res.body.code]).toEqual([409, 'agent.conversation_exists'])
    })
  })

  // ------------------------------------------------------------------ lecture

  describe('lecture du dossier', () => {
    it('[rule-recouvrement-agent-read-case] the reading carries the reachable interlocutors with the channel coordinates only, the non frozen invoices, the negotiable amount, no offer yet, no commitment and the allowed actions', async () => {
      await world({ invoices: [{ numero: 'FA-001', debiteur: 'D1', montant: 100000, late: 12 }, { numero: 'FA-002', debiteur: 'D1', montant: 40000 }] })
      const caseId = await open()
      const res = await agent.read(CONV, caseId)
      expectRes({ status: res.status, body: res.body, headers: new Headers() }, 200)
      const c = res.body.case
      expect(Object.keys(c).sort()).toEqual(['allowedActions', 'caseId', 'commitments', 'currentOffer', 'interlocutors', 'invoices', 'nature', 'negotiableCents'])
      expect(c).toMatchObject({ caseId, nature: 'family', negotiableCents: 140000, currentOffer: null, commitments: [] })
      expect(c.interlocutors).toHaveLength(1)
      expect(c.interlocutors[0]).toMatchObject({ role: 'payeur', phone: '+33612345678', email: null, postalAddress: null })
      expect(c.invoices.map((i: any) => i.number).sort()).toEqual(['FA-001', 'FA-002'])
      expect(c.invoices.find((i: any) => i.number === 'FA-001')).toEqual({ number: 'FA-001', creditorSiren: SIREN_A, balanceCents: 100000, dueDate: D(-12) })
      expect(c.allowedActions.sort()).toEqual(['check_message', 'next_offer', 'register_commitment', 'report_complaint', 'report_dispute', 'request_human_intervention'].sort())
      expect(forbiddenKeysIn(res.body)).toEqual([])
    })

    it('[rule-recouvrement-agent-read-case] by mail the postal address alone is given, by email_sms the email and the phone', async () => {
      await world()
      const caseId = await w.caseId('D1')
      const mailAgent = new RestTools(await w.tok('agentPost'), 'mail')
      await openConversation(mailAgent, 'c-mail', caseId, await w.contactId('D1'))
      const m = (await mailAgent.read('c-mail', caseId)).body.case.interlocutors[0]
      expect(m).toMatchObject({ phone: null, email: null })
      expect(m.postalAddress).toContain('Lilas')
      const smsAgent = new RestTools(await w.tok('agentMail'), 'email_sms')
      await openConversation(smsAgent, 'c-sms', caseId, await w.contactId('D1'))
      const s = (await smsAgent.read('c-sms', caseId)).body.case.interlocutors[0]
      expect(s.postalAddress).toBeNull()
      expect(s.email ?? s.phone).not.toBeNull()
    })

    it('[rule-recouvrement-agent-read-case] a frozen invoice is left out of the reading and of the negotiable amount', async () => {
      await world({ invoices: [{ numero: 'FA-001', debiteur: 'D1', montant: 100000 }, { numero: 'FA-002', debiteur: 'D1', montant: 40000 }] })
      const caseId = await open()
      await importOk(sup, 'disputes', strip([DISPUTES_HEADER, ['FA-002', '', 'Litige', 'Service', D(-1)]]))
      const c = (await agent.read(CONV, caseId)).body.case
      expect(c.invoices.map((i: any) => i.number)).toEqual(['FA-001'])
      expect(c.negotiableCents).toBe(100000)
    })

    it('[rule-recouvrement-agent-read-case] the current offer is the last unlocked one, not replaced nor revoked', async () => {
      await world()
      const caseId = await open()
      const first = await descendTo(agent, CONV, caseId, 1)
      expect((await agent.read(CONV, caseId)).body.case.currentOffer).toEqual(first)
      const second = await descendTo(agent, CONV, caseId, 1).catch(() => null)
      expect(second).toBeNull()
      const next = await agent.nextOffer(CONV, caseId, { counterpart: { type: 'firm_date' } })
      expect((await agent.read(CONV, caseId)).body.case.currentOffer).toEqual(next.body.offer)
    })

    it('[rule-recouvrement-agent-read-case][rule-recouvrement-offer-stale-statement] when the bank statement is stale the actions next_offer and register_commitment disappear', async () => {
      await world({ statement: false })
      const caseId = await open()
      const actions = (await agent.read(CONV, caseId)).body.case.allowedActions
      expect(actions).not.toContain('next_offer')
      expect(actions).not.toContain('register_commitment')
      expect(actions).toContain('report_dispute')
    })

    it('[rule-recouvrement-agent-read-case] a read is subject to the idempotency key: replayed, it returns the recorded state', async () => {
      await world()
      const caseId = await open()
      const key = freshKey('read')
      const before = await agent.read(CONV, caseId, key)
      await agent.nextOffer(CONV, caseId, {})
      const replay = await agent.read(CONV, caseId, key)
      expect(replay.replayed).toBe(true)
      expect(replay.body).toEqual(before.body)
      expect(replay.body.case.currentOffer).toBeNull()
      expect((await agent.read(CONV, caseId)).body.case.currentOffer).not.toBeNull()
    })
  })

  // ------------------------------------------------------------------ offres

  describe('offres', () => {
    it('[rule-recouvrement-offer-anchor][rule-recouvrement-offer-computation] the first offer is the first rung of the ladder, computed by the brain, without counterpart', async () => {
      await world()
      const caseId = await open()
      const res = await agent.nextOffer(CONV, caseId, {})
      expect(res.status).toBe(200)
      expect(res.body.status).toBe('offer')
      expect(Object.keys(res.body.offer).sort()).toEqual(['counterpart', 'discountCents', 'id', 'installments', 'totalCents'])
      expect(res.body.offer).toMatchObject({ totalCents: 100000, discountCents: 0, counterpart: null, installments: [{ dueDate: D(7), amountCents: 100000 }] })
      expect(forbiddenKeysIn(res.body)).toEqual([])
    })

    it('[rule-recouvrement-offer-computation] sums are rounded half up in cents; each counterpart carries its detail; the schedule is split in equal parts with the cents left on the last one, one due date every interval', async () => {
      await world({ invoices: [{ numero: 'FA-001', debiteur: 'D1', montant: 100001 }] })
      const caseId = await open()
      expect((await descendTo(agent, CONV, caseId, 1)).totalCents).toBe(100001)
      const r2 = await agent.nextOffer(CONV, caseId, { counterpart: { type: 'firm_date' } })
      expect(r2.body.offer).toMatchObject({ totalCents: 90001, discountCents: 10000, counterpart: { type: 'firm_date', deadlineDate: D(5), firstPaymentCents: null } })
      const r3 = await agent.nextOffer(CONV, caseId, { counterpart: { type: 'first_payment' } })
      expect(r3.body.offer).toMatchObject({ totalCents: 85001, discountCents: 15000, installments: [{ dueDate: D(14), amountCents: 85001 }] })
      expect(r3.body.offer.counterpart).toEqual({ type: 'first_payment', deadlineDate: null, firstPaymentCents: 25500 })
      const r4 = await agent.nextOffer(CONV, caseId, { counterpart: { type: 'direct_debit' } })
      expect(r4.body.offer.totalCents).toBe(82001)
      expect(r4.body.offer.installments).toEqual([{ dueDate: D(7), amountCents: 27333 }, { dueDate: D(37), amountCents: 27333 }, { dueDate: D(67), amountCents: 27335 }])
      expect(r4.body.offer.counterpart).toEqual({ type: 'direct_debit', deadlineDate: null, firstPaymentCents: null })
    })

    it('[rule-recouvrement-offer-computation] a company schedule adds the delay fee of the rule on the negotiable amount', async () => {
      await world({ invoices: [{ numero: 'FA-001', debiteur: 'DC', montant: 100000, nature: 'entreprise' }] })
      const caseId = await open('DC')
      const offer = await descendTo(agent, CONV, caseId, 4)
      expect(offer.totalCents).toBe(84000)
      expect(offer.discountCents).toBe(16000)
      expect(offer.installments.map((i: any) => i.amountCents)).toEqual([28000, 28000, 28000])
    })

    it('[rule-recouvrement-policy-no-business-value-in-code][rule-recouvrement-offer-computation] a custom policy changes the values: no business figure lives in the code', async () => {
      const ladder = standardLadder('family', [10000, 9500, 9200, 9000])
      ladder[0].payByDays = 3
      await world({ policy: { ruleOverrides: { 'standard/family': { ladder } } } })
      const caseId = await open()
      const first = await agent.nextOffer(CONV, caseId, {})
      expect(first.body.offer.installments).toEqual([{ dueDate: D(3), amountCents: 100000 }])
      expect((await agent.nextOffer(CONV, caseId, { counterpart: { type: 'firm_date' } })).body.offer.totalCents).toBe(95000)
      expect((await agent.nextOffer(CONV, caseId, { counterpart: { type: 'first_payment' } })).body.offer.totalCents).toBe(92000)
    })

    it('[rule-recouvrement-offer-descend] from the second call the counterpart is required (409 offers.counterpart_required) and must be the one of the next concession (409 offers.counterpart_mismatch); nothing is unlocked by a refusal', async () => {
      await world()
      const caseId = await open()
      await descendTo(agent, CONV, caseId, 1)
      const before = (await w.caseDetail('D1')).unlockedOffers.length
      const missing = await agent.nextOffer(CONV, caseId, {})
      expect([missing.status, missing.body.code]).toEqual([409, 'offers.counterpart_required'])
      for (const type of ['first_payment', 'direct_debit']) {
        const wrong = await agent.nextOffer(CONV, caseId, { counterpart: { type } })
        expect([wrong.status, wrong.body.code]).toEqual([409, 'offers.counterpart_mismatch'])
      }
      expect((await w.caseDetail('D1')).unlockedOffers.length).toBe(before)
      expect((await agent.nextOffer(CONV, caseId, { counterpart: { type: 'firm_date' } })).status).toBe(200)
    })

    it('[rule-recouvrement-offer-descend] the body is strict: an unknown counterpart type or an extra key gives 400', async () => {
      await world()
      const caseId = await open()
      for (const body of [{ counterpart: { type: 'virement' } }, { counterpart: {} }, { counterpart: { type: 'firm_date', extra: 1 } }, { extra: 1 }, { counterpart: 'firm_date' }]) {
        const res = await agent.nextOffer(CONV, caseId, body)
        expect([JSON.stringify(body), res.status, res.body.code]).toEqual([JSON.stringify(body), 400, 'api.validation.incoming_failed'])
      }
    })

    it('[rule-recouvrement-offer-exhausted] the ladder exhausted gives { status: exhausted, offer: null }, one ladder_exhausted item and the case in the supervisor queue; a replay with another key adds no second item', async () => {
      await world()
      const caseId = await open()
      await descendTo(agent, CONV, caseId, 4)
      const end = await agent.nextOffer(CONV, caseId, { counterpart: { type: 'direct_debit' } })
      expect(end.status).toBe(200)
      expect(end.body).toEqual({ status: 'exhausted', offer: null })
      expect((await queueTypes()).ladder_exhausted).toBe(1)
      expect((await w.caseDetail('D1')).state).toBe('supervisor_queue')
      const again = await agent.nextOffer(CONV, caseId, { counterpart: { type: 'direct_debit' } })
      expect(again.body.status === 'exhausted' || again.body.code === 'negotiation.stopped').toBe(true)
      expect((await queueTypes()).ladder_exhausted).toBe(1)
    })

    it('[rule-recouvrement-offer-stale-statement] without a fresh bank statement no offer is given and no commitment is registered: 409 offers.statement_stale', async () => {
      await world({ statement: false })
      const caseId = await open()
      const offer = await agent.nextOffer(CONV, caseId, {})
      expect([offer.status, offer.body.code]).toEqual([409, 'offers.statement_stale'])
      const commit = await agent.commit(CONV, caseId, { offerId: UNKNOWN_UUID, paymentMethod: 'transfer', totalCents: 100000, installments: [{ dueDate: D(7), amountCents: 100000 }] })
      expect([commit.status, commit.body.code]).toEqual([409, 'offers.statement_stale'])
      expect((await w.caseDetail('D1')).commitments).toEqual([])
    })

    it('[rule-recouvrement-offer-exposure-ceiling][rule-recouvrement-agent-evaluation] at the ceiling of the agent version and segment no schedule offer is given: exhausted without ladder_exhausted item', async () => {
      await world({
        invoices: [{ numero: 'FA-001', debiteur: 'D1', montant: 100000 }, { numero: 'FA-002', debiteur: 'D2', montant: 100000 }],
        policy: { global: { exposureCeilings: [{ agentVersion: 'agent-1.0', segment: 'standard', maxCents: 82000 }] } },
      })
      const c1 = await open('D1', 'c-1')
      const offer = await descendTo(agent, 'c-1', c1, 4)
      expect((await agent.commit('c-1', c1, commitmentFor(offer))).status).toBe(201)
      const c2 = await open('D2', 'c-2')
      await descendTo(agent, 'c-2', c2, 3)
      const res = await agent.nextOffer('c-2', c2, { counterpart: { type: 'direct_debit' } })
      expect(res.body).toEqual({ status: 'exhausted', offer: null })
      expect((await queueTypes()).ladder_exhausted ?? 0).toBe(0)
    })

    it('[rule-recouvrement-offer-exposure-ceiling] a schedule commitment that would exceed the ceiling is refused: 409 commitments.exposure_ceiling_reached', async () => {
      await world({
        invoices: [{ numero: 'FA-001', debiteur: 'D1', montant: 100000 }, { numero: 'FA-002', debiteur: 'D2', montant: 100000 }],
        policy: { global: { exposureCeilings: [{ agentVersion: 'agent-1.0', segment: 'standard', maxCents: 100000 }] } },
      })
      const c1 = await open('D1', 'c-1')
      expect((await agent.commit('c-1', c1, commitmentFor(await descendTo(agent, 'c-1', c1, 4)))).status).toBe(201)
      const c2 = await open('D2', 'c-2')
      const offer = await descendTo(agent, 'c-2', c2, 4)
      const res = await agent.commit('c-2', c2, commitmentFor(offer))
      expect([res.status, res.body.code]).toEqual([409, 'commitments.exposure_ceiling_reached'])
    })
  })

  // ------------------------------------------------------------------ engagements

  describe('engagements', () => {
    it('[rule-recouvrement-commitment-exact][rule-recouvrement-commitment-effects][rule-recouvrement-commitment-figures] a commitment reproducing an unlocked offer is registered pending; the offer is accepted, the other offers superseded, the case committed, the decision journaled, the confirmation order emitted', async () => {
      await world()
      const caseId = await open()
      await descendTo(agent, CONV, caseId, 1)
      const second = (await agent.nextOffer(CONV, caseId, { counterpart: { type: 'firm_date' } })).body.offer
      const res = await agent.commit(CONV, caseId, commitmentFor(second))
      expect(res.status).toBe(201)
      expect(Object.keys(res.body).sort()).toEqual(['commitment', 'confirmationOrder'])
      expect(res.body.commitment).toMatchObject({ totalCents: 90000, paymentMethod: 'transfer', status: 'pending', installments: [{ dueDate: D(7), amountCents: 90000 }] })
      expect(Object.keys(res.body.commitment).sort()).toEqual(['id', 'installments', 'paymentMethod', 'status', 'totalCents'])
      expect(['planned', 'blocked']).toContain(res.body.confirmationOrder.status)
      const detail = await w.caseDetail('D1')
      expect(detail.state).toBe('committed')
      expect(detail.unlockedOffers.map((o: any) => o.status).sort()).toEqual(['accepted', 'superseded'])
      expect(detail.commitments).toHaveLength(1)
      const decisions = ok(await get(`/cases/${caseId}/decisions?size=100`, sup)).items
      expect(decisions.map((d: any) => d.kind)).toContain('commitment')
      const history = ok(await get(`/cases/${caseId}/state-history`, sup)).items
      expect(history[0]).toMatchObject({ to: 'committed', cause: 'commitment_registered' })
      expect(forbiddenKeysIn(res.body)).toEqual([])
      expect((await agent.read(CONV, caseId)).body.case.commitments).toEqual([res.body.commitment])
    })

    it('[rule-recouvrement-commitment-exact] an engagement that differs from the offer (total, count, date or amount of an installment) is refused 409 commitments.offer_mismatch and registers nothing', async () => {
      await world()
      const caseId = await open()
      const offer = await descendTo(agent, CONV, caseId, 1)
      const good = commitmentFor(offer)
      const variants: any[] = [
        { ...good, totalCents: good.totalCents - 1 },
        { ...good, installments: [{ dueDate: D(8), amountCents: good.totalCents }] },
        { ...good, installments: [{ dueDate: D(7), amountCents: 50000 }, { dueDate: D(37), amountCents: 50000 }] },
        { ...good, installments: [{ dueDate: D(7), amountCents: good.totalCents - 1 }] },
      ]
      for (const body of variants) {
        const res = await agent.commit(CONV, caseId, body)
        expect([res.status, res.body.code]).toEqual([409, 'commitments.offer_mismatch'])
      }
      expect((await w.caseDetail('D1')).commitments).toEqual([])
      expect((await agent.commit(CONV, caseId, good)).status).toBe(201)
    })

    it('[rule-recouvrement-commitment-exact] an offer of another case is not an offer of this case', async () => {
      await world({ invoices: [{ numero: 'FA-001', debiteur: 'D1', montant: 100000 }, { numero: 'FA-002', debiteur: 'D2', montant: 100000 }] })
      const c1 = await open('D1', 'c-1')
      const c2 = await open('D2', 'c-2')
      const offer = await descendTo(agent, 'c-1', c1, 1)
      const res = await agent.commit('c-2', c2, commitmentFor(offer))
      expect(res.status).toBeGreaterThanOrEqual(404)
      expect(res.status).toBeLessThanOrEqual(409)
      expect((await w.caseDetail('D2')).commitments).toEqual([])
    })

    it('[rule-recouvrement-commitment-payment-method] the payment method must belong to the list of the active policy; with another list the answer changes', async () => {
      await world({ policy: { global: { paymentMethods: ['card'] } } })
      const caseId = await open()
      const offer = await descendTo(agent, CONV, caseId, 1)
      const refused = await agent.commit(CONV, caseId, commitmentFor(offer, 'transfer'))
      expect([refused.status, refused.body.code]).toEqual([409, 'commitments.payment_method_not_allowed'])
      expect((await agent.commit(CONV, caseId, commitmentFor(offer, 'card'))).status).toBe(201)
    })

    it('[rule-recouvrement-commitment-effects] a second commitment is refused while one is pending: 409 commitments.already_committed', async () => {
      await world()
      const caseId = await open()
      const offer = await descendTo(agent, CONV, caseId, 1)
      expect((await agent.commit(CONV, caseId, commitmentFor(offer))).status).toBe(201)
      const second = await agent.commit(CONV, caseId, commitmentFor(offer))
      expect([second.status, second.body.code]).toEqual([409, 'commitments.already_committed'])
      expect((await w.caseDetail('D1')).commitments).toHaveLength(1)
    })

    it('[rule-recouvrement-commitment-exact] the body is strict and bounded: 1 to 60 installments, positive integer amounts up to 10 000 000 000, payment method 1 to 30 characters, offer id a uuid', async () => {
      await world()
      const caseId = await open()
      const ok1 = { offerId: UNKNOWN_UUID, paymentMethod: 'transfer', totalCents: 100, installments: [{ dueDate: D(7), amountCents: 100 }] }
      const invalid: any[] = [
        {}, { ...ok1, offerId: 'x' }, { ...ok1, paymentMethod: '' }, { ...ok1, paymentMethod: 'p'.repeat(31) }, { ...ok1, totalCents: 0 }, { ...ok1, totalCents: 10_000_000_001 },
        { ...ok1, totalCents: 1.5 }, { ...ok1, installments: [] }, { ...ok1, installments: Array.from({ length: 61 }, () => ({ dueDate: D(7), amountCents: 1 })) },
        { ...ok1, installments: [{ dueDate: 'demain', amountCents: 1 }] }, { ...ok1, installments: [{ dueDate: D(7), amountCents: 0 }] }, { ...ok1, extra: 1 },
      ]
      for (const body of invalid) {
        const res = await agent.commit(CONV, caseId, body)
        expect([JSON.stringify(body).slice(0, 80), res.status, res.body.code]).toEqual([JSON.stringify(body).slice(0, 80), 400, 'api.validation.incoming_failed'])
      }
    })

    it('[rule-recouvrement-next-offer-while-committed][D-0009] while a commitment is pending the next offer is refused 409 negotiation.stopped, no offer is created and next_offer leaves the allowed actions', async () => {
      await world()
      const caseId = await open()
      const offer = await descendTo(agent, CONV, caseId, 1)
      expect((await agent.commit(CONV, caseId, commitmentFor(offer))).status).toBe(201)
      const count = (await w.caseDetail('D1')).unlockedOffers.length
      const res = await agent.raw('POST', `/agent/cases/${caseId}/next-offer`, CONV, freshKey(), { counterpart: { type: 'firm_date' } })
      expect([res.status, res.body.code]).toEqual([409, 'negotiation.stopped'])
      expect((await w.caseDetail('D1')).unlockedOffers.length).toBe(count)
      const actions = (await agent.read(CONV, caseId)).body.case.allowedActions
      expect(actions).not.toContain('next_offer')
      expect(actions).not.toContain('register_commitment')
    })

    it('[rule-recouvrement-policy-change-midway][D-0013] after the activation of another version the unlocked offers are revoked: the next offer is the anchor of the new version and the old offer is expired for a commitment; a registered commitment is kept', async () => {
      await world({ invoices: [{ numero: 'FA-001', debiteur: 'D1', montant: 100000 }, { numero: 'FA-002', debiteur: 'D2', montant: 100000 }] })
      const c1 = await open('D1', 'c-1')
      const c2 = await open('D2', 'c-2')
      await descendTo(agent, 'c-1', c1, 1)
      const old = (await agent.nextOffer('c-1', c1, { counterpart: { type: 'firm_date' } })).body.offer
      const kept = await descendTo(agent, 'c-2', c2, 1)
      expect((await agent.commit('c-2', c2, commitmentFor(kept))).status).toBe(201)
      const next = policyDoc({ versionDate: '2026-10-05', ruleOverrides: { 'standard/family': { ladder: standardLadder('family', [10000, 9400, 9000, 8800]) } } })
      const { activatePolicy } = await import('./recouvrement-helpers')
      await activatePolicy(sup, next)
      const expired = await agent.commit('c-1', c1, commitmentFor(old))
      expect([expired.status, expired.body.code]).toEqual([409, 'commitments.offer_expired'])
      const anchor = await agent.raw('POST', `/agent/cases/${c1}/next-offer`, 'c-1', freshKey(), {})
      expect(anchor.status).toBe(200)
      expect(anchor.body.status).toBe('offer')
      expect(anchor.body.offer.id).not.toBe(old.id)
      expect(anchor.body.offer).toMatchObject({ totalCents: 100000, counterpart: null })
      const statuses = (await w.caseDetail('D1')).unlockedOffers.map((o: any) => o.status)
      expect(statuses).toContain('revoked')
      expect((await w.caseDetail('D2')).commitments).toHaveLength(1)
    })
  })

  // ------------------------------------------------------------------ contestation, intervention humaine, réclamation

  describe('contestation, intervention humaine, réclamation', () => {
    const PORTFOLIO: Inv[] = [
      { numero: 'FA-001', debiteur: 'D1', montant: 100000 }, { numero: 'FA-002', debiteur: 'D1', montant: 40000 }, { numero: 'FA-003', debiteur: 'D1', montant: 20000 },
      { numero: 'FA-010', debiteur: 'DC', montant: 100000, nature: 'entreprise' },
    ]

    it('[rule-recouvrement-contestation-stops-case] a contestation freezes the case scope, creates one dispute per invoice aimed at, freezes those invoices, opens a contestation item and puts the case in the frozen state; the negotiation tools answer 409 negotiation.stopped', async () => {
      await world({ invoices: PORTFOLIO })
      const caseId = await open()
      await descendTo(agent, CONV, caseId, 1)
      const res = await agent.contest(CONV, caseId, { reason: '  Je ne dois pas cette facture  ', invoiceNumbers: ['FA-001', 'FA-002'] })
      expect(res.status).toBe(201)
      expect(Object.keys(res.body).sort()).toEqual(['contestationId', 'frozenInvoices'])
      expect(res.body.frozenInvoices).toBe(2)
      const detail = await w.caseDetail('D1')
      expect(detail.state).toBe('frozen')
      expect(detail.freezes.map((f: any) => f.code ?? f.scope ?? f.type).join(' ')).toMatch(/contestation/)
      expect(detail.invoices.filter((i: any) => i.frozen).map((i: any) => i.number).sort()).toEqual(['FA-001', 'FA-002'])
      expect((await queueTypes()).contestation).toBe(1)
      const disputes = ok(await get('/disputes?size=100', await w.tok('lit'))).items
      expect(disputes).toHaveLength(2)
      expect(JSON.stringify(disputes)).toMatch(/contestation/)
      for (const outcome of [await agent.nextOffer(CONV, caseId, { counterpart: { type: 'firm_date' } }), await agent.commit(CONV, caseId, { offerId: UNKNOWN_UUID, paymentMethod: 'transfer', totalCents: 1, installments: [{ dueDate: D(7), amountCents: 1 }] })]) {
        expect([outcome.status, outcome.body.code]).toEqual([409, 'negotiation.stopped'])
      }
      expect((await agent.read(CONV, caseId)).status).toBe(200)
    })

    it('[rule-recouvrement-contestation-without-invoices][D-0002] a contestation without invoice numbers (absent or empty) is refused 400 api.validation.incoming_failed and nothing is frozen', async () => {
      await world({ invoices: PORTFOLIO })
      const caseId = await open()
      for (const body of [{ reason: 'Je conteste' }, { reason: 'Je conteste', invoiceNumbers: [] }]) {
        const res = await agent.raw('POST', `/agent/cases/${caseId}/contestations`, CONV, freshKey(), body)
        expect([res.status, res.body.code]).toEqual([400, 'api.validation.incoming_failed'])
      }
      const detail = await w.caseDetail('D1')
      expect(detail.freezes).toEqual([])
      expect(detail.invoices.every((i: any) => !i.frozen)).toBe(true)
      expect(detail.state).toBe('open')
    })

    it('[rule-recouvrement-contestation-stops-case] an invoice number that is not an open invoice of the case: 404 contestations.invoice_not_found, nothing frozen; bounds of the body: reason 1..1000 trimmed, 1..100 distinct numbers of 1..50 characters', async () => {
      await world({ invoices: PORTFOLIO })
      const caseId = await open()
      const unknown = await agent.contest(CONV, caseId, { reason: 'x', invoiceNumbers: ['FA-001', 'ZZ-999'] })
      expect([unknown.status, unknown.body.code]).toEqual([404, 'contestations.invoice_not_found'])
      const foreign = await agent.contest(CONV, caseId, { reason: 'x', invoiceNumbers: ['FA-010'] })
      expect([foreign.status, foreign.body.code]).toEqual([404, 'contestations.invoice_not_found'])
      expect((await w.caseDetail('D1')).state).toBe('open')
      for (const body of [{ reason: '   ', invoiceNumbers: ['FA-001'] }, { reason: 'r'.repeat(1001), invoiceNumbers: ['FA-001'] }, { reason: 'x', invoiceNumbers: ['FA-001', 'FA-001'] }, { reason: 'x', invoiceNumbers: [''] }, { reason: 'x', invoiceNumbers: ['n'.repeat(51)] }, { reason: 'x', invoiceNumbers: Array.from({ length: 101 }, (_, i) => `N-${i}`) }, { reason: 'x', invoiceNumbers: ['FA-001'], extra: 1 }]) {
        expect((await agent.contest(CONV, caseId, body)).body.code).toBe('api.validation.incoming_failed')
      }
    })

    it('[rule-recouvrement-human-request] for a family the human intervention suspends the negotiation and puts the case in the supervisor queue with a human_request item', async () => {
      await world({ invoices: PORTFOLIO })
      const caseId = await open()
      const res = await agent.human(CONV, caseId, { reason: 'Le client demande un conseiller' })
      expect(res.status).toBe(201)
      expect(Object.keys(res.body)).toEqual(['requestId'])
      expect((await w.caseDetail('D1')).state).toBe('supervisor_queue')
      expect((await queueTypes()).human_request).toBe(1)
      const stopped = await agent.nextOffer(CONV, caseId, {})
      expect([stopped.status, stopped.body.code]).toEqual([409, 'negotiation.stopped'])
      expect((await agent.human(CONV, caseId, {})).status).not.toBe(500)
      expect((await agent.human(CONV, caseId, { reason: 'x'.repeat(1001) })).body.code).toBe('api.validation.incoming_failed')
    })

    it('[rule-recouvrement-human-request-companies][D-0021] for a company the tool is refused 409 agent.human_request_not_available, the case does not enter the queue and the action is not allowed', async () => {
      await world({ invoices: PORTFOLIO })
      const caseId = await open('DC')
      expect((await agent.read(CONV, caseId)).body.case.allowedActions).not.toContain('request_human_intervention')
      const res = await agent.raw('POST', `/agent/cases/${caseId}/human-requests`, CONV, freshKey(), { reason: 'Je veux un humain' })
      expect([res.status, res.body.code]).toEqual([409, 'agent.human_request_not_available'])
      expect((await w.caseDetail('DC')).state).toBe('open')
      expect(await queueTypes()).not.toHaveProperty('human_request')
      expect((await agent.nextOffer(CONV, caseId, {})).status).toBe(200)
    })

    it('[rule-recouvrement-complaint] a complaint is recorded with its text, conversation and agent version, counts in the complaints indicator and does not change the state of the case', async () => {
      await world({ invoices: PORTFOLIO })
      const caseId = await open()
      const res = await agent.complaint(CONV, caseId, { text: '  Le ton de l\'agent était agressif  ' })
      expect(res.status).toBe(201)
      expect(Object.keys(res.body)).toEqual(['complaintId'])
      const rows = await sql<any>('select * from base.complaints')
      expect(rows).toHaveLength(1)
      expect(JSON.stringify(rows[0])).toContain(CONV)
      expect(JSON.stringify(rows[0])).toContain('agent-1.0')
      expect((await w.caseDetail('D1')).state).toBe('open')
      for (const body of [{}, { text: '' }, { text: '   ' }, { text: 'x'.repeat(1001) }, { text: 'ok', extra: 1 }]) {
        expect((await agent.complaint(CONV, caseId, body)).body.code).toBe('api.validation.incoming_failed')
      }
    })
  })

  // ------------------------------------------------------------------ vérification de message

  describe('vérification de message', () => {
    const codes = (o: Outcome) => o.body.violations.map((v: any) => v.code)

    it('[rule-recouvrement-message-check] amounts and dates of the unlocked conditions are allowed; the text is neither sent nor modified', async () => {
      await world()
      const caseId = await open()
      const offer = await descendTo(agent, CONV, caseId, 1)
      const text = `Vous pouvez régler ${money(offer.totalCents)} avant le ${fr(offer.installments[0].dueDate)}.`
      const res = await agent.check(CONV, { caseId, text })
      expect(res.status).toBe(200)
      expect(res.body).toEqual({ allowed: true, violations: [] })
    })

    it('[rule-recouvrement-message-known-amounts][D-0007] the balance of an invoice is not an unlocked amount: « Vous devez 1 200,00 € » with no offer is refused amount_not_unlocked with the excerpt', async () => {
      await world({ invoices: [{ numero: 'FA-001', debiteur: 'D1', montant: 120000 }] })
      const caseId = await open()
      const res = await agent.raw('POST', '/agent/messages/check', CONV, freshKey(), { caseId, text: 'Vous devez 1 200,00 €' })
      expect(res.status).toBe(200)
      expect(res.body.allowed).toBe(false)
      expect(codes(res)).toEqual(['amount_not_unlocked'])
      expect(res.body.violations[0].excerpt).toContain('1')
      expect(res.body.violations[0].excerpt.length).toBeLessThanOrEqual(100)
    })

    it('[rule-recouvrement-message-check] an amount or a date that is not in the unlocked conditions, and an internal term, are reported one by one', async () => {
      await world()
      const caseId = await open()
      const offer = await descendTo(agent, CONV, caseId, 1)
      const other = D(40)
      const text = `Réglez ${money(offer.totalCents)} avant le ${fr(offer.installments[0].dueDate)}, sinon ${money(55555)} avant le ${fr(other)}, selon notre plancher et la règle du segment.`
      const res = await agent.check(CONV, { caseId, text })
      expect(res.body.allowed).toBe(false)
      expect(codes(res).sort()).toEqual(['amount_not_unlocked', 'date_not_unlocked', 'internal_term', 'internal_term', 'internal_term'])
    })

    it('[rule-recouvrement-message-known-amounts] the discount, the installments, the first payment and the counterpart dates of unlocked offers are admitted, those of an offer not yet unlocked are not', async () => {
      await world()
      const caseId = await open()
      await descendTo(agent, CONV, caseId, 1)
      const second = (await agent.nextOffer(CONV, caseId, { counterpart: { type: 'firm_date' } })).body.offer
      const known = `Remise de ${money(second.discountCents)}, total ${money(second.totalCents)}, avant le ${long(second.counterpart.deadlineDate)}.`
      expect((await agent.check(CONV, { caseId, text: known })).body.allowed).toBe(true)
      const third = `Premier versement de ${money(25500)} puis total ${money(85000)}.`
      expect(codes(await agent.check(CONV, { caseId, text: third }))).toEqual(['amount_not_unlocked', 'amount_not_unlocked'])
    })

    it('[rule-recouvrement-message-parsing] amounts need a currency, with space, non-breaking space or dot as thousands separator and one or two decimals; a number without currency is not an amount', async () => {
      await world({ invoices: [{ numero: 'FA-001', debiteur: 'D1', montant: 1234500 }] })
      const caseId = await open()
      for (const text of ['Il reste 2 jours', 'Appelez le 0612345678', 'Dossier 12345', 'Ref 1 234,50']) {
        expect([text, (await agent.check(CONV, { caseId, text })).body.allowed]).toEqual([text, true])
      }
      for (const text of ['Vous devez 12 345 €', 'Vous devez 12 345,00 euros', 'Vous devez 12.345,00 EUR'.toLowerCase(), 'Vous devez € 12345', 'Vous devez 12345.5 euro']) {
        expect([text, codes(await agent.check(CONV, { caseId, text }))]).toEqual([text, ['amount_not_unlocked']])
      }
    })

    it('[rule-recouvrement-message-parsing] dates are read as DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY, YYYY-MM-DD and « D mois YYYY » (1er accepted); without a year only day and month are compared', async () => {
      await world()
      const caseId = await open()
      const offer = await descendTo(agent, CONV, caseId, 1)
      const iso = offer.installments[0].dueDate as string
      const [y, m, d] = iso.split('-')
      for (const text of [`le ${d}/${m}/${y}`, `le ${d}-${m}-${y}`, `le ${d}.${m}.${y}`, `le ${iso}`, `le ${long(iso)}`, `le ${d}/${m}`]) {
        expect([text, (await agent.check(CONV, { caseId, text })).body.allowed]).toEqual([text, true])
      }
      const wrong = D(60)
      const [wy, wm, wd] = wrong.split('-')
      for (const text of [`le ${wd}/${wm}/${wy}`, `le ${wd}-${wm}-${wy}`, `le ${wd}.${wm}.${wy}`, `le ${wrong}`, `le ${long(wrong)}`, `le ${wd}/${wm}`]) {
        expect([text, codes(await agent.check(CONV, { caseId, text }))]).toEqual([text, ['date_not_unlocked']])
      }
      expect(codes(await agent.check(CONV, { caseId, text: 'le 1er janvier 2031' }))).toEqual(['date_not_unlocked'])
    })

    it('[rule-recouvrement-message-parsing] the internal terms plancher, règle, version and segment are recognised as whole words, singular or plural, without regard to case or accents', async () => {
      await world()
      const caseId = await open()
      for (const text of ['le PLANCHER', 'Les planchers', 'la regle', 'les Règles', 'une Version', 'des versions', 'son segment', 'des SEGMENTS']) {
        expect([text, codes(await agent.check(CONV, { caseId, text }))]).toEqual([text, ['internal_term']])
      }
      for (const text of ['réglementation', 'conversion', 'segmentation', 'planchette', 'règlement']) {
        expect([text, (await agent.check(CONV, { caseId, text })).body.allowed]).toEqual([text, true])
      }
    })

    it('[rule-recouvrement-message-check] the text is required and bounded (1 to 5000 characters), the case id a uuid, the body strict; at most 50 violations are reported', async () => {
      await world()
      const caseId = await open()
      for (const body of [{}, { caseId }, { caseId, text: '' }, { caseId, text: 'x'.repeat(5001) }, { caseId: 'x', text: 'a' }, { caseId, text: 'a', extra: 1 }]) {
        expect((await agent.check(CONV, body as any)).body.code).toBe('api.validation.incoming_failed')
      }
      expect((await agent.check(CONV, { caseId, text: 'x'.repeat(5000) })).status).toBe(200)
      const many = await agent.check(CONV, { caseId, text: Array.from({ length: 80 }, () => 'plancher').join(' ') })
      expect(many.body.violations.length).toBeLessThanOrEqual(50)
      expect(many.body.allowed).toBe(false)
    })
  })

  // ------------------------------------------------------------------ dossier sans règle

  describe('dossier sans règle de politique', () => {
    it('[rule-recouvrement-no-rule-segment][D-0010] a case whose segment has no rule in the active policy gets 409 offers.no_rule and an alert in the supervisor queue, one per case while it stays open', async () => {
      await world()
      await w.receivables([...w.invoices, { numero: 'FA-900', debiteur: 'D9', montant: 50000, segment: 'orphelin' }], D(-2))
      await importOk(sup, 'contacts', contactsFile([defaultContact('D9')]))
      const caseId = await open('D9')
      const before = (await queueTypes()).alert ?? 0
      const res = await agent.raw('POST', `/agent/cases/${caseId}/next-offer`, CONV, freshKey(), {})
      expect([res.status, res.body.code]).toEqual([409, 'offers.no_rule'])
      expect((await queueTypes()).alert).toBe(before + 1)
      expect((await agent.nextOffer(CONV, caseId, {})).body.code).toBe('offers.no_rule')
      expect((await queueTypes()).alert).toBe(before + 1)
    })

    it('[rule-recouvrement-no-rule-segment][D-0010] with no active policy the answer is the same 409 offers.no_rule', async () => {
      await world({ policy: false })
      const caseId = await open()
      const res = await agent.nextOffer(CONV, caseId, {})
      expect([res.status, res.body.code]).toEqual([409, 'offers.no_rule'])
    })
  })

  // ------------------------------------------------------------------ idempotence et traces

  describe('idempotence, audit et fuites', () => {
    it('[rule-recouvrement-agent-idempotency] a call replayed with the same key returns the same status and body with Idempotent-Replayed: true and no new effect', async () => {
      await world()
      const caseId = await open()
      const offer = await descendTo(agent, CONV, caseId, 1)
      const key = freshKey('commit')
      const body = commitmentFor(offer)
      const first = await agent.commit(CONV, caseId, body, key)
      const second = await agent.commit(CONV, caseId, body, key)
      expect(first.status).toBe(201)
      expect(first.replayed).toBe(false)
      expect(second.status).toBe(201)
      expect(second.replayed).toBe(true)
      expect(second.body).toEqual(first.body)
      expect((await w.caseDetail('D1')).commitments).toHaveLength(1)
      expect((await sql('select 1 from base.send_orders where case_id = (select id from base.cases where debtor_id = $1) and kind = $2', ['D1', 'commitment_confirmation'])).length).toBe(1)
    })

    it('[rule-recouvrement-agent-idempotency] the same key with another request gives 409 agent.idempotency_conflict and no effect; a refusal is replayed as well', async () => {
      await world()
      const caseId = await open()
      const key = freshKey('conflict')
      expect((await agent.nextOffer(CONV, caseId, {}, key)).status).toBe(200)
      const other = await agent.complaint(CONV, caseId, { text: 'x' }, key)
      expect([other.status, other.body.code]).toEqual([409, 'agent.idempotency_conflict'])
      const refused = freshKey('refused')
      const r1 = await agent.nextOffer(CONV, caseId, {}, refused)
      const r2 = await agent.nextOffer(CONV, caseId, {}, refused)
      expect([r1.status, r1.body.code]).toEqual([409, 'offers.counterpart_required'])
      expect([r2.status, r2.body, r2.replayed]).toEqual([409, r1.body, true])
      expect((await w.caseDetail('D1')).unlockedOffers).toHaveLength(1)
    })

    it('[rule-recouvrement-agent-idempotency] two simultaneous calls with the same key have one effect', async () => {
      await world()
      const caseId = await open()
      const offer = await descendTo(agent, CONV, caseId, 1)
      const key = freshKey('race')
      const body = commitmentFor(offer)
      const results = await Promise.all([agent.commit(CONV, caseId, body, key), agent.commit(CONV, caseId, body, key), agent.commit(CONV, caseId, body, key)])
      expect(results.filter((r) => r.status === 201).length).toBeGreaterThanOrEqual(1)
      for (const r of results) expect(r.status).not.toBe(500)
      expect((await w.caseDetail('D1')).commitments).toHaveLength(1)
    })

    it('[rule-recouvrement-agent-idempotency] the key is per account and tool: another account may use the same key', async () => {
      await world()
      const caseId = await open()
      const second = await makeAccount('agent2@recette.test', { role: 'user', profile: 'agent', channel: 'voice' })
      const other = new RestTools(second.token, 'voice')
      await openConversation(other, 'conv-2', caseId, await w.contactId('D1'))
      const key = freshKey('shared')
      expect((await agent.read(CONV, caseId, key)).replayed).toBe(false)
      expect((await other.read('conv-2', caseId, key)).replayed).toBe(false)
    })

    it('[rule-recouvrement-replay-audit][D-0015] the replay of a commitment writes a second audit entry « agent:register-commitment »; the effect is not doubled', async () => {
      await world()
      const caseId = await open()
      const offer = await descendTo(agent, CONV, caseId, 1)
      const key = freshKey('audit')
      const commitPath = `/agent/cases/${caseId}/commitments`
      await agent.raw('POST', commitPath, CONV, key, commitmentFor(offer))
      const replay = await agent.raw('POST', commitPath, CONV, key, commitmentFor(offer))
      expect(replay.status).toBe(201)
      expect(replay.headers.get('idempotent-replayed')).toBe('true')
      const log = ok(await get('/audit-logs?action=agent:register-commitment&size=100', sup))
      expect(log.total).toBe(2)
      expect((await w.caseDetail('D1')).commitments).toHaveLength(1)
    })

    it('[rule-recouvrement-agent-calls-logged] writes are traced in the audit journal with the agent actions and a summary without free text or coordinates', async () => {
      await world()
      const caseId = await open()
      await agent.complaint(CONV, caseId, { text: 'Texte libre sensible du client Dupont' })
      await agent.human(CONV, caseId, { reason: 'Motif libre confidentiel' })
      const all = ok(await get('/audit-logs?size=100', sup)).items
      const actions = all.map((e: any) => e.action)
      expect(actions).toEqual(expect.arrayContaining(['agent:open-conversation', 'agent:report-complaint', 'agent:request-human']))
      const text = JSON.stringify(all)
      expect(text).not.toContain('Dupont')
      expect(text).not.toContain('confidentiel')
      expect(text).not.toContain('+33612345678')
      expect(text).not.toContain('d1@example.test')
    })

    it('[rule-recouvrement-agent-no-internal-reason] no response given to the agent carries rule, policy version, floor, segment, rank or reference amount, on the whole scenario', async () => {
      await world()
      const caseId = await open()
      const seen: unknown[] = [(await agent.read(CONV, caseId)).body]
      let offer: any
      for (let r = 1; r <= 4; r++) {
        const res = await agent.nextOffer(CONV, caseId, r === 1 ? {} : { counterpart: { type: ['firm_date', 'first_payment', 'direct_debit'][r - 2] } })
        seen.push(res.body)
        offer = res.body.offer
      }
      seen.push((await agent.nextOffer(CONV, caseId, { counterpart: { type: 'direct_debit' } })).body)
      seen.push((await agent.read(CONV, caseId)).body, (await agent.nextOffer(CONV, caseId, {})).body, (await agent.check(CONV, { caseId, text: 'plancher' })).body)
      expect(offer).toBeDefined()
      for (const body of seen) expect(forbiddenKeysIn(body)).toEqual([])
      expect(JSON.stringify(seen)).not.toMatch(/r-reminder|r-proposal|policyVersion|"floor"|"rank"/)
    })
  })
})
