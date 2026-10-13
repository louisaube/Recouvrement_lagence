import { resetData, closePool, sql } from './harness'
import {
  World, get, http, ok, setupWorld, daysFromToday, RestTools, McpTools, MCP_HEADERS, openConversation, commitmentFor, freshKey, normalize,
  forbiddenKeysIn, UNKNOWN_UUID, makeAccount, DISPUTES_HEADER,
} from './recouvrement-helpers'
import type { Tools, Outcome } from './recouvrement-helpers'

// Version v1-cerveau-recouvrement : serveur MCP (POST /mcp), simple enveloppe des mêmes services que le REST.
// Le client du SDK n'est pas utilisé : la recette parle JSON-RPC brut sur HTTP, ce que tout client MCP envoie.

const D = (n: number) => daysFromToday(n)
const TOOLS = ['open_conversation', 'read_case', 'next_offer', 'register_commitment', 'report_dispute', 'request_human_intervention', 'report_complaint', 'check_message']

describe('Recouvrement - serveur MCP', () => {
  let w: World
  let mcp: McpTools

  beforeEach(async () => {
    await resetData()
    w = new World()
  })
  afterAll(async () => {
    await closePool()
  })

  async function world() {
    await setupWorld({
      invoices: [
        { numero: 'FA-001', debiteur: 'D1', montant: 100000 }, { numero: 'FA-002', debiteur: 'D2', montant: 100000 }, { numero: 'FA-003', debiteur: 'D2', montant: 30000 },
        { numero: 'FA-004', debiteur: 'D3', montant: 100000 }, { numero: 'FA-005', debiteur: 'DC', montant: 100000, nature: 'entreprise' },
      ],
    }, w)
    mcp = new McpTools(await w.tok('agent'), 'voice')
  }

  describe('transport', () => {
    it('[rule-recouvrement-agent-two-transports] POST /mcp without a token answers 401; another profile, a plain user and an admin without profile answer 403', async () => {
      await world()
      const body = { jsonrpc: '2.0', id: 1, method: 'tools/list' }
      expect((await http('POST', '/mcp', undefined, body, MCP_HEADERS)).status).toBe(401)
      for (const who of ['sup', 'lit', 'ind', 'user', 'admin'] as const) {
        const res = await http('POST', '/mcp', await w.tok(who), body, MCP_HEADERS)
        expect([who, res.status]).toEqual([who, 403])
      }
    })

    it('[rule-recouvrement-mcp-405-after-auth][rule-recouvrement-agent-two-transports] GET /mcp and DELETE /mcp answer 405 once authenticated as an agent (401 without a token)', async () => {
      await world()
      for (const method of ['GET', 'DELETE']) {
        expect([method, (await http(method, '/mcp', undefined, undefined, MCP_HEADERS)).status]).toEqual([method, 401])
        expect([method, (await http(method, '/mcp', await w.tok('agent'), undefined, MCP_HEADERS)).status]).toEqual([method, 405])
      }
    })

    it('[rule-recouvrement-agent-two-transports] initialize answers with the protocol version and the tools capability; tools/list gives the eight tools with an input schema each', async () => {
      await world()
      const init = await mcp.rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'recette', version: '1.0.0' } })
      expect(init.status).toBe(200)
      expect(init.body.result.capabilities).toHaveProperty('tools')
      expect(typeof init.body.result.protocolVersion).toBe('string')
      const list = await mcp.rpc('tools/list')
      expect(list.status).toBe(200)
      const tools = list.body.result.tools
      expect(tools.map((t: any) => t.name).sort()).toEqual([...TOOLS].sort())
      for (const t of tools) {
        expect(t.inputSchema.type).toBe('object')
        expect(typeof t.description).toBe('string')
      }
      const required = (name: string) => tools.find((t: any) => t.name === name).inputSchema.required ?? []
      for (const name of TOOLS) expect(required(name)).toEqual(expect.arrayContaining(['agentVersion', 'channel', 'conversationId', 'idempotencyKey']))
      expect(required('read_case')).toContain('caseId')
      expect(required('open_conversation')).toEqual(expect.arrayContaining(['caseId', 'interlocutorId', 'aiDisclosureGiven']))
    })

    it('[rule-recouvrement-agent-two-transports] an unknown tool, an unknown method and a malformed JSON-RPC body never give a server error', async () => {
      await world()
      const unknownTool = await mcp.rpc('tools/call', { name: 'delete_everything', arguments: {} })
      expect(unknownTool.status).toBeLessThan(500)
      expect(unknownTool.body.error !== undefined || unknownTool.body.result?.isError === true).toBe(true)
      const unknownMethod = await mcp.rpc('resources/destroy')
      expect(unknownMethod.status).toBeLessThan(500)
      for (const body of [{}, { jsonrpc: '1.0' }, [], 'texte', { jsonrpc: '2.0', method: 'tools/call', id: 1, params: 'x' }, { jsonrpc: '2.0', method: 'tools/call', id: 1, params: { name: 5 } }]) {
        const res = await http('POST', '/mcp', await w.tok('agent'), body as any, MCP_HEADERS)
        expect([JSON.stringify(body), res.status < 500]).toEqual([JSON.stringify(body), true])
      }
    })
  })

  describe('même service, mêmes contrôles', () => {
    it('[rule-recouvrement-agent-two-transports] a refusal is an error result: isError true and structuredContent { status, code, message } identical to the REST body', async () => {
      await world()
      const caseId = await w.caseId('D1')
      const interlocutorId = await w.contactId('D1')
      const rest = new RestTools(await w.tok('agent'), 'voice')
      const args = { caseId, interlocutorId, aiDisclosureGiven: false }
      const viaRest = await rest.open('c-1', args, 'k-same-1')
      const raw = await mcp.rpc('tools/call', { name: 'open_conversation', arguments: { ...args, agentVersion: 'agent-1.0', channel: 'voice', conversationId: 'c-1', idempotencyKey: 'k-same-2' } })
      expect(raw.status).toBe(200)
      expect(raw.body.result.isError).toBe(true)
      expect(raw.body.result.structuredContent).toEqual(viaRest.body)
      expect(Object.keys(raw.body.result.structuredContent).sort()).toEqual(['code', 'message', 'status'])
      expect(raw.body.result.structuredContent).toMatchObject({ status: 403, code: 'agent.ai_disclosure_required' })
    })

    it('[rule-recouvrement-agent-context][rule-recouvrement-agent-two-transports] a missing or malformed context argument gives agent.missing_context, the channel of the account is checked, and the arguments are validated like the REST bodies', async () => {
      await world()
      const caseId = await w.caseId('D1')
      const base = { caseId, agentVersion: 'agent-1.0', channel: 'voice', conversationId: 'c-1', idempotencyKey: 'k-1' }
      const call = async (args: Record<string, unknown>, name = 'read_case') => {
        const r = await mcp.rpc('tools/call', { name, arguments: args })
        return r.body.result?.structuredContent ?? r.body
      }
      for (const key of ['agentVersion', 'channel', 'conversationId', 'idempotencyKey']) {
        const { [key]: _removed, ...rest } = base as Record<string, unknown>
        expect([key, (await call(rest)).code]).toEqual([key, 'agent.missing_context'])
      }
      expect((await call({ ...base, idempotencyKey: 'avec espace' })).code).toBe('agent.missing_context')
      expect((await call({ ...base, channel: 'mail' })).code).toBe('agent.channel_mismatch')
      expect((await call({ ...base, caseId: 'pas-un-uuid' })).code).toBe('api.validation.incoming_failed')
      expect((await call({ ...base, extra: 1 })).code).toBe('api.validation.incoming_failed')
      expect((await mcp.complaint('c-1', caseId, { text: '' })).body.code).toBe('api.validation.incoming_failed')
    })

    it('[rule-recouvrement-agent-two-transports][rule-recouvrement-agent-conversation-bound] a conversation opened on REST is usable on MCP and the reverse; another account cannot use it', async () => {
      await world()
      const caseId = await w.caseId('D1')
      const rest = new RestTools(await w.tok('agent'), 'voice')
      await openConversation(rest, 'c-rest', caseId, await w.contactId('D1'))
      expect((await mcp.read('c-rest', caseId)).ok).toBe(true)
      await openConversation(mcp, 'c-mcp', caseId, await w.contactId('D1'))
      expect((await rest.read('c-mcp', caseId)).ok).toBe(true)
      const second = await makeAccount('agent2@recette.test', { role: 'user', profile: 'agent', channel: 'voice' })
      const intruder = new McpTools(second.token, 'voice')
      const res = await intruder.read('c-mcp', caseId)
      expect([res.ok, res.status, res.body.code]).toEqual([false, 404, 'agent.conversation_not_found'])
      expect((await mcp.read('c-mcp', await w.caseId('D2'))).body.code).toBe('cases.not_found')
    })

    it('[rule-recouvrement-agent-idempotency][rule-recouvrement-agent-two-transports] on MCP too a call replayed with the same key has one effect and the same result; the same key with another request is a conflict', async () => {
      await world()
      const caseId = await w.caseId('D1')
      await openConversation(mcp, 'c-1', caseId, await w.contactId('D1'))
      await mcp.nextOffer('c-1', caseId, {})
      const key = freshKey('mcp')
      const first = await mcp.nextOffer('c-1', caseId, { counterpart: { type: 'firm_date' } }, key)
      const second = await mcp.nextOffer('c-1', caseId, { counterpart: { type: 'firm_date' } }, key)
      expect(first.ok).toBe(true)
      expect(second.body).toEqual(first.body)
      expect((await w.caseDetail('D1')).unlockedOffers).toHaveLength(2)
      const conflict = await mcp.complaint('c-1', caseId, { text: 'autre requête' }, key)
      expect([conflict.ok, conflict.status, conflict.body.code]).toEqual([false, 409, 'agent.idempotency_conflict'])
      const audit = ok(await get('/audit-logs?action=agent:mcp&size=100', await w.tok('sup')))
      expect(audit.total).toBeGreaterThanOrEqual(0)
    })
  })

  describe('scénario commun aux deux transports', () => {
    /** Joue tout le parcours d'un agent et rend, pour chaque pas, le statut et le corps normalisés. */
    async function scenario(tools: Tools): Promise<unknown[]> {
      const out: unknown[] = []
      const step = async (label: string, outcome: Outcome) => {
        out.push({ label, ok: outcome.ok, status: outcome.status, body: normalize(outcome.body) })
        expect(forbiddenKeysIn(outcome.body)).toEqual([])
        return outcome
      }
      const [c1, c2, c3, cc] = await Promise.all(['D1', 'D2', 'D3', 'DC'].map((d) => w.caseId(d)))
      const inter = async (d: string) => w.contactId(d)
      await step('refus déclaration', await tools.open('x-0', { caseId: c1, interlocutorId: await inter('D1'), aiDisclosureGiven: false }))
      await step('lecture sans conversation', await tools.read('x-0', c1))
      await step('ouverture', await tools.open('x-1', { caseId: c1, interlocutorId: await inter('D1'), aiDisclosureGiven: true }))
      await step('lecture', await tools.read('x-1', c1))
      await step('autre dossier', await tools.read('x-1', c2))
      await step('ancrage', await tools.nextOffer('x-1', c1, {}))
      await step('contrepartie manquante', await tools.nextOffer('x-1', c1, {}))
      await step('contrepartie erronée', await tools.nextOffer('x-1', c1, { counterpart: { type: 'direct_debit' } }))
      const second = await step('deuxième offre', await tools.nextOffer('x-1', c1, { counterpart: { type: 'firm_date' } }))
      await step('vérification message conforme', await tools.check('x-1', { caseId: c1, text: `Total ${String(second.body.offer.totalCents / 100).replace('.', ',')} €` }))
      await step('vérification message fautif', await tools.check('x-1', { caseId: c1, text: 'Notre plancher est de 1 234,56 € le 03/03/2031' }))
      await step('engagement inexact', await tools.commit('x-1', c1, { ...commitmentFor(second.body.offer), totalCents: 1 }))
      await step('moyen refusé', await tools.commit('x-1', c1, commitmentFor(second.body.offer, 'cheque')))
      await step('engagement', await tools.commit('x-1', c1, commitmentFor(second.body.offer)))
      await step('second engagement', await tools.commit('x-1', c1, commitmentFor(second.body.offer)))
      await step('offre pendant engagement', await tools.nextOffer('x-1', c1, { counterpart: { type: 'first_payment' } }))
      await step('lecture après engagement', await tools.read('x-1', c1))
      await tools.open('x-2', { caseId: c2, interlocutorId: await inter('D2'), aiDisclosureGiven: true })
      await step('contestation sans facture', await tools.contest('x-2', c2, { reason: 'Je conteste' }))
      await step('contestation facture inconnue', await tools.contest('x-2', c2, { reason: 'Je conteste', invoiceNumbers: ['ZZ-1'] }))
      await step('contestation', await tools.contest('x-2', c2, { reason: 'Je conteste', invoiceNumbers: ['FA-002'] }))
      await step('offre après contestation', await tools.nextOffer('x-2', c2, {}))
      await tools.open('x-3', { caseId: c3, interlocutorId: await inter('D3'), aiDisclosureGiven: true })
      await step('intervention humaine', await tools.human('x-3', c3, { reason: 'Le client le demande' }))
      await step('réclamation', await tools.complaint('x-3', c3, { text: 'Ton désagréable' }))
      await tools.open('x-4', { caseId: cc, interlocutorId: await inter('DC'), aiDisclosureGiven: true })
      await step('intervention humaine entreprise', await tools.human('x-4', cc, {}))
      const effects = {
        d1: await w.caseDetail('D1'), d2: await w.caseDetail('D2'), d3: await w.caseDetail('D3'), dc: await w.caseDetail('DC'),
        orders: (await sql<any>('select kind, status from base.send_orders order by kind, status')).map((r: any) => `${r.kind}:${r.status}`),
        complaints: (await sql('select 1 from base.complaints')).length,
      }
      const pick = (d: any) => ({ state: d.state, offers: d.unlockedOffers.map((o: any) => o.status).sort(), commitments: d.commitments.length, freezes: d.freezes.length })
      out.push({ label: 'effets', d1: pick(effects.d1), d2: pick(effects.d2), d3: pick(effects.d3), dc: pick(effects.dc), orders: effects.orders, complaints: effects.complaints })
      return out
    }

    it('[rule-recouvrement-agent-two-transports] the same scenario played on REST then on MCP, on the same data, gives the same responses (identifiers aside) and the same effects', async () => {
      await world()
      const viaRest = await scenario(new RestTools(await w.tok('agent'), 'voice'))
      await resetData()
      w = new World()
      await world()
      const viaMcp = await scenario(mcp)
      expect(viaMcp).toEqual(viaRest)
      const effects = viaRest[viaRest.length - 1] as any
      expect(effects.d1).toMatchObject({ state: 'committed', commitments: 1 })
      expect(effects.d2.state).toBe('frozen')
      expect(effects.d3.state).toBe('supervisor_queue')
      expect(effects.dc.state).toBe('open')
      expect(effects.complaints).toBe(1)
    })
  })
})
