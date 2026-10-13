import { sql, resetData, closePool } from './harness'
import { userWithToken, seedGroup, call, UNKNOWN_UUID, PASSWORD } from './scope-helpers'
import { plain, usersCsv, usersXlsx, upload, previewOk, count, emailsInDb, confirmPath, type Row } from './import-helpers'

// Acceptance suite of version socle-import-excel: POST /users/imports/:importId/confirm
// (valid rows only, no double, concurrency, changed state, atomicity, audit, unusable credentials, ownership).
describe('POST /users/imports/:importId/confirm', () => {
  let admin: Awaited<ReturnType<typeof userWithToken>>
  let admin2: Awaited<ReturnType<typeof userWithToken>>
  let user: Awaited<ReturnType<typeof userWithToken>>

  const BASE_USERS = 3 // admin, admin2, user
  const confirm = (id: string, token = admin.token) => plain('POST', confirmPath(id), token)
  const journal = async (action = 'users:import-confirm') => {
    const res = await call('GET', `/audit-logs?action=${encodeURIComponent(action)}&size=100`, admin2.token)
    expect(res.status).toBe(200)
    return res.body as { entries: any[]; total: number }
  }
  const twoValid: Row[] = [['nouveau1@example.com', 'user', ''], ['nouveau2@example.com', 'admin', '']]

  beforeEach(async () => {
    await resetData()
    admin = await userWithToken('admin@example.com', 'admin')
    admin2 = await userWithToken('admin2@example.com', 'admin')
    user = await userWithToken('user@example.com', 'user')
  })
  afterAll(async () => {
    await closePool()
  })

  describe('nominal', () => {
    it('[rule-foundation-import-confirm-valid-only] [rule-foundation-import-two-steps] creates exactly the valid rows with their role and group memberships; error rows are never written nor skipped', async () => {
      const a = await seedGroup('Équipe A')
      const b = await seedGroup('Équipe B')
      const p = await previewOk(
        admin.token,
        usersCsv([
          ['alice@example.com', 'user', 'équipe a'],
          ['bob@example.com', 'admin', 'Équipe A;Équipe B'],
          ['carl@example.com', 'user', ''],
          ['mauvais@example.com', 'boss', ''],
          ['pas-un-email', 'user', ''],
          ['dana@example.com', 'user', 'Fantôme'],
        ]),
        'comptes.csv',
      )
      expect(p).toMatchObject({ totalRows: 6, validRows: 3, errorRows: 3 })
      const res = await confirm(p.importId)
      expect(res.status).toBe(200)
      expect(res.body).toEqual({ importId: p.importId, createdCount: 3, skippedCount: 0, fileName: 'comptes.csv' })

      expect(await emailsInDb()).toEqual(['admin2@example.com', 'admin@example.com', 'alice@example.com', 'bob@example.com', 'carl@example.com', 'user@example.com'])
      const list = await call('GET', '/users?size=100', admin.token)
      expect(list.status).toBe(200)
      const byEmail = Object.fromEntries(list.body.users.map((u: any) => [u.email, u]))
      expect(byEmail['alice@example.com'].role).toBe('user')
      expect(byEmail['bob@example.com'].role).toBe('admin')
      expect(byEmail['carl@example.com'].role).toBe('user')
      expect(byEmail['alice@example.com'].groups.map((g: any) => g.id)).toEqual([a.id])
      expect(byEmail['bob@example.com'].groups.map((g: any) => g.name)).toEqual(['Équipe A', 'Équipe B'])
      expect(byEmail['carl@example.com'].groups).toEqual([])
      expect(byEmail['dana@example.com']).toBeUndefined()
      expect(b.id).toBeTruthy()
    })

    it('[rule-foundation-import-confirm-valid-only] a .xlsx is confirmed like a .csv', async () => {
      const p = await previewOk(admin.token, usersXlsx(twoValid), 'comptes.xlsx')
      const res = await confirm(p.importId)
      expect(res.status).toBe(200)
      expect(res.body).toMatchObject({ createdCount: 2, skippedCount: 0, fileName: 'comptes.xlsx' })
      expect(await count('users')).toBe(BASE_USERS + 2)
    })

    it('[rule-foundation-import-users-no-password] imported accounts have a credential but cannot log in: 401 security.invalid_credentials (not 404), whatever the password', async () => {
      const p = await previewOk(admin.token, usersCsv(twoValid))
      await confirm(p.importId)
      const ids = await sql<{ id: string }>("select id from base.users where email in ('nouveau1@example.com','nouveau2@example.com')")
      expect(ids).toHaveLength(2)
      for (const { id } of ids) expect(await sql('select 1 from base.credentials where user_id = $1', [id])).toHaveLength(1)
      for (const pwd of [PASSWORD, 'nouveau1@example.com', 'x'.repeat(64)]) {
        const res = await call('POST', '/auth/login', undefined, { email: 'nouveau1@example.com', password: pwd, returnToken: true })
        expect([res.status, res.body.code]).toEqual([401, 'security.invalid_credentials'])
      }
      const admin_ = await call('POST', '/auth/login', undefined, { email: 'nouveau2@example.com', password: PASSWORD, returnToken: true })
      expect([admin_.status, admin_.body.code]).toEqual([401, 'security.invalid_credentials'])
    })

    it('[rule-foundation-import-users-no-password] the stored credentials hold no readable secret and are not shared in clear (hashes only)', async () => {
      const p = await previewOk(admin.token, usersCsv(twoValid))
      await confirm(p.importId)
      const rows = await sql<{ t: string }>("select c::text as t from base.credentials c where user_id in (select id from base.users where email like 'nouveau%')")
      expect(rows).toHaveLength(2)
      for (const r of rows) expect(r.t).not.toContain(PASSWORD)
    })

    it('[rule-foundation-import-confirm-atomic] after confirmation the staging is deleted and the preview row stays, confirmed, with its counts', async () => {
      const p = await previewOk(admin.token, usersCsv([...twoValid, ['bad', 'user', '']]))
      expect(await count('import_preview_rows')).toBeGreaterThan(0)
      expect((await confirm(p.importId)).status).toBe(200)
      expect(await sql('select 1 from base.import_preview_rows where preview_id = $1', [p.importId])).toHaveLength(0)
      expect(await sql('select 1 from base.import_preview_errors where preview_id = $1', [p.importId])).toHaveLength(0)
      const rows = await sql('select status, created_count, skipped_count, confirmed_at from base.import_previews where id = $1', [p.importId])
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ status: 'confirmed', created_count: 2, skipped_count: 0 })
      expect(rows[0].confirmed_at).not.toBeNull()
    })

    it('[rule-foundation-import-confirm-valid-only] zero valid rows: 200, createdCount 0, audited, and the file is remembered', async () => {
      const csv = usersCsv([['bad', 'user', ''], ['b@example.com', 'boss', '']])
      const p = await previewOk(admin.token, csv)
      expect(p.validRows).toBe(0)
      const res = await confirm(p.importId)
      expect(res.status).toBe(200)
      expect(res.body).toMatchObject({ createdCount: 0, skippedCount: 0 })
      expect(await count('users')).toBe(BASE_USERS)
      expect((await journal()).total).toBe(1)
      const again = await upload(admin.token, csv, 'meme.csv')
      expect([again.status, again.body.code]).toEqual([409, 'import.already_imported'])
    })
  })

  describe('no double import', () => {
    it('[rule-foundation-import-no-double] a second confirmation of the same preview is 409 import.already_imported and creates nothing', async () => {
      const p = await previewOk(admin.token, usersCsv(twoValid))
      expect((await confirm(p.importId)).status).toBe(200)
      const before = await count('users')
      const second = await confirm(p.importId)
      expect([second.status, second.body.code]).toEqual([409, 'import.already_imported'])
      expect(await count('users')).toBe(before)
      expect((await journal()).total).toBe(1)
    })

    it('[rule-foundation-import-no-double] confirming a second preview of an already confirmed file is 409 and creates nothing', async () => {
      const csv = usersCsv(twoValid)
      const first = await previewOk(admin.token, csv, 'a.csv')
      const second = await previewOk(admin2.token, csv, 'b.csv')
      expect((await confirm(first.importId)).status).toBe(200)
      const res = await confirm(second.importId, admin2.token)
      expect([res.status, res.body.code]).toEqual([409, 'import.already_imported'])
      expect(await count('users')).toBe(BASE_USERS + 2)
    })

    it('[rule-foundation-import-no-double] [rule-foundation-import-confirm-atomic] two simultaneous confirmations of the same preview: one 200, one 409, accounts created once', async () => {
      const p = await previewOk(admin.token, usersCsv(twoValid))
      const results = await Promise.all([confirm(p.importId), confirm(p.importId)])
      expect(results.map((r) => r.status).sort()).toEqual([200, 409])
      expect(results.find((r) => r.status === 409)!.body.code).toBe('import.already_imported')
      expect(await count('users')).toBe(BASE_USERS + 2)
      expect((await journal()).total).toBe(1)
    })

    it('[rule-foundation-import-no-double] [rule-foundation-import-confirm-atomic] two previews of the same file confirmed simultaneously: one 200, one 409', async () => {
      const csv = usersCsv(twoValid)
      const a = await previewOk(admin.token, csv, 'a.csv')
      const b = await previewOk(admin.token, csv, 'b.csv')
      const results = await Promise.all([confirm(a.importId), confirm(b.importId)])
      expect(results.map((r) => r.status).sort()).toEqual([200, 409])
      expect(await count('users')).toBe(BASE_USERS + 2)
      expect(await count('credentials')).toBe(BASE_USERS + 2)
    })

    it('[rule-foundation-import-no-double] six simultaneous confirmations create the accounts exactly once', async () => {
      const p = await previewOk(admin.token, usersCsv(twoValid))
      const results = await Promise.all(Array.from({ length: 6 }, () => confirm(p.importId)))
      expect(results.filter((r) => r.status === 200)).toHaveLength(1)
      expect(results.filter((r) => r.status === 409)).toHaveLength(5)
      expect(await count('users')).toBe(BASE_USERS + 2)
    })
  })

  describe('state changed between preview and confirmation', () => {
    it('[rule-foundation-import-confirm-revalidates] an e-mail created elsewhere meanwhile is skipped (skippedCount), the other rows are created, no failure', async () => {
      const p = await previewOk(admin.token, usersCsv([...twoValid, ['bad', 'user', '']]))
      expect((await call('POST', '/users', admin.token, { email: 'nouveau1@example.com', password: PASSWORD, role: 'user' })).status).toBe(201)
      const res = await confirm(p.importId)
      expect(res.status).toBe(200)
      expect(res.body).toMatchObject({ createdCount: 1, skippedCount: 1 })
      expect(await emailsInDb()).toContain('nouveau2@example.com')
      expect(await count('users')).toBe(BASE_USERS + 2)
      expect(await sql("select 1 from base.users where email = 'nouveau1@example.com'")).toHaveLength(1)
    })

    it('[rule-foundation-import-confirm-revalidates] a group removed meanwhile: the rows citing it are skipped, never created without their memberships', async () => {
      const keep = await seedGroup('Garde')
      const gone = await seedGroup('Disparu')
      const p = await previewOk(
        admin.token,
        usersCsv([['avec-garde@example.com', 'user', 'Garde'], ['avec-disparu@example.com', 'user', 'Disparu'], ['sans@example.com', 'user', '']]),
      )
      expect(p.validRows).toBe(3)
      await sql('delete from base.group_users where group_id = $1', [gone.id])
      await sql('delete from base.groups where id = $1', [gone.id])
      const res = await confirm(p.importId)
      expect(res.status).toBe(200)
      expect(res.body).toMatchObject({ createdCount: 2, skippedCount: 1 })
      expect(await emailsInDb()).not.toContain('avec-disparu@example.com')
      const member = await sql('select 1 from base.group_users gu join base.users u on u.id = gu.user_id where u.email = $1 and gu.group_id = $2', ['avec-garde@example.com', keep.id])
      expect(member).toHaveLength(1)
    })
  })

  describe('atomicity', () => {
    it('[rule-foundation-import-confirm-atomic] a failure while writing leaves no account, no credential, no audit entry; the preview stays confirmable', async () => {
      await sql(`create or replace function base.acceptance_import_fail() returns trigger language plpgsql as $$
        begin if new.email = 'boom@example.com' then raise exception 'boom'; end if; return new; end $$`)
      await sql('create trigger acceptance_import_fail_trg before insert on base.users for each row execute function base.acceptance_import_fail()')
      let id = ''
      try {
        const p = await previewOk(admin.token, usersCsv([['avant@example.com', 'user', ''], ['boom@example.com', 'user', ''], ['apres@example.com', 'user', '']]))
        id = p.importId
        const failed = await confirm(id)
        expect(failed.status).toBeGreaterThanOrEqual(400)
        expect(await count('users')).toBe(BASE_USERS)
        expect(await count('credentials')).toBe(BASE_USERS)
        expect(await count('audit_logs')).toBe(0)
        const state = await sql('select status from base.import_previews where id = $1', [id])
        expect(state[0].status).toBe('previewed')
      } finally {
        await sql('drop trigger if exists acceptance_import_fail_trg on base.users')
        await sql('drop function if exists base.acceptance_import_fail()')
      }
      const retry = await confirm(id)
      expect(retry.status).toBe(200)
      expect(retry.body.createdCount).toBe(3)
      expect(await count('users')).toBe(BASE_USERS + 3)
      expect((await journal()).total).toBe(1)
    })
  })

  describe('audit trail', () => {
    it('[rule-foundation-import-audited] exactly one entry users:import-confirm: author, object type, importId, no scope, summary « Import de 2 comptes depuis « comptes.xlsx » »', async () => {
      const p = await previewOk(admin.token, usersXlsx(twoValid), 'comptes.xlsx')
      await confirm(p.importId)
      const j = await journal()
      expect(j.total).toBe(1)
      expect(j.entries[0]).toMatchObject({
        actor: { id: admin.id, email: 'admin@example.com' },
        action: 'users:import-confirm',
        objectType: 'Import de comptes',
        objectId: p.importId,
        scope: null,
        summary: 'Import de 2 comptes depuis « comptes.xlsx »',
      })
    })

    it('[rule-foundation-import-audited] singular: « Import de 1 compte depuis « un.csv » »; the author is the caller', async () => {
      const p = await previewOk(admin2.token, usersCsv([twoValid[0]]), 'un.csv')
      await confirm(p.importId, admin2.token)
      const j = await journal()
      expect(j.entries[0].summary).toBe('Import de 1 compte depuis « un.csv »')
      expect(j.entries[0].actor).toEqual({ id: admin2.id, email: 'admin2@example.com' })
    })

    it('[rule-foundation-import-audited] [rule-foundation-audit-summary-no-secret] neither the e-mails, nor the file content, nor any hash appear in the journal', async () => {
      const p = await previewOk(admin.token, usersCsv([['secret.personne@example.com', 'user', ''], ['bad', 'boss', '']]), 'sensible.csv')
      await confirm(p.importId)
      const dump = (await sql<{ t: string }>('select a::text as t from base.audit_logs a')).map((r) => r.t).join('\n')
      expect(dump.length).toBeGreaterThan(0)
      expect(dump).not.toContain('secret.personne')
      expect(dump).not.toMatch(/\$2[aby]\$\d{2}\$/)
      expect(JSON.stringify(await journal())).not.toContain('secret.personne')
    })

    it('[rule-foundation-import-audited] a refused confirmation (404, 409, 403, 401, 400) leaves no entry', async () => {
      const p = await previewOk(admin.token, usersCsv(twoValid))
      expect((await confirm(UNKNOWN_UUID)).status).toBe(404)
      expect((await confirm(p.importId, admin2.token)).status).toBe(404)
      expect((await confirm(p.importId, user.token)).status).toBe(403)
      expect((await plain('POST', confirmPath(p.importId))).status).toBe(401)
      expect((await confirm('pas-un-uuid')).status).toBe(400)
      expect(await count('audit_logs')).toBe(0)
      expect((await confirm(p.importId)).status).toBe(200)
      expect((await confirm(p.importId)).status).toBe(409)
      expect((await journal()).total).toBe(1)
    })

    it('[rule-foundation-import-audited] the preview itself is not traced, the confirmation is the only import entry', async () => {
      await previewOk(admin.token, usersCsv(twoValid), 'a.csv')
      const p = await previewOk(admin.token, usersCsv([twoValid[0]]), 'b.csv')
      expect(await count('audit_logs')).toBe(0)
      await confirm(p.importId)
      expect((await journal()).total).toBe(1)
    })
  })

  describe('unknown, expired and foreign previews', () => {
    it('[rule-foundation-import-preview-expires] an unknown importId is 404 import.preview_not_found', async () => {
      const res = await confirm(UNKNOWN_UUID)
      expect([res.status, res.body.code]).toEqual([404, 'import.preview_not_found'])
    })

    it('[rule-foundation-import-preview-expires] an expired preview is 404 import.preview_not_found and creates nothing', async () => {
      const p = await previewOk(admin.token, usersCsv(twoValid))
      await sql("update base.import_previews set expires_at = now() - interval '1 second' where id = $1", [p.importId])
      const res = await confirm(p.importId)
      expect([res.status, res.body.code]).toEqual([404, 'import.preview_not_found'])
      expect(await count('users')).toBe(BASE_USERS)
      expect(await count('audit_logs')).toBe(0)
    })

    it('[rule-foundation-import-preview-expires] a preview still being analysed is 404', async () => {
      const p = await previewOk(admin.token, usersCsv(twoValid))
      await sql("update base.import_previews set status = 'analyzing' where id = $1", [p.importId])
      const res = await confirm(p.importId)
      expect([res.status, res.body.code]).toEqual([404, 'import.preview_not_found'])
    })

    it('[rule-foundation-import-preview-owner] another administrator confirming a preview gets the same 404 import.preview_not_found as for an unknown id and nothing is created', async () => {
      const p = await previewOk(admin.token, usersCsv(twoValid))
      const foreign = await confirm(p.importId, admin2.token)
      const unknown = await confirm(UNKNOWN_UUID, admin2.token)
      expect(foreign.status).toBe(404)
      expect(foreign.body.code).toBe('import.preview_not_found')
      expect(foreign.body).toEqual(unknown.body)
      expect(await count('users')).toBe(BASE_USERS)
      expect(await count('audit_logs')).toBe(0)
      expect((await confirm(p.importId)).status).toBe(200)
    })
  })

  describe('permissions and parameters', () => {
    it('[rule-foundation-import-users-admin-only] an ordinary user gets 403 security.access_denied and creates nothing, anonymous gets 401', async () => {
      const p = await previewOk(admin.token, usersCsv(twoValid))
      const res = await confirm(p.importId, user.token)
      expect([res.status, res.body.code]).toEqual([403, 'security.access_denied'])
      expect((await plain('POST', confirmPath(p.importId))).status).toBe(401)
      expect((await plain('POST', confirmPath(p.importId), 'not-a-token')).status).toBe(401)
      expect(await count('users')).toBe(BASE_USERS)
      const state = await sql('select status from base.import_previews where id = $1', [p.importId])
      expect(state[0].status).toBe('previewed')
    })

    it('[rule-foundation-import-two-steps] a malformed importId is 400 for an administrator', async () => {
      const res = await confirm('pas-un-uuid')
      expect(res.status).toBe(400)
    })

    it('[rule-foundation-import-two-steps] confirm is the only operation that writes business rows: GET errors never creates accounts', async () => {
      const p = await previewOk(admin.token, usersCsv(twoValid))
      await plain('GET', `/users/imports/${p.importId}/errors`, admin.token)
      await plain('GET', '/users/imports/specification', admin.token)
      expect(await count('users')).toBe(BASE_USERS)
    })
  })
})
