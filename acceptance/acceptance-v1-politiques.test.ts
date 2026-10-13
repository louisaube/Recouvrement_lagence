import { resetData, closePool, sql } from './harness'
import { upload } from './import-helpers'
import {
  World, get, post, http, expectRes, ok, UNKNOWN_UUID, policyDoc, ruleFor, standardLadder, previewPolicy,
  importPolicyVersion, policyBytes, sha256, setupWorld, DEFAULT_WITNESSES,
} from './recouvrement-helpers'
import type { Inv } from './recouvrement-helpers'

// Version v1-cerveau-recouvrement : versions de politique (fichier JDM de GoRules ZEN, paramètres, dossiers témoins),
// six contrôles d'activation bloquants, immutabilité, activation.

const CHECK_CODES = ['floor', 'decreasing_concessions', 'counterparts', 'schedule_limits', 'segments_covered', 'witnesses']
const checkOf = (body: any, code: string) => (body.checks as any[]).find((c) => c.code === code)

describe('Recouvrement - politique', () => {
  let w: World
  let sup: string

  beforeEach(async () => {
    await resetData()
    w = new World()
    sup = await w.tok('sup')
  })
  afterAll(async () => {
    await closePool()
  })

  /** Remplace les règles de tous les couples par une règle modifiée. */
  const withRule = (over: Record<string, any>, nature?: 'family' | 'company') =>
    policyDoc({
      ruleOverrides: Object.fromEntries(
        ['standard', 'premium'].flatMap((s) => (['family', 'company'] as const).filter((n) => !nature || n === nature).map((n) => [`${s}/${n}`, over])),
      ),
    })

  describe('aperçu', () => {
    it('[rule-recouvrement-policy-format][rule-recouvrement-policy-versioned] a valid file gives a preview with the SHA-256 of the file, the global parameters, the rules, six checks and the witnesses', async () => {
      const doc = policyDoc({ label: 'Politique octobre', versionDate: '2026-10-01' })
      const bytes = policyBytes(doc)
      const res = await previewPolicy(sup, doc, 'politique-octobre.json')
      expectRes(res, 200)
      const p = res.body
      expect(p.valid).toBe(true)
      expect(p.errors).toEqual([])
      expect(p.fileName).toBe('politique-octobre.json')
      expect(p.fileHash).toBe(sha256(bytes))
      expect(p.label).toBe('Politique octobre')
      expect(p.versionDate).toBe('2026-10-01')
      expect(p.previewId).toMatch(/^[0-9a-f-]{36}$/)
      expect(p.global).toMatchObject({ statementMaxAgeDays: 30, ledgerMaxImports: 2, reviewSampleSize: 5, paymentMethods: ['transfer', 'direct_debit', 'card'] })
      expect(p.rules).toHaveLength(4)
      expect(p.rules.find((r: any) => r.segment === 'standard' && r.nature === 'family')).toMatchObject({
        horizonDays: 90, maxScheduleDays: 90, nextStep: { kind: 'external_collector', expectedValueBp: 5000 },
        limitation: { delayDays: 1825, startsFrom: 'invoice_date', alertDays: 90 },
      })
      expect(p.checks.map((c: any) => c.code)).toEqual(CHECK_CODES)
      expect(p.checks.every((c: any) => c.passed === true && c.problems.length === 0)).toBe(true)
      expect(p.witnesses).toHaveLength(DEFAULT_WITNESSES.length)
      expect(p.witnesses.every((x: any) => x.passed === true)).toBe(true)
      expect(p.witnesses[0].obtained).toEqual(p.witnesses[0].expected)
    })

    it('[rule-recouvrement-policy-versioned] the preview writes no version: nothing is listed before the confirmation', async () => {
      expectRes(await previewPolicy(sup, policyDoc()), 200)
      expect(ok(await get('/policy-versions', sup)).total).toBe(0)
      expect(await sql('select 1 from base.policy_versions')).toHaveLength(0)
    })

    it('[rule-recouvrement-policy-json-not-spreadsheet] a spreadsheet or a text that is not JSON is refused: 400 policies.invalid_file_type', async () => {
      const csv = Buffer.from('a,b\n1,2\n', 'utf8')
      expectRes(await upload(sup, csv, 'politique.csv', { path: '/policy-versions/previews' }), 400, 'policies.invalid_file_type')
      const zipLike = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00, 0x08, 0x00])
      expectRes(await upload(sup, zipLike, 'politique.xlsx', { path: '/policy-versions/previews' }), 400, 'policies.invalid_file_type')
      expectRes(await upload(sup, Buffer.from('{"label": ', 'utf8'), 'politique.json', { path: '/policy-versions/previews' }), 400, 'policies.invalid_file_type')
    })

    it('[rule-recouvrement-policy-json-not-spreadsheet] a file that is not valid UTF-8 is refused: 400 policies.invalid_file_type', async () => {
      const bad = Buffer.concat([Buffer.from('{"label":"'), Buffer.from([0xff, 0xfe, 0xfd]), Buffer.from('"}')])
      expectRes(await upload(sup, bad, 'politique.json', { path: '/policy-versions/previews' }), 400, 'policies.invalid_file_type')
    })

    it('[rule-recouvrement-policy-format] a file of 2 097 152 bytes is read (and judged invalid by its content); one more byte is refused with 413 policies.file_too_large', async () => {
      const make = (total: number) => {
        const head = '{"label":"'
        const tail = '"}'
        return Buffer.from(head + 'a'.repeat(total - head.length - tail.length) + tail, 'utf8')
      }
      const atLimit = await upload(sup, make(2097152), 'politique.json', { path: '/policy-versions/previews' })
      expectRes(atLimit, 200)
      expect(atLimit.body.valid).toBe(false)
      expectRes(await upload(sup, make(2097153), 'politique.json', { path: '/policy-versions/previews' }), 413, 'policies.file_too_large')
    })

    it('[rule-recouvrement-policy-format] a body that is not a multipart upload, or has no file part, answers 400 api.validation.incoming_failed', async () => {
      expectRes(await http('POST', '/policy-versions/previews', sup, policyDoc()), 400, 'api.validation.incoming_failed')
    })

    const INVALID: [string, (d: any) => void, string][] = [
      ['unknown key at the root', (d) => (d.surprise = 1), 'surprise'],
      ['missing label', (d) => delete d.label, 'label'],
      ['empty label', (d) => (d.label = ''), 'label'],
      ['label of 101 characters', (d) => (d.label = 'x'.repeat(101)), 'label'],
      ['malformed versionDate', (d) => (d.versionDate = '01/10/2026'), 'versionDate'],
      ['statementMaxAgeDays above 3650', (d) => (d.parameters.global.statementMaxAgeDays = 3651), 'statementMaxAgeDays'],
      ['ledgerMaxImports of 0', (d) => (d.parameters.global.ledgerMaxImports = 0), 'ledgerMaxImports'],
      ['ledgerMaxImports above 100', (d) => (d.parameters.global.ledgerMaxImports = 101), 'ledgerMaxImports'],
      ['reviewSampleSize of 0', (d) => (d.parameters.global.reviewSampleSize = 0), 'reviewSampleSize'],
      ['reviewSampleSize above 10000', (d) => (d.parameters.global.reviewSampleSize = 10001), 'reviewSampleSize'],
      ['no payment method', (d) => (d.parameters.global.paymentMethods = []), 'paymentMethods'],
      ['payment method with a space', (d) => (d.parameters.global.paymentMethods = ['virement bancaire']), 'paymentMethods'],
      ['cap above 10000 basis points', (d) => (d.parameters.global.decisionTypeCapsBp.reminder = 10001), 'reminder'],
      ['missing cap', (d) => delete d.parameters.global.decisionTypeCapsBp.proposal, 'proposal'],
      ['ceiling with a bad agent version', (d) => (d.parameters.global.exposureCeilings = [{ agentVersion: 'a b', segment: '*', maxCents: 1 }]), 'agentVersion'],
      ['no rule', (d) => (d.parameters.rules = []), 'rules'],
      ['rule with horizonDays of 0', (d) => (d.parameters.rules[0].horizonDays = 0), 'horizonDays'],
      ['rule with horizonDays above 3650', (d) => (d.parameters.rules[0].horizonDays = 3651), 'horizonDays'],
      ['rule with expectedValueBp above 10000', (d) => (d.parameters.rules[0].nextStep.expectedValueBp = 10001), 'expectedValueBp'],
      ['rule with an unknown next step kind', (d) => (d.parameters.rules[0].nextStep.kind = 'huissier'), 'nextStep'],
      ['empty ladder', (d) => (d.parameters.rules[0].ladder = []), 'ladder'],
      ['ladder of 21 offers', (d) => (d.parameters.rules[0].ladder = Array.from({ length: 21 }, () => ({ offerKind: 'lump_sum', valueBp: 9000, payByDays: 1, delayFeeBp: 0 }))), 'ladder'],
      ['offer with valueBp above 10000', (d) => (d.parameters.rules[0].ladder[0].valueBp = 10001), 'valueBp'],
      ['offer with payByDays above 365', (d) => (d.parameters.rules[0].ladder[0].payByDays = 366), 'payByDays'],
      ['schedule offer without installments', (d) => delete d.parameters.rules[0].ladder[3].installments, 'ladder'],
      ['schedule with one installment', (d) => (d.parameters.rules[0].ladder[3].installments.count = 1), 'count'],
      ['schedule with 61 installments', (d) => (d.parameters.rules[0].ladder[3].installments.count = 61), 'count'],
      ['lump sum offer with installments', (d) => (d.parameters.rules[0].ladder[0].installments = { count: 2, intervalDays: 30 }), 'ladder'],
      ['delayFeeBp above 10000', (d) => (d.parameters.rules[0].ladder[1].delayFeeBp = 10001), 'delayFeeBp'],
      ['unknown counterpart type', (d) => (d.parameters.rules[0].ladder[1].counterpart = { type: 'gage' }), 'counterpart'],
      ['thresholdCents above 10 000 000 000', (d) => (d.parameters.rules[0].thresholdCents = 10_000_000_001), 'thresholdCents'],
      ['maxScheduleDays above 3650', (d) => (d.parameters.rules[0].maxScheduleDays = 3651), 'maxScheduleDays'],
      ['unknown required document', (d) => (d.parameters.rules[0].requiredDocuments = ['passeport']), 'requiredDocuments'],
      ['limitation delay of 0', (d) => (d.parameters.rules[0].limitation.delayDays = 0), 'delayDays'],
      ['limitation start unknown', (d) => (d.parameters.rules[0].limitation.startsFrom = 'naissance'), 'startsFrom'],
      ['segment with a capital', (d) => (d.parameters.rules[0].segment = 'Standard'), 'segment'],
      ['same segment and nature twice', (d) => d.parameters.rules.push(structuredClone(d.parameters.rules[0])), 'rules'],
      ['no witness', (d) => (d.witnesses = []), 'witnesses'],
      ['witness id twice', (d) => d.witnesses.push(structuredClone(d.witnesses[0])), 'witnesses'],
      ['witness expected action unknown', (d) => (d.witnesses[0].expected.action = 'saisir'), 'action'],
      ['unknown key in a rule', (d) => (d.parameters.rules[0].bonus = 1), 'bonus'],
      ['decision that is not a decision graph', (d) => (d.decision = { nodes: 'x' }), 'decision'],
      ['decision missing', (d) => delete d.decision, 'decision'],
    ]
    for (const [name, mutate, key] of INVALID) {
      it(`[rule-recouvrement-policy-format] ${name}: valid false, an error on the JSON path, empty checks, rules and witnesses`, async () => {
        const doc = policyDoc()
        mutate(doc)
        const res = await previewPolicy(sup, doc)
        expectRes(res, 200)
        expect(res.body.valid).toBe(false)
        expect(res.body.errors.length).toBeGreaterThan(0)
        expect(res.body.errors.length).toBeLessThanOrEqual(100)
        for (const e of res.body.errors) {
          expect(typeof e.path).toBe('string')
          expect(e.path.length).toBeGreaterThanOrEqual(1)
          expect(e.path.length).toBeLessThanOrEqual(200)
          expect(e.reason.length).toBeGreaterThanOrEqual(1)
          expect(e.reason.length).toBeLessThanOrEqual(300)
        }
        expect(res.body.errors.some((e: any) => e.path.includes(key) || e.reason.includes(key))).toBe(true)
        expect(res.body.checks).toEqual([])
        expect(res.body.witnesses).toEqual([])
        expect(res.body.rules).toEqual([])
      })
    }

    it('[rule-recouvrement-policy-format] the confirmation of an invalid preview answers 409 policies.invalid_file and writes nothing', async () => {
      const doc = policyDoc()
      doc.surprise = 1
      const pre = await previewPolicy(sup, doc)
      expectRes(await post(`/policy-versions/previews/${pre.body.previewId}/confirm`, sup), 409, 'policies.invalid_file')
      expect(ok(await get('/policy-versions', sup)).total).toBe(0)
    })

    it('[rule-recouvrement-policy-format] the decision graph is evaluated by the engine: an unmatched input gives the action none and the rule no_rule', async () => {
      const doc = policyDoc({
        decisionRows: [{ states: ['open'], late: '>= 10', action: 'reminder', rule: 'seul-cas' }],
        witnesses: [
          { id: 't1', description: 'cas couvert', input: { segment: 'standard', nature: 'family', state: 'open', daysLateMax: 15, negotiableCents: 1000 }, expected: { action: 'reminder', rule: 'seul-cas' } },
          { id: 't2', description: 'cas non couvert', input: { segment: 'standard', nature: 'family', state: 'frozen', daysLateMax: 15, negotiableCents: 1000 }, expected: { action: 'none', rule: 'no_rule' } },
        ],
      })
      const res = await previewPolicy(sup, doc)
      expectRes(res, 200)
      expect(res.body.valid).toBe(true)
      expect(res.body.witnesses.map((x: any) => [x.id, x.passed, x.obtained])).toEqual([
        ['t1', true, { action: 'reminder', rule: 'seul-cas' }],
        ['t2', true, { action: 'none', rule: 'no_rule' }],
      ])
    })
  })

  describe('confirmation', () => {
    it('[rule-recouvrement-policy-versioned] the confirmation creates the version imported by the supervisor, with the hash, the date and the result of the checks', async () => {
      const doc = policyDoc({ label: 'V1', versionDate: '2026-09-01' })
      const pre = await previewPolicy(sup, doc)
      const res = await post(`/policy-versions/previews/${pre.body.previewId}/confirm`, sup)
      expectRes(res, 201)
      const v = res.body.version
      expect(v).toMatchObject({
        label: 'V1', versionDate: '2026-09-01', status: 'imported', fileHash: sha256(policyBytes(doc)),
        importedBy: { email: 'sup@recette.test' }, activatedBy: null, activatedAt: null, checksPassed: true,
      })
      expect(Object.keys(v).sort()).toEqual(['activatedAt', 'activatedBy', 'checksPassed', 'fileHash', 'id', 'importedAt', 'importedBy', 'label', 'status', 'versionDate'])
      expect(v.importedBy.id).toBe((await w.acc('sup')).id)
    })

    it('[rule-recouvrement-policy-versioned] the same file (same SHA-256) is imported only once: 409 policies.already_imported at the preview and at the confirmation of another preview', async () => {
      const doc = policyDoc()
      const first = await previewPolicy(sup, doc)
      const second = await previewPolicy(sup, doc)
      expectRes(await post(`/policy-versions/previews/${first.body.previewId}/confirm`, sup), 201)
      expectRes(await post(`/policy-versions/previews/${second.body.previewId}/confirm`, sup), 409, 'policies.already_imported')
      expectRes(await previewPolicy(sup, doc), 409, 'policies.already_imported')
      expect(ok(await get('/policy-versions', sup)).total).toBe(1)
    })

    it('[rule-recouvrement-policy-versioned] a preview is consumed by its confirmation: confirming it again gives 409 policies.already_imported or 404 policies.preview_not_found, never a second version', async () => {
      const pre = await previewPolicy(sup, policyDoc())
      expectRes(await post(`/policy-versions/previews/${pre.body.previewId}/confirm`, sup), 201)
      const again = await post(`/policy-versions/previews/${pre.body.previewId}/confirm`, sup)
      expect([404, 409]).toContain(again.status)
      expect(ok(await get('/policy-versions', sup)).total).toBe(1)
    })

    it('[rule-recouvrement-policy-versioned] an unknown preview answers 404 policies.preview_not_found; a malformed identifier answers 400', async () => {
      expectRes(await post(`/policy-versions/previews/${UNKNOWN_UUID}/confirm`, sup), 404, 'policies.preview_not_found')
      expectRes(await post('/policy-versions/previews/pas-un-uuid/confirm', sup), 400, 'api.validation.incoming_failed')
    })

    it('[rule-recouvrement-policy-versioned] a preview is private to its creator: another supervisor gets the same 404 policies.preview_not_found as for an unknown id, and nothing is created', async () => {
      const pre = await previewPolicy(sup, policyDoc())
      const other = await w.tok('sup2')
      const foreign = await post(`/policy-versions/previews/${pre.body.previewId}/confirm`, other)
      const unknown = await post(`/policy-versions/previews/${UNKNOWN_UUID}/confirm`, other)
      expectRes(foreign, 404, 'policies.preview_not_found')
      expect(foreign.body).toEqual(unknown.body)
      expect(ok(await get('/policy-versions', sup)).total).toBe(0)
      expectRes(await post(`/policy-versions/previews/${pre.body.previewId}/confirm`, sup), 201)
    })

    it('[rule-recouvrement-policy-audited] the confirmation is traced (object type « Version de politique », action policies:confirm) without the content of the file; the preview is not', async () => {
      const doc = policyDoc({ label: 'Politique tracée', versionDate: '2026-10-01' })
      const pre = await previewPolicy(sup, doc)
      expect((await get('/audit-logs?action=policies:confirm', await w.tok('admin'))).body.total).toBe(0)
      const conf = await post(`/policy-versions/previews/${pre.body.previewId}/confirm`, sup)
      const log = await get('/audit-logs?action=policies:confirm', await w.tok('admin'))
      expect(log.body.total).toBe(1)
      const e = log.body.entries[0]
      expect(e.objectType).toBe('Version de politique')
      expect(e.objectId).toBe(conf.body.version.id)
      expect(e.summary).toBe('Version de politique « Politique tracée » du 01/10/2026 importée.')
      expect(JSON.stringify(e)).not.toMatch(/ladder|valueBp|r-reminder/)
    })
  })

  describe('lecture', () => {
    it('[rule-recouvrement-policy-versioned] the list is ordered by version date then import date, newest first, and filters by status', async () => {
      const a = await importPolicyVersion(sup, policyDoc({ label: 'A', versionDate: '2026-08-01' }))
      const b = await importPolicyVersion(sup, policyDoc({ label: 'B', versionDate: '2026-10-01' }))
      const c = await importPolicyVersion(sup, policyDoc({ label: 'C', versionDate: '2026-10-01' }))
      expectRes(await post(`/policy-versions/${a}/activate`, sup), 200)
      const all = ok(await get('/policy-versions', sup))
      expect(all.total).toBe(3)
      expect(all.items.map((v: any) => v.id)).toEqual([c, b, a])
      expect(ok(await get('/policy-versions?status=active', sup)).items.map((v: any) => v.id)).toEqual([a])
      expect(ok(await get('/policy-versions?status=imported', sup)).total).toBe(2)
      expect(ok(await get('/policy-versions?status=superseded', sup)).total).toBe(0)
      expect(ok(await get('/policy-versions?from=1&size=1', sup)).items.map((v: any) => v.id)).toEqual([b])
      for (const q of ['status=oups', 'size=0', 'size=101', 'from=-1']) expectRes(await get(`/policy-versions?${q}`, sup), 400, 'api.validation.incoming_failed')
    })

    it('[rule-recouvrement-policy-activation-checks] the detail of a version carries the global parameters, the rules with their ladder, the six checks recomputed and the witnesses', async () => {
      const id = await importPolicyVersion(sup, policyDoc({ label: 'Détail' }))
      const res = await get(`/policy-versions/${id}`, sup)
      expectRes(res, 200)
      const v = res.body.version
      expect(v).toMatchObject({ id, label: 'Détail', status: 'imported' })
      expect(v.global.decisionTypeCapsBp).toEqual({ none: 10000, reminder: 10000, proposal: 10000, transfer_proposed: 10000 })
      expect(v.rules).toHaveLength(4)
      const rule = v.rules.find((r: any) => r.segment === 'standard' && r.nature === 'family')
      expect(rule.ladder).toHaveLength(4)
      expect(rule.ladder.map((r: any) => r.rank)).toEqual([1, 2, 3, 4])
      expect(rule.ladder[3]).toMatchObject({ offerKind: 'schedule', valueBp: 8200, payByDays: 7, installments: { count: 3, intervalDays: 30 }, counterpart: { type: 'direct_debit' } })
      expect(v.checks.map((c: any) => c.code)).toEqual(CHECK_CODES)
      expect(v.witnesses).toHaveLength(DEFAULT_WITNESSES.length)
    })

    it('[rule-recouvrement-policy-versioned] an unknown version answers 404 repository.not_found, a malformed id 400', async () => {
      expectRes(await get(`/policy-versions/${UNKNOWN_UUID}`, sup), 404, 'repository.not_found')
      expectRes(await get('/policy-versions/pas-un-uuid', sup), 400, 'api.validation.incoming_failed')
    })

    it('[rule-recouvrement-policy-immutable] there is no route to modify or delete a version: PUT, PATCH and DELETE answer 404 api.route_not_found', async () => {
      const id = await importPolicyVersion(sup, policyDoc())
      for (const method of ['PUT', 'PATCH', 'DELETE']) {
        expectRes(await http(method, `/policy-versions/${id}`, sup, method === 'DELETE' ? undefined : {}), 404, 'api.route_not_found')
      }
    })
  })

  describe('activation', () => {
    it('[rule-recouvrement-policy-versioned][rule-recouvrement-policy-immutable] the activation makes the version active (author, instant) and supersedes the previous one in the same transaction; one active version at most', async () => {
      const a = await importPolicyVersion(sup, policyDoc({ label: 'A', versionDate: '2026-09-01' }))
      const b = await importPolicyVersion(sup, policyDoc({ label: 'B', versionDate: '2026-10-01' }))
      const first = await post(`/policy-versions/${a}/activate`, sup)
      expectRes(first, 200)
      expect(first.body.version).toMatchObject({ id: a, status: 'active', activatedBy: { email: 'sup@recette.test' } })
      expect(first.body.version.activatedAt).toBeTruthy()
      const second = await post(`/policy-versions/${b}/activate`, sup)
      expectRes(second, 200)
      expect(second.body.version.status).toBe('active')
      const list = ok(await get('/policy-versions?size=100', sup)).items
      expect(list.find((v: any) => v.id === a).status).toBe('superseded')
      expect(list.filter((v: any) => v.status === 'active')).toHaveLength(1)
      expect(await sql("select count(*)::int as n from base.policy_versions where status = 'active'")).toEqual([{ n: 1 }])
    })

    it('[rule-recouvrement-policy-immutable] a version already active, or superseded, is not activatable: 409 policies.not_activatable', async () => {
      const a = await importPolicyVersion(sup, policyDoc({ label: 'A' }))
      const b = await importPolicyVersion(sup, policyDoc({ label: 'B' }))
      await post(`/policy-versions/${a}/activate`, sup)
      expectRes(await post(`/policy-versions/${a}/activate`, sup), 409, 'policies.not_activatable')
      await post(`/policy-versions/${b}/activate`, sup)
      expectRes(await post(`/policy-versions/${a}/activate`, sup), 409, 'policies.not_activatable')
      expect(ok(await get(`/policy-versions/${b}`, sup)).version.status).toBe('active')
    })

    it('[rule-recouvrement-policy-immutable] the database refuses to modify or delete the content of a version, active or not', async () => {
      const a = await importPolicyVersion(sup, policyDoc({ label: 'A' }))
      await post(`/policy-versions/${a}/activate`, sup)
      await expect(sql("update base.policy_versions set label = 'modifiée' where id = $1", [a])).rejects.toThrow()
      await expect(sql("update base.policy_versions set document = '{}'::jsonb where id = $1", [a])).rejects.toThrow()
      await expect(sql("update base.policy_versions set file_hash = repeat('0', 64) where id = $1", [a])).rejects.toThrow()
      await expect(sql('delete from base.policy_versions where id = $1', [a])).rejects.toThrow()
      expect(ok(await get(`/policy-versions/${a}`, sup)).version.label).toBe('A')
    })

    it('[rule-recouvrement-policy-immutable] the database allows at most one active version', async () => {
      const a = await importPolicyVersion(sup, policyDoc({ label: 'A' }))
      const b = await importPolicyVersion(sup, policyDoc({ label: 'B' }))
      await post(`/policy-versions/${a}/activate`, sup)
      await expect(sql("update base.policy_versions set status = 'active' where id = $1", [b])).rejects.toThrow()
    })

    it('[rule-recouvrement-policy-versioned] an unknown version answers 404 repository.not_found, a malformed id 400', async () => {
      expectRes(await post(`/policy-versions/${UNKNOWN_UUID}/activate`, sup), 404, 'repository.not_found')
      expectRes(await post('/policy-versions/pas-un-uuid/activate', sup), 400, 'api.validation.incoming_failed')
    })

    it('[rule-recouvrement-policy-audited] the activation is traced (action policies:activate, « Version de politique », summary « … activée. ») without the content of the file', async () => {
      const id = await importPolicyVersion(sup, policyDoc({ label: 'Politique active', versionDate: '2026-10-01' }))
      await post(`/policy-versions/${id}/activate`, sup)
      const log = await get('/audit-logs?action=policies:activate', await w.tok('admin'))
      expect(log.body.total).toBe(1)
      expect(log.body.entries[0]).toMatchObject({
        objectType: 'Version de politique',
        objectId: id,
        summary: 'Version de politique « Politique active » du 01/10/2026 activée.',
      })
    })

    it('[rule-recouvrement-policy-activation-date][D-0011] a version dated before the active version is activatable: 200, the older active version becomes superseded', async () => {
      const recent = await importPolicyVersion(sup, policyDoc({ label: 'Récente', versionDate: '2026-10-01' }))
      const older = await importPolicyVersion(sup, policyDoc({ label: 'Ancienne', versionDate: '2026-09-15' }))
      expectRes(await post(`/policy-versions/${recent}/activate`, sup), 200)
      const res = await post(`/policy-versions/${older}/activate`, sup)
      expectRes(res, 200)
      expect(res.body.version).toMatchObject({ id: older, status: 'active' })
      expect(ok(await get(`/policy-versions/${recent}`, sup)).version.status).toBe('superseded')
    })
  })

  describe('six contrôles d\'activation', () => {
    /** Aperçu, vérifie le contrôle en échec ; confirme ; l'activation est bloquée ; la version reste importée. */
    async function expectBlocked(doc: any, code: string, problemFragment?: RegExp) {
      const pre = await previewPolicy(sup, doc)
      expectRes(pre, 200)
      expect(pre.body.valid).toBe(true)
      const check = checkOf(pre.body, code)
      expect(check.passed).toBe(false)
      expect(check.problems.length).toBeGreaterThan(0)
      expect(check.problems.length).toBeLessThanOrEqual(50)
      if (problemFragment) expect(check.problems.join(' ')).toMatch(problemFragment)
      for (const other of pre.body.checks.filter((c: any) => c.code !== code)) expect({ code: other.code, passed: other.passed }).toEqual({ code: other.code, passed: true })
      const conf = await post(`/policy-versions/previews/${pre.body.previewId}/confirm`, sup)
      expectRes(conf, 201)
      expect(conf.body.version.checksPassed).toBe(false)
      const act = await post(`/policy-versions/${conf.body.version.id}/activate`, sup)
      expectRes(act, 409, 'policies.activation_blocked')
      expect(act.body.details).toEqual(expect.arrayContaining([expect.objectContaining({ path: code })]))
      for (const d of act.body.details) expect(typeof d.reason).toBe('string')
      expect(ok(await get(`/policy-versions/${conf.body.version.id}`, sup)).version.status).toBe('imported')
      expect(ok(await get('/policy-versions?status=active', sup)).total).toBe(0)
      return check
    }

    it('[rule-recouvrement-policy-floor][rule-recouvrement-policy-activation-checks] an offer under the floor of its segment blocks the activation (control floor)', async () => {
      await expectBlocked(withRule({ nextStep: { kind: 'external_collector', expectedValueBp: 9000 } }), 'floor')
    })

    it('[rule-recouvrement-policy-floor] an offer exactly at the floor passes the control', async () => {
      const pre = await previewPolicy(sup, withRule({ nextStep: { kind: 'external_collector', expectedValueBp: 8200 } }))
      expect(checkOf(pre.body, 'floor').passed).toBe(true)
    })

    it('[rule-recouvrement-policy-concessions-decreasing] values that do not decrease, or gaps that grow, block the activation (control decreasing_concessions)', async () => {
      await expectBlocked(withRule({ ladder: standardLadder('family', [10000, 9000, 9500, 8200]) }, 'family'), 'decreasing_concessions')
      await expectBlocked(withRule({ ladder: standardLadder('family', [10000, 9500, 8500, 8200]) }, 'family'), 'decreasing_concessions')
    })

    it('[rule-recouvrement-policy-concessions-decreasing] a ladder of one or two offers satisfies the control of the gap', async () => {
      const ladder = standardLadder('family', [10000, 6000, 5500, 5200]).slice(0, 2)
      const pre = await previewPolicy(sup, withRule({ ladder }))
      expect(checkOf(pre.body, 'decreasing_concessions').passed).toBe(true)
      const one = await previewPolicy(sup, withRule({ ladder: ladder.slice(0, 1) }))
      expect(checkOf(one.body, 'decreasing_concessions').passed).toBe(true)
    })

    it('[rule-recouvrement-concessions-equal-gaps][D-0006] a ladder of 100 %, 90 %, 80 % (equal gaps) is refused: 409 policies.activation_blocked, control decreasing_concessions failed', async () => {
      const ladder = standardLadder('family', [10000, 9000, 8000, 0]).slice(0, 3)
      const id = await importPolicyVersion(sup, withRule({ ladder }))
      const act = await post(`/policy-versions/${id}/activate`, sup)
      expectRes(act, 409, 'policies.activation_blocked')
      expect(act.body.details).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'decreasing_concessions' })]))
      expect(act.body.details.map((d: any) => d.path)).toEqual(['decreasing_concessions'])
      expect(ok(await get(`/policy-versions/${id}`, sup)).version.status).toBe('imported')
    })

    it('[rule-recouvrement-concessions-equal-gaps] 100 %, 90 %, 81 % (gaps 10 then 9 points) is accepted', async () => {
      const ladder = standardLadder('family', [10000, 9000, 8100, 0]).slice(0, 3)
      const id = await importPolicyVersion(sup, withRule({ ladder }))
      expectRes(await post(`/policy-versions/${id}/activate`, sup), 200)
    })

    it('[rule-recouvrement-policy-counterparts] a concession (second offer or later) without a counterpart blocks the activation; the anchor needs none', async () => {
      const ladder = standardLadder('family')
      delete (ladder[2] as any).counterpart
      await expectBlocked(withRule({ ladder }, 'family'), 'counterparts')
      const pre = await previewPolicy(sup, policyDoc())
      expect(checkOf(pre.body, 'counterparts').passed).toBe(true)
    })

    it('[rule-recouvrement-policy-schedule-limits] a schedule longer than maxScheduleDays (payByDays + (count - 1) x intervalDays) blocks the activation', async () => {
      await expectBlocked(withRule({ maxScheduleDays: 60 }), 'schedule_limits')
      const pre = await previewPolicy(sup, withRule({ maxScheduleDays: 67 }))
      expect(checkOf(pre.body, 'schedule_limits').passed).toBe(true)
    })

    it('[rule-recouvrement-policy-schedule-limits] a family delay carries no fee: a delayed offer with delayFeeBp above 0 blocks the activation for a family, not for a company', async () => {
      const family = standardLadder('family')
      family[2].delayFeeBp = 100
      await expectBlocked(withRule({ ladder: family }, 'family'), 'schedule_limits')
      const company = standardLadder('company')
      company[2].delayFeeBp = 100
      const pre = await previewPolicy(sup, withRule({ ladder: company }, 'company'))
      expect(checkOf(pre.body, 'schedule_limits').passed).toBe(true)
    })

    it('[rule-recouvrement-policy-schedule-limits] a family offer without delay (payByDays 0, lump sum) may carry a fee', async () => {
      const family = standardLadder('family')
      family[0].payByDays = 0
      family[0].delayFeeBp = 50
      const pre = await previewPolicy(sup, withRule({ ladder: family }, 'family'))
      expect(checkOf(pre.body, 'schedule_limits').passed).toBe(true)
    })

    it('[rule-recouvrement-policy-segments-covered] every segment and nature present in the confirmed receivables needs a rule: the missing pair is named', async () => {
      const invoices: Inv[] = [
        { numero: 'FA-001', debiteur: 'D1', montant: 100000 },
        { numero: 'FA-002', debiteur: 'D2', montant: 50000, segment: 'vip' },
      ]
      await setupWorld({ invoices, policy: false, statement: false, contacts: false }, w)
      const check = await expectBlocked(policyDoc(), 'segments_covered', /vip/)
      expect(check.problems.join(' ')).toMatch(/vip/)
      const withVip = policyDoc({ extraRules: [ruleFor('vip', 'family')] })
      const pre = await previewPolicy(sup, withVip)
      expect(checkOf(pre.body, 'segments_covered').passed).toBe(true)
    })

    it('[rule-recouvrement-policy-segments-covered] without confirmed receivables the control passes', async () => {
      const pre = await previewPolicy(sup, policyDoc({ rules: [ruleFor('rare', 'company')] }))
      expect(checkOf(pre.body, 'segments_covered').passed).toBe(true)
    })

    it('[rule-recouvrement-policy-witnesses] a witness case that does not give exactly the expected action and rule blocks the activation; the obtained value is listed', async () => {
      const witnesses = structuredClone(DEFAULT_WITNESSES)
      witnesses[0].expected = { action: 'proposal', rule: 'r-proposal' }
      const doc = policyDoc({ witnesses })
      const pre = await previewPolicy(sup, doc)
      const wit = pre.body.witnesses.find((x: any) => x.id === 'w-reminder')
      expect(wit).toMatchObject({ passed: false, expected: { action: 'proposal', rule: 'r-proposal' }, obtained: { action: 'reminder', rule: 'r-reminder' } })
      expect(pre.body.witnesses.filter((x: any) => !x.passed)).toHaveLength(1)
      await expectBlocked(doc, 'witnesses')
    })

    it('[rule-recouvrement-policy-witnesses] a witness with the right action but another rule identifier fails', async () => {
      const witnesses = structuredClone(DEFAULT_WITNESSES)
      witnesses[0].expected = { action: 'reminder', rule: 'autre-regle' }
      await expectBlocked(policyDoc({ witnesses }), 'witnesses')
    })

    it('[rule-recouvrement-policy-activation-checks] the activation reports every failed check at once and changes nothing, the previous active version staying active', async () => {
      const good = await importPolicyVersion(sup, policyDoc({ label: 'Bonne', versionDate: '2026-09-01' }))
      await post(`/policy-versions/${good}/activate`, sup)
      const bad = await importPolicyVersion(sup, withRule({ nextStep: { kind: 'external_collector', expectedValueBp: 9500 }, maxScheduleDays: 10 }))
      const act = await post(`/policy-versions/${bad}/activate`, sup)
      expectRes(act, 409, 'policies.activation_blocked')
      const paths = act.body.details.map((d: any) => d.path).sort()
      expect(paths).toEqual(expect.arrayContaining(['floor', 'schedule_limits']))
      expect(ok(await get(`/policy-versions/${good}`, sup)).version.status).toBe('active')
      expect(ok(await get(`/policy-versions/${bad}`, sup)).version.status).toBe('imported')
    })

    it('[rule-recouvrement-policy-activation-checks] the checks of a version are recomputed at the reading against the receivables confirmed at that moment', async () => {
      const id = await importPolicyVersion(sup, policyDoc({ label: 'Sans vip' }))
      expect(checkOf(ok(await get(`/policy-versions/${id}`, sup)).version, 'segments_covered').passed).toBe(true)
      await setupWorld({ invoices: [{ numero: 'FA-9', debiteur: 'D9', montant: 1000, segment: 'vip' }], policy: false, statement: false, contacts: false }, w)
      const after = ok(await get(`/policy-versions/${id}`, sup)).version
      const seg = checkOf(after, 'segments_covered')
      expect(seg.passed).toBe(false)
      expect(seg.problems.join(' ')).toMatch(/vip/)
    })
  })

  describe('lecture réservée', () => {
    it('[rule-recouvrement-policy-supervisor-only] the agent account, the litigation service and the indicators reader cannot read a version: 403 on the list and on the detail', async () => {
      for (const who of ['agent', 'lit', 'ind'] as const) {
        const token = await w.tok(who)
        expectRes(await get('/policy-versions', token), 403, 'security.access_denied')
        expectRes(await get(`/policy-versions/${UNKNOWN_UUID}`, token), 403, 'security.access_denied')
      }
    })
  })
})
