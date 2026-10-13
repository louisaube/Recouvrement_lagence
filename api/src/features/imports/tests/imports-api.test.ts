import { readdir } from 'node:fs/promises'
import { API_URL, ApiResponse, call, closePool, createUser, login, resetData, sql } from '../../../platform/testing/helpers'
import { IMPORT_TEMP_DIR } from '../receive'
import { csv, usersCsv, usersXlsx, xlsx, zip } from './files'

const UNKNOWN = '00000000-0000-4000-8000-000000000000'
const DUPLICATE = (n: number) => `Adresse déjà présente à la ligne ${n} du fichier : seule la première occurrence est retenue.`

describe('users import routes', () => {
  let admin: { id: string; token: string }
  let user: { id: string; token: string }

  const account = async (email: string, role: 'admin' | 'user') => {
    const created = await createUser({ email, role })
    return { id: created.id, token: await login(email) }
  }
  const auth = (token?: string): Record<string, string> => (token ? { authorization: `Bearer ${token}` } : {})
  const upload = (content: Buffer, name = 'comptes.csv', token: string | undefined = admin.token) => {
    const form = new FormData()
    form.append('file', new Blob([new Uint8Array(content)]), name)
    return fetch(`${API_URL}/users/imports/preview`, { method: 'POST', headers: auth(token), body: form }) as Promise<ApiResponse>
  }
  const preview = async (content: Buffer, name?: string) => {
    const res = await upload(content, name)
    expect(res.status).toBe(200)
    return (await res.json()) as { importId: string; fileName: string; totalRows: number; validRows: number; errorRows: number; expiresAt: string }
  }
  const confirm = (importId: string, token: string | undefined = admin.token) =>
    call(`/users/imports/${importId}/confirm`, { method: 'POST', headers: auth(token) })
  const errors = (importId: string, query = '', token: string | undefined = admin.token) =>
    call(`/users/imports/${importId}/errors${query}`, { headers: auth(token) })
  const emails = async () => (await sql<{ email: string }>('select email from base.users order by email')).map((r) => r.email)
  const tempFiles = async () => readdir(IMPORT_TEMP_DIR).catch(() => [] as string[])

  beforeEach(async () => {
    await resetData()
    admin = await account('admin@example.com', 'admin')
    user = await account('user@example.com', 'user')
  })
  afterAll(closePool)

  it('[rule-foundation-import-users-columns] the specification lists the three columns, the limits and the extensions', async () => {
    const res = await call('/users/imports/specification', { headers: auth(admin.token) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.columns.map((c: any) => [c.name, c.required])).toEqual([['email', true], ['role', true], ['groupes', false]])
    expect(body).toMatchObject({ maxFileSizeBytes: 104857600, maxRows: 1000000, acceptedExtensions: ['.xlsx', '.csv'] })
  })

  it('[rule-foundation-import-users-admin-only] every import route is closed to a user (403) and to an anonymous caller (401)', async () => {
    const routes: [string, string][] = [
      ['GET', '/users/imports/specification'],
      ['POST', '/users/imports/preview'],
      ['GET', `/users/imports/${UNKNOWN}/errors`],
      ['POST', `/users/imports/${UNKNOWN}/confirm`],
    ]
    for (const [method, path] of routes) {
      expect((await call(path, { method, headers: auth(user.token) })).status).toBe(403)
      expect((await call(path, { method })).status).toBe(401)
    }
    expect((await upload(usersCsv([['a@example.com', 'user', null]]), 'c.csv', user.token)).status).toBe(403)
    expect(await tempFiles()).toEqual([])
  })

  it('[rule-foundation-import-preview-content] [rule-foundation-import-two-steps] a CSV and a workbook give the same counts; nothing is created before confirmation', async () => {
    const rows = [['a@example.com', 'user', null], ['b@example.com', 'admin', null], ['mauvais', 'user', null], ['c@example.com', 'chef', null]]
    const fromCsv = await preview(usersCsv(rows))
    const fromXlsx = await preview(usersXlsx(rows), 'comptes.xlsx')
    for (const p of [fromCsv, fromXlsx]) expect(p).toMatchObject({ totalRows: 4, validRows: 2, errorRows: 2 })
    expect(fromXlsx.fileName).toBe('comptes.xlsx')
    expect(Date.parse(fromCsv.expiresAt) - Date.now()).toBeGreaterThan(60 * 60 * 1000)
    expect(await emails()).toEqual(['admin@example.com', 'user@example.com'])
    expect(await tempFiles()).toEqual([])
  })

  it('[rule-foundation-import-errors-paginated] the errors come by row then by column, in pages, with the total of entries', async () => {
    const rows = Array.from({ length: 25 }, (_, i) => [`mauvais${i}`, 'chef', null])
    const p = await preview(usersCsv(rows))
    expect(p).toMatchObject({ totalRows: 25, validRows: 0, errorRows: 25 })
    const first = await (await errors(p.importId)).json()
    expect(first.total).toBe(50)
    expect(first.errors).toHaveLength(10)
    expect(first.errors.slice(0, 2).map((e: any) => [e.row, e.column])).toEqual([[2, 'email'], [2, 'role']])
    const all = (await (await errors(p.importId, '?size=100')).json()).errors as any[]
    expect(all).toHaveLength(50)
    expect(all.map((e) => e.row)).toEqual([...all.map((e) => e.row)].sort((a, b) => a - b))
    expect((await (await errors(p.importId, '?from=45&size=100')).json()).errors).toEqual(all.slice(45))
    expect((await (await errors(p.importId, '?from=500')).json()).errors).toEqual([])
    for (const bad of ['?size=0', '?size=101', '?from=-1', '?size=x', '?from=1.5']) expect((await errors(p.importId, bad)).status).toBe(400)
  })

  it('[rule-foundation-import-in-file-duplicates] only the first occurrence of an address is kept (exact comparison); later ones are faults', async () => {
    const p = await preview(usersCsv([['a@example.com', 'user', null], ['x@example.com', 'user', null], ['A@Example.com', 'admin', null], ['a@example.com', 'user', null]]))
    // `A@Example.com` is another account: the comparison is exact, as for the accounts themselves
    expect(p).toMatchObject({ totalRows: 4, validRows: 3, errorRows: 1 })
    const list = (await (await errors(p.importId)).json()).errors
    expect(list).toEqual([{ row: 5, column: 'email', reason: DUPLICATE(2) }])
  })

  it('[rule-foundation-import-users-email] an address already registered is a fault, not a creation (exact comparison)', async () => {
    const p = await preview(usersCsv([['user@example.com', 'user', null], ['USER@example.com', 'user', null], ['new@example.com', 'user', null]]))
    expect(p).toMatchObject({ validRows: 2, errorRows: 1 })
    const [fault] = (await (await errors(p.importId)).json()).errors
    expect(fault).toMatchObject({ row: 2, column: 'email' })
  })

  it('[rule-foundation-import-preview-content] a row has one entry per faulty column, even for a repeated address that already has an account', async () => {
    const p = await preview(usersCsv([['user@example.com', 'user', null], ['user@example.com', 'user', null]]))
    expect(p).toMatchObject({ totalRows: 2, validRows: 0, errorRows: 2 })
    const list = (await (await errors(p.importId)).json()).errors
    expect(list.map((e: any) => [e.row, e.column])).toEqual([[2, 'email'], [3, 'email']])
  })

  it('[rule-foundation-import-content-sniffing] a .csv whose header merely starts with "PK" is not taken for an archive', async () => {
    const p = await preview(csv([['PKey', 'email', 'role'], ['1', 'a@example.com', 'user']]))
    expect(p).toMatchObject({ totalRows: 1, validRows: 1, errorRows: 0 })
  })

  it('[rule-foundation-import-confirm-valid-only] [rule-foundation-import-audited] [rule-foundation-import-confirm-atomic] confirming creates the accounts and their groups, leaves one trace, and consumes the preview', async () => {
    await sql("insert into base.scopes (code, name) values ('s1', 'S1')")
    const scope = (await sql<{ id: string }>("select id from base.scopes where code = 's1'"))[0]
    const g = await (await call('/groups', { method: 'POST', headers: auth(admin.token), body: { name: 'Équipe', userIds: [], scopeIds: [scope.id] } })).json()
    const p = await preview(usersCsv([['a@example.com', 'user', 'équipe'], ['b@example.com', 'admin', null], ['c@example.com', 'user', 'Inconnu']]), 'mon fichier.csv')
    expect(p).toMatchObject({ validRows: 2, errorRows: 1 })

    const res = await confirm(p.importId)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ importId: p.importId, createdCount: 2, skippedCount: 0, fileName: 'mon fichier.csv' })
    expect(await emails()).toEqual(['a@example.com', 'admin@example.com', 'b@example.com', 'user@example.com'])
    const members = await sql<{ user_id: string }>('select user_id from base.group_users where group_id = $1', [g.group.id])
    expect(members).toHaveLength(1)
    expect((await sql('select role from base.users where email = $1', ['b@example.com']))[0].role).toBe('admin')

    const trace = await sql('select * from base.audit_logs')
    expect(trace).toHaveLength(2) // the group creation and the import
    const entries = (await (await call('/audit-logs?size=10', { headers: auth(admin.token) })).json()).entries
    expect(entries[0]).toMatchObject({
      action: 'users:import-confirm',
      objectType: 'Import de comptes',
      objectId: p.importId,
      scope: null,
      summary: 'Import de 2 comptes depuis « mon fichier.csv »',
    })

    // the preview is consumed: it can neither be confirmed again nor read
    expect((await confirm(p.importId)).status).toBe(409)
    expect((await errors(p.importId)).status).toBe(404)
    expect((await sql('select 1 from base.import_preview_rows')).length).toBe(0)
  })

  it('[rule-foundation-import-users-no-password] imported accounts hold a credential nobody knows', async () => {
    const p = await preview(usersCsv([['a@example.com', 'user', null]]))
    await confirm(p.importId)
    const credentials = await sql("select c.type from base.credentials c join base.users u on u.id = c.user_id where u.email = 'a@example.com'")
    expect(credentials).toEqual([{ type: 'token' }])
    const res = await call('/auth/login', { method: 'POST', body: { email: 'a@example.com', password: 'Passw0rd!x', returnToken: true } })
    expect(res.status).toBe(401)
  })

  it('[rule-foundation-import-confirm-revalidates] a group deleted between preview and confirmation is skipped, and the row counted as skipped', async () => {
    await sql("insert into base.scopes (code, name) values ('s1', 'S1')")
    const scope = (await sql<{ id: string }>("select id from base.scopes where code = 's1'"))[0]
    const g = await (await call('/groups', { method: 'POST', headers: auth(admin.token), body: { name: 'Éphémère', userIds: [], scopeIds: [scope.id] } })).json()
    const p = await preview(usersCsv([['a@example.com', 'user', 'Éphémère'], ['b@example.com', 'user', null]]))
    await sql('delete from base.groups where id = $1', [g.group.id])
    const res = await (await confirm(p.importId)).json()
    expect(res).toMatchObject({ createdCount: 1, skippedCount: 1 })
    expect(await emails()).toEqual(['admin@example.com', 'b@example.com', 'user@example.com'])
  })

  it('[rule-foundation-import-confirm-revalidates] an address registered between preview and confirmation is skipped without failing the rest', async () => {
    const p = await preview(usersCsv([['a@example.com', 'user', null], ['b@example.com', 'user', null]]))
    await createUser({ email: 'a@example.com' })
    expect(await (await confirm(p.importId)).json()).toMatchObject({ createdCount: 1, skippedCount: 1 })
  })

  it('[rule-foundation-import-preview-owner] a preview belongs to the admin who sent it: another admin sees a 404', async () => {
    const other = await account('autre@example.com', 'admin')
    const p = await preview(usersCsv([['a@example.com', 'user', null]]))
    expect((await errors(p.importId, '', other.token)).status).toBe(404)
    expect((await confirm(p.importId, other.token)).status).toBe(404)
    expect((await errors(UNKNOWN)).status).toBe(404)
    expect((await errors('pas-un-uuid')).status).toBe(400)
    expect((await confirm(p.importId)).status).toBe(200)
  })

  it('[rule-foundation-import-no-double] the same file cannot be imported twice, and two simultaneous confirmations create once', async () => {
    const content = usersCsv([['a@example.com', 'user', null], ['b@example.com', 'user', null]])
    const first = await preview(content)
    const second = await preview(content)
    const results = await Promise.all([confirm(first.importId), confirm(first.importId), confirm(second.importId)])
    expect(results.filter((r) => r.status === 200)).toHaveLength(1)
    expect(results.filter((r) => r.status === 409)).toHaveLength(2)
    expect((await emails()).length).toBe(4)
    expect((await sql('select 1 from base.audit_logs where action = $1', ['users:import-confirm'])).length).toBe(1)
    const again = await upload(content)
    expect(again.status).toBe(409)
    expect((await again.json()).code).toBe('import.already_imported')
    expect(await tempFiles()).toEqual([])
  })

  it('[rule-foundation-import-preview-expires] an expired preview is gone for the errors and for the confirmation', async () => {
    const p = await preview(usersCsv([['a@example.com', 'user', null]]))
    await sql("update base.import_previews set expires_at = now() - interval '1 minute'")
    expect((await errors(p.importId)).status).toBe(404)
    expect((await confirm(p.importId)).status).toBe(404)
    expect(await emails()).not.toContain('a@example.com')
    // the next preview purges it
    await preview(usersCsv([['b@example.com', 'user', null]]))
    expect((await sql('select 1 from base.import_previews where id = $1', [p.importId])).length).toBe(0)
  })

  describe('refused files', () => {
    const refused = async (content: Buffer, name: string, status: number, code: string) => {
      const res = await upload(content, name)
      expect(res.status).toBe(status)
      expect((await res.json()).code).toBe(code)
      expect(await tempFiles()).toEqual([])
      expect((await sql('select 1 from base.import_previews')).length).toBe(0)
    }

    it('[rule-foundation-import-formats] wrong extension, signature or encoding: import.invalid_file_type', async () => {
      await refused(Buffer.from('x'), 'a.txt', 400, 'import.invalid_file_type')
      await refused(Buffer.from('email,role\n'), 'noext', 400, 'import.invalid_file_type')
      await refused(Buffer.from('not a zip'), 'a.xlsx', 400, 'import.invalid_file_type')
      await refused(Buffer.alloc(0), 'a.csv', 400, 'import.invalid_file_type')
      await refused(Buffer.from('email,role\na\u0000b,user\n'), 'a.csv', 400, 'import.invalid_file_type')
      await refused(Buffer.from([0x65, 0x6d, 0xff, 0xfe, 0x0a]), 'a.csv', 400, 'import.invalid_file_type')
    })

    it('[rule-foundation-import-header-matching] [rule-foundation-import-limits] a missing required column, or a file with no header, is import.missing_columns; no data row is import.empty_file', async () => {
      await refused(csv([['email'], ['a@example.com']]), 'a.csv', 400, 'import.missing_columns')
      await refused(Buffer.from('\n\n'), 'a.csv', 400, 'import.missing_columns')
      await refused(usersCsv([]), 'a.csv', 400, 'import.empty_file')
      await refused(usersCsv([[null, null, null]]), 'a.csv', 400, 'import.empty_file')
    })

    it('[rule-foundation-import-header-matching] the header is case-insensitive and trimmed; an unknown column is ignored; the first of two identical columns wins', async () => {
      const p = await preview(csv([[' Email ', 'ROLE', 'autre', 'email'], ['a@example.com', 'user', 'x', 'bad']]))
      expect(p).toMatchObject({ validRows: 1, errorRows: 0 })
    })

    it('[rule-foundation-import-archive-limits] trapped workbooks are refused and leave nothing', async () => {
      const base = usersXlsx([['a@example.com', 'user', null]])
      expect(base.length).toBeGreaterThan(0)
      await refused(usersXlsx([['a@example.com', 'user', null]], { extra: [{ name: 'xl/vbaProject.bin', data: 'x' }] }), 'a.xlsx', 400, 'import.unsafe_archive')
      await refused(usersXlsx([['a@example.com', 'user', null]], { extra: [{ name: '../evil.xml', data: '<a/>' }] }), 'a.xlsx', 400, 'import.unsafe_archive')
      await refused(usersXlsx([['a@example.com', 'user', null]], { extra: [{ name: 'xl/secret.xml', data: 'x', encrypted: true }] }), 'a.xlsx', 400, 'import.unsafe_archive')
      await refused(usersXlsx([['a@example.com', 'user', null]], { extra: [{ name: 'xl/lie.xml', data: 'x'.repeat(100), declaredSize: 5 }] }), 'a.xlsx', 400, 'import.unsafe_archive')
      await refused(usersXlsx([['a@example.com', 'user', null]], { extra: [{ name: 'xl/dtd.xml', data: '<!DOCTYPE a [<!ENTITY x "y">]><a/>' }] }), 'a.xlsx', 400, 'import.unsafe_archive')
      await refused(zip(Array.from({ length: 1001 }, (_, i) => ({ name: `p${i}.xml`, data: '<a/>' }))), 'a.xlsx', 400, 'import.unsafe_archive')
    })

    it('[rule-foundation-import-external-links-refused] external links, relationships and formulas: import.external_links', async () => {
      const rows = [['a@example.com', 'user', null]] as Parameters<typeof usersXlsx>[0]
      await refused(usersXlsx(rows, { extra: [{ name: 'xl/externalLinks/externalLink1.xml', data: '<a/>' }] }), 'a.xlsx', 400, 'import.external_links')
      await refused(
        usersXlsx(rows, { sheetRels: '<Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/oleObject" Target="http://exemple.invalid/x" TargetMode="External"/>' }),
        'a.xlsx',
        400,
        'import.external_links',
      )
      await refused(usersXlsx([[{ value: 'a@example.com', formula: "'C:\\x\\[a.xlsx]S'!A1" }, 'user', null]]), 'a.xlsx', 400, 'import.external_links')
      // an internal formula and a hyperlink are tolerated
      const ok = await upload(
        usersXlsx([[{ value: 'a@example.com', formula: 'LOWER("A@EXAMPLE.COM")' }, 'user', null]], {
          sheetRels: '<Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://exemple.invalid" TargetMode="External"/>',
        }),
        'a.xlsx',
      )
      expect(ok.status).toBe(200)
    })

    it('[rule-foundation-import-formats] a body that is not a single "file" part is a 400 api.validation.incoming_failed', async () => {
      const send = (form: FormData) =>
        fetch(`${API_URL}/users/imports/preview`, { method: 'POST', headers: auth(admin.token), body: form }) as Promise<ApiResponse>
      const blob = () => new Blob([new Uint8Array(usersCsv([['a@example.com', 'user', null]]))])
      const wrongName = new FormData()
      wrongName.append('fichier', blob(), 'a.csv')
      const two = new FormData()
      two.append('file', blob(), 'a.csv')
      two.append('file', blob(), 'b.csv')
      const longField = new FormData()
      longField.append('note', 'x'.repeat(2000))
      longField.append('file', blob(), 'a.csv')
      const none = new FormData()
      none.append('note', 'x')
      for (const form of [wrongName, two, longField, none, new FormData()]) {
        const res = await send(form)
        expect(res.status).toBe(400)
        expect((await res.json()).code).toBe('api.validation.incoming_failed')
      }
      const json = await call('/users/imports/preview', { method: 'POST', headers: auth(admin.token), body: { file: 'x' } })
      expect(json.status).toBe(400)
      expect(await tempFiles()).toEqual([])
    })

    it('[rule-foundation-import-formats] a file name with a path, a NUL or control characters is kept as a clean base name', async () => {
      const p = await preview(usersCsv([['a@example.com', 'user', null]]), 'C:\\Users\\x\\co\u0000mptes.csv')
      expect(p.fileName).toBe('co mptes.csv')
      const q = await preview(usersCsv([['b@example.com', 'user', null]]), '../../etc/passwd.csv')
      expect(q.fileName).toBe('passwd.csv')
    })
  })

  it('[rule-foundation-import-large-files] a file above the declared limit is refused at once with a 413', async () => {
    const body = Buffer.alloc(101 * 1024 * 1024 + 1024, 0x61)
    const res = await upload(Buffer.concat([Buffer.from('email,role\n'), body]), 'gros.csv').catch(() => null)
    // the server may cut the connection once it has answered: either the 413 is read, or the socket is closed
    if (res) {
      expect(res.status).toBe(413)
      expect((await res.json()).code).toBe('import.file_too_large')
    }
    expect(await tempFiles()).toEqual([])
    expect((await sql('select 1 from base.import_previews')).length).toBe(0)
  })

  it('[rule-foundation-import-cell-normalisation] a fault is reported on the spreadsheet row, even after gaps and blank rows', async () => {
    const buffer = xlsx(
      [['email', 'role', 'groupes'], ['a@example.com', 'user'], [], ['  ', null], ['mauvais', 'user']],
      { rowNumbers: [1, 2, 5, 6, 12] },
    )
    const p = await preview(buffer, 'trous.xlsx')
    const list = (await (await errors(p.importId)).json()).errors
    expect(p.validRows).toBe(1)
    expect(list.map((e: any) => e.row)).toContain(12)
  })
})
