import { sql, resetData, closePool, API_URL } from './harness'
import { userWithToken, call } from './scope-helpers'
import { plain, upload, buildXlsx, HEADER, count, confirmPath, errorsPath, type Row } from './import-helpers'

// Acceptance suite of version socle-import-excel: very large files (several hundred thousand rows).
// Black box: the API must answer exact counts, never 500, and paginate the errors.
// Memory is not observable through the API (see COVERAGE-socle-import-excel.md).
jest.setTimeout(600000)

describe('very large imports', () => {
  let admin: Awaited<ReturnType<typeof userWithToken>>

  /** `n` data rows; every 20th (5 %) has an invalid role. Returns the CSV and the expected counts. */
  const bigRows = (n: number) => {
    const errorEvery = 20
    const bad = Math.floor(n / errorEvery)
    return { n, bad, valid: n - bad, role: (i: number) => (i % errorEvery === 0 ? 'mauvais' : i % 2 ? 'user' : 'admin') }
  }

  beforeEach(async () => {
    await resetData()
    admin = await userWithToken('admin@example.com', 'admin')
  })
  afterAll(async () => {
    await closePool()
  })

  it('[rule-foundation-import-large-files] [rule-foundation-import-errors-paginated] a 300,000-row .csv with 5 % of errors: exact counts, paginated errors sorted by row, confirmation creates the valid rows, same file refused afterwards', async () => {
    const { n, bad, valid, role } = bigRows(300_000)
    const parts: string[] = ['email,role,groupes']
    for (let i = 1; i <= n; i++) parts.push(`gros${i}@example.com,${role(i)},`)
    const csv = Buffer.from(parts.join('\n') + '\n')

    const res = await upload(admin.token, csv, 'gros.csv')
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ totalRows: n, validRows: valid, errorRows: bad })

    const first = await plain('GET', errorsPath(res.body.importId, '?size=100'), admin.token)
    expect(first.status).toBe(200)
    expect(first.body.total).toBe(bad)
    expect(first.body.errors[0]).toMatchObject({ row: 21, column: 'role' })
    const last = await plain('GET', errorsPath(res.body.importId, `?from=${bad - 1}&size=100`), admin.token)
    expect(last.body.errors).toHaveLength(1)
    expect(last.body.errors[0].row).toBe(n + 1)
    expect(await count('users')).toBe(1) // preview wrote no account

    const confirmed = await plain('POST', confirmPath(res.body.importId), admin.token)
    expect(confirmed.status).toBe(200)
    expect(confirmed.body).toMatchObject({ createdCount: valid, skippedCount: 0 })
    expect(await count('users')).toBe(1 + valid)
    const list = await call('GET', '/users?size=1', admin.token)
    expect(list.body.total).toBe(1 + valid)

    const again = await upload(admin.token, csv, 'gros-copie.csv')
    expect([again.status, again.body.code]).toEqual([409, 'import.already_imported'])
  })

  it('[rule-foundation-import-large-files] a 200,000-row .xlsx with 5 % of errors is analysed without error, counts are exact, confirmation creates the valid rows', async () => {
    const { n, bad, valid, role } = bigRows(200_000)
    const rows: Row[] = [HEADER]
    for (let i = 1; i <= n; i++) rows.push([`xl${i}@example.com`, role(i), ''])
    const xlsx = buildXlsx(rows)

    const res = await upload(admin.token, xlsx, 'gros.xlsx')
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ totalRows: n, validRows: valid, errorRows: bad })
    const errors = await plain('GET', errorsPath(res.body.importId, '?size=100'), admin.token)
    expect(errors.body.total).toBe(bad)
    expect(errors.body.errors[0].row).toBe(21)

    const confirmed = await plain('POST', confirmPath(res.body.importId), admin.token)
    expect(confirmed.status).toBe(200)
    expect(confirmed.body).toMatchObject({ createdCount: valid, skippedCount: 0 })
    expect(await count('users')).toBe(1 + valid)
    const again = await upload(admin.token, xlsx, 'gros-copie.xlsx')
    expect(again.status).toBe(409)
  })

  it('[rule-foundation-import-large-files] [rule-foundation-import-in-file-duplicates] 100,000 rows all carrying the same address: one valid row, every other row a duplicate error', async () => {
    const n = 100_000
    const csv = Buffer.from('email,role,groupes\n' + new Array(n).fill('meme@example.com,user,').join('\n') + '\n')
    const res = await upload(admin.token, csv, 'doublons.csv')
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ totalRows: n, validRows: 1, errorRows: n - 1 })
    const page = await plain('GET', errorsPath(res.body.importId, '?size=1'), admin.token)
    expect(page.body.total).toBe(n - 1)
    expect(page.body.errors[0]).toMatchObject({ row: 3, column: 'email' })
    expect(page.body.errors[0].reason).toContain('à la ligne 2')
  })

  it('[rule-foundation-import-trapped-files-refused] [rule-foundation-import-temp-cleanup] a client closing the connection during the analysis of a large file leaves no preview', async () => {
    const n = 300_000
    const csv = Buffer.from('email,role,groupes\n' + Array.from({ length: n }, (_, i) => `ab${i}@example.com,user,`).join('\n') + '\n')
    const controller = new AbortController()
    const form = new FormData()
    form.append('file', new Blob([csv]), 'abandon.csv')
    const sent = fetch(`${API_URL}/users/imports/preview`, {
      method: 'POST',
      headers: { authorization: `Bearer ${admin.token}` },
      body: form,
      signal: controller.signal,
    }).catch(() => undefined)
    await new Promise((r) => setTimeout(r, 400))
    controller.abort()
    await sent
    let remaining = -1
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 1000))
      remaining = Number((await sql<{ n: string }>("select count(*)::text as n from base.import_previews where status = 'analyzing'"))[0].n)
      if (remaining === 0) break
    }
    expect(remaining).toBe(0)
    expect(await count('import_previews')).toBe(0)
    expect(await count('users')).toBe(1)
  })
})
