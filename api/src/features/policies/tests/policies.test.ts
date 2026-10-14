import { closePool, resetData, sql } from '../../../platform/testing/helpers'
import { accountWithProfile, get, importReceivables, policyFile, post, receivablesCsv, UNKNOWN, upload } from '../../recovery-common/tests/support'

describe('policy routes', () => {
  let sup: string
  let sup2: string
  let lit: string

  const preview = (doc: unknown, token: string | undefined = sup) => upload('/policy-versions/previews', JSON.stringify(doc), token, 'politique.json')
  const imported = async (doc: unknown = policyFile()) => {
    const pre = await (await preview(doc)).json()
    expect(pre.valid).toBe(true)
    const res = await post(`/policy-versions/previews/${pre.previewId}/confirm`, sup)
    expect(res.status).toBe(201)
    return (await res.json()).version as { id: string; status: string; label: string }
  }

  beforeEach(async () => {
    await resetData()
    sup = (await accountWithProfile('sup@example.com', 'supervisor')).token
    sup2 = (await accountWithProfile('sup2@example.com', 'supervisor')).token
    lit = (await accountWithProfile('lit@example.com', 'litigation')).token
  })
  afterAll(closePool)

  describe('access', () => {
    it('[rule-recouvrement-policy-supervisor-only] anonymous 401, other profiles 403, on every route', async () => {
      for (const path of ['/policy-versions', `/policy-versions/${UNKNOWN}`]) {
        expect((await get(path)).status).toBe(401)
        expect((await get(path, lit)).status).toBe(403)
      }
      expect((await upload('/policy-versions/previews', '{}', lit)).status).toBe(403)
      expect((await post(`/policy-versions/previews/${UNKNOWN}/confirm`, lit)).status).toBe(403)
      expect((await post(`/policy-versions/${UNKNOWN}/activate`, lit)).status).toBe(403)
    })
  })

  describe('POST /policy-versions/previews', () => {
    it('[rule-recouvrement-policy-json-not-spreadsheet] a valid file gives its six checks and its witnesses, and creates no version', async () => {
      const res = await preview(policyFile({ label: 'Politique A' }))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body).toMatchObject({ valid: true, label: 'Politique A', errors: [] })
      expect(body.checks.map((c: any) => c.code).sort()).toEqual(
        ['decreasing_concessions', 'floor', 'counterparts', 'schedule_limits', 'segments_covered', 'witnesses'].sort(),
      )
      expect(body.witnesses).toHaveLength(4)
      expect(body.witnesses.every((w: any) => w.passed)).toBe(true)
      expect(await sql('select 1 from base.policy_versions')).toHaveLength(0)
    })

    it('[rule-recouvrement-policy-format] a JSON file that does not follow the format is analysed with its errors listed', async () => {
      const body = await (await preview({ label: 'x' })).json()
      expect(body.valid).toBe(false)
      expect(body.errors.length).toBeGreaterThan(0)
    })

    it('[rule-recouvrement-policy-format] a file that is not JSON is 400 policies.invalid_file_type', async () => {
      const res = await upload('/policy-versions/previews', 'pas du json', sup, 'politique.json')
      expect(res.status).toBe(400)
      expect((await res.json()).code).toBe('policies.invalid_file_type')
    })

    it('[rule-recouvrement-policy-versioned] the same file is refused once imported: 409 policies.already_imported', async () => {
      const doc = policyFile()
      await imported(doc)
      const res = await preview(doc)
      expect(res.status).toBe(409)
      expect((await res.json()).code).toBe('policies.already_imported')
    })
  })

  describe('POST /policy-versions/previews/:previewId/confirm', () => {
    it('[rule-recouvrement-policy-versioned] creates the version imported, consumes the preview, and traces the action', async () => {
      const pre = await (await preview(policyFile({ label: 'Politique B', versionDate: '2026-09-15' }))).json()
      const res = await post(`/policy-versions/previews/${pre.previewId}/confirm`, sup)
      expect(res.status).toBe(201)
      const { version } = await res.json()
      expect(version).toMatchObject({ label: 'Politique B', versionDate: '2026-09-15', status: 'imported' })
      expect((await post(`/policy-versions/previews/${pre.previewId}/confirm`, sup)).status).toBe(404)
      const [entry] = await sql("select object_type, summary from base.audit_logs where action = 'policies:confirm'")
      expect(entry.object_type).toBe('Version de politique')
      expect(entry.summary).toContain('Politique B')
    })

    it('[rule-recouvrement-policy-versioned] a preview is private to its creator: 404 policies.preview_not_found for another supervisor', async () => {
      const pre = await (await preview(policyFile())).json()
      const res = await post(`/policy-versions/previews/${pre.previewId}/confirm`, sup2)
      expect(res.status).toBe(404)
      expect((await res.json()).code).toBe('policies.preview_not_found')
    })

    it('[rule-recouvrement-policy-format] an invalid preview cannot be confirmed: 409 policies.invalid_file', async () => {
      const pre = await (await preview({ label: 'x' })).json()
      const res = await post(`/policy-versions/previews/${pre.previewId}/confirm`, sup)
      expect(res.status).toBe(409)
      expect((await res.json()).code).toBe('policies.invalid_file')
    })

    it('[rule-recouvrement-policy-versioned] a malformed identifier is 400', async () => {
      expect((await post('/policy-versions/previews/pas-un-uuid/confirm', sup)).status).toBe(400)
    })
  })

  describe('GET /policy-versions and /policy-versions/:id', () => {
    it('[rule-recouvrement-policy-versioned] lists the versions newest first, filters by status, and reads the detail', async () => {
      const older = await imported(policyFile({ label: 'Ancienne', versionDate: '2026-08-01' }))
      const newer = await imported(policyFile({ label: 'Récente', versionDate: '2026-09-01' }))
      const list = await (await get('/policy-versions', sup)).json()
      expect(list.total).toBe(2)
      expect(list.items.map((v: any) => v.label)).toEqual(['Récente', 'Ancienne'])
      expect((await (await get('/policy-versions?status=active', sup)).json()).total).toBe(0)
      const detail = await (await get(`/policy-versions/${older.id}`, sup)).json()
      expect(detail.version.id).toBe(older.id)
      expect(detail.version.rules.length).toBeGreaterThan(0)
      expect(detail.version.checks).toHaveLength(6)
      expect(newer.id).not.toBe(older.id)
    })

    it('[rule-recouvrement-policy-versioned] unknown version 404, malformed identifier 400, bad query 400', async () => {
      expect((await get(`/policy-versions/${UNKNOWN}`, sup)).status).toBe(404)
      expect((await get('/policy-versions/nope', sup)).status).toBe(400)
      expect((await get('/policy-versions?size=0', sup)).status).toBe(400)
    })

    it('[rule-recouvrement-policy-immutable] there is no route to modify or delete a version', async () => {
      const version = await imported()
      for (const method of ['PUT', 'PATCH', 'DELETE']) {
        const res = await fetch(`${process.env.API_URL ?? 'http://localhost:4000'}/policy-versions/${version.id}`, { method, headers: { authorization: `Bearer ${sup}` } })
        expect(res.status).toBe(404)
      }
    })
  })

  describe('POST /policy-versions/:id/activate', () => {
    it('[rule-recouvrement-policy-activation-checks] activates a version whose checks pass, supersedes the previous one, and traces the action', async () => {
      const first = await imported(policyFile({ label: 'Première', versionDate: '2026-08-01' }))
      expect((await post(`/policy-versions/${first.id}/activate`, sup)).status).toBe(200)
      const second = await imported(policyFile({ label: 'Seconde', versionDate: '2026-09-01' }))
      const res = await post(`/policy-versions/${second.id}/activate`, sup)
      expect(res.status).toBe(200)
      expect((await res.json()).version.status).toBe('active')
      const statuses = await sql('select label, status from base.policy_versions order by label')
      expect(statuses).toEqual([
        { label: 'Première', status: 'superseded' },
        { label: 'Seconde', status: 'active' },
      ])
      const [entry] = await sql("select summary from base.audit_logs where action = 'policies:activate' and summary like '%Seconde%'")
      expect(entry.summary).toContain('activée')
    })

    it('[rule-recouvrement-policy-immutable] an active or superseded version is not activatable: 409 policies.not_activatable', async () => {
      const version = await imported()
      expect((await post(`/policy-versions/${version.id}/activate`, sup)).status).toBe(200)
      const again = await post(`/policy-versions/${version.id}/activate`, sup)
      expect(again.status).toBe(409)
      expect((await again.json()).code).toBe('policies.not_activatable')
    })

    it('[rule-recouvrement-policy-segments-covered] a segment of the confirmed receivables without rule blocks the activation (409 policies.activation_blocked)', async () => {
      await importReceivables(sup, receivablesCsv([{ numero: 'F-1', debtor: 'C1', segment: 'rare' }]), '100,00')
      const version = await imported(policyFile({ segments: ['standard'] }))
      const res = await post(`/policy-versions/${version.id}/activate`, sup)
      expect(res.status).toBe(409)
      const body = await res.json()
      expect(body.code).toBe('policies.activation_blocked')
      expect(body.details.map((d: any) => d.path)).toContain('segments_covered')
      expect((await sql('select status from base.policy_versions'))[0].status).toBe('imported')
    })

    it('[rule-recouvrement-policy-versioned] unknown version 404', async () => {
      expect((await post(`/policy-versions/${UNKNOWN}/activate`, sup)).status).toBe(404)
    })

    it('[rule-recouvrement-policy-immutable] two versions activated at the same time: no server error, exactly one version stays active', async () => {
      const a = await imported(policyFile({ label: 'Concurrente A', versionDate: '2026-08-01' }))
      const b = await imported(policyFile({ label: 'Concurrente B', versionDate: '2026-09-01' }))
      const results = await Promise.all([post(`/policy-versions/${a.id}/activate`, sup), post(`/policy-versions/${b.id}/activate`, sup2)])
      expect(results.map((r) => r.status)).toEqual([200, 200])
      const rows = await sql('select status from base.policy_versions order by status')
      expect(rows.map((r: any) => r.status)).toEqual(['active', 'superseded'])
    })
  })
})
