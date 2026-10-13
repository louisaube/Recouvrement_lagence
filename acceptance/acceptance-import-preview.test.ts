import * as zlib from 'node:zlib'
import { sql, resetData, closePool } from './harness'
import { userWithToken, seedGroup, call } from './scope-helpers'
import {
  upload, rawMultipart, plain, hugeDeclaredBody, buildCsv, usersCsv, usersXlsx, buildXlsx, buildZip,
  previewOk, allErrors, errorsOfRow, count, confirmPath, errorsPath, PREVIEW, type Row, type ZipEntry,
} from './import-helpers'

// Acceptance suite of version socle-import-excel: POST /users/imports/preview
// (formats, header, numbering, two steps, duplicates, trapped files, multipart shape, no double, permissions).
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

describe('POST /users/imports/preview', () => {
  let admin: Awaited<ReturnType<typeof userWithToken>>
  let admin2: Awaited<ReturnType<typeof userWithToken>>
  let user: Awaited<ReturnType<typeof userWithToken>>

  const previewCount = () => count('import_previews')
  const expectRefused = async (file: Buffer, name: string, status: number | number[], code: string | string[]) => {
    const before = await previewCount()
    const res = await upload(admin.token, file, name)
    const statuses = Array.isArray(status) ? status : [status]
    const codes = Array.isArray(code) ? code : [code]
    expect(statuses).toContain(res.status)
    expect(codes).toContain(res.body?.code)
    expect(await previewCount()).toBe(before)
    expect(await count('users')).toBe(3)
  }
  const xlsxWith = (opts: Parameters<typeof usersXlsx>[1]) => usersXlsx([['a@example.com', 'user', '']], opts)
  const entry = (name: string, data: Buffer | string = '<x/>', extra: Partial<ZipEntry> = {}): ZipEntry => ({ name, data, ...extra })

  beforeEach(async () => {
    await resetData()
    admin = await userWithToken('admin@example.com', 'admin')
    admin2 = await userWithToken('admin2@example.com', 'admin')
    user = await userWithToken('user@example.com', 'user')
  })
  afterAll(async () => {
    await closePool()
  })

  describe('accepted files and counts', () => {
    const rows: Row[] = [
      ['a@example.com', 'user', ''],
      ['b@example.com', 'admin', 'Équipe A'],
      ['c@example.com', 'boss', ''],
    ]

    it('[rule-foundation-import-formats] [rule-foundation-import-preview-content] a .csv gives importId, fileName, totalRows = validRows + errorRows (rows, not errors) and expiresAt', async () => {
      await seedGroup('Équipe A')
      const res = await upload(admin.token, usersCsv([...rows, ['d@example.com', 'boss', 'Inconnu']]), 'comptes.csv')
      expect(res.status).toBe(200)
      expect(res.body.importId).toMatch(UUID)
      expect(res.body.fileName).toBe('comptes.csv')
      expect(res.body).toMatchObject({ totalRows: 4, validRows: 2, errorRows: 2 })
      expect(res.body.totalRows).toBe(res.body.validRows + res.body.errorRows)
      expect(Number.isNaN(Date.parse(res.body.expiresAt))).toBe(false)
      const errors = await allErrors(admin.token, res.body.importId)
      expect(errors.length).toBeGreaterThan(res.body.errorRows) // row 5 has two faulty columns: entries >= rows
    })

    it('[rule-foundation-import-formats] [rule-foundation-import-header-matching] a .xlsx gives the same counts as the same data in .csv', async () => {
      await seedGroup('Équipe A')
      const res = await upload(admin.token, usersXlsx(rows), 'comptes.xlsx')
      expect(res.status).toBe(200)
      expect(res.body).toMatchObject({ fileName: 'comptes.xlsx', totalRows: 3, validRows: 2, errorRows: 1 })
    })

    it('[rule-foundation-import-formats] the extension is case-insensitive', async () => {
      const res = await upload(admin.token, usersCsv([rows[0]]), 'COMPTES.CSV')
      expect(res.status).toBe(200)
      expect(res.body.validRows).toBe(1)
    })

    it.each([
      ['semicolon delimiter', { delimiter: ';' }],
      ['comma delimiter with BOM', { bom: true }],
      ['semicolon with BOM and CRLF', { delimiter: ';', bom: true, eol: '\r\n' }],
      ['CRLF without final line break', { eol: '\r\n', finalEol: false }],
    ])('[rule-foundation-import-formats] [rule-foundation-import-header-matching] .csv variant: %s', async (_label, opts) => {
      await seedGroup('Équipe A')
      const res = await upload(admin.token, usersCsv(rows, opts as any), 'v.csv')
      expect(res.status).toBe(200)
      expect(res.body).toMatchObject({ totalRows: 3, validRows: 2, errorRows: 1 })
    })

    it('[rule-foundation-import-header-matching] RFC 4180 quoting: a quoted cell with a line break and doubled quotes stays one record', async () => {
      await seedGroup('Équipe A')
      await seedGroup('Équipe B')
      const csv = Buffer.from('email,role,groupes\r\n"a@example.com",user,"Équipe A;\r\nÉquipe B"\r\n"b@example.com","user",""\r\n', 'utf8')
      const res = await upload(admin.token, csv, 'q.csv')
      expect(res.status).toBe(200)
      expect(res.body).toMatchObject({ totalRows: 2, validRows: 2, errorRows: 0 })
      const bad = Buffer.from('email,role,groupes\n"a@example.com",user,"Il a dit ""non"""\n', 'utf8')
      const res2 = await upload(admin.token, bad, 'q2.csv')
      expect(res2.body).toMatchObject({ totalRows: 1, validRows: 0, errorRows: 1 })
    })

    it('[rule-foundation-import-header-matching] only the first sheet of a workbook is read', async () => {
      const res = await upload(admin.token, usersXlsx([['a@example.com', 'user', '']], { secondSheetRows: [['x', 'y'], ['z', 'w']] }), 'deux.xlsx')
      expect(res.status).toBe(200)
      expect(res.body).toMatchObject({ totalRows: 1, validRows: 1, errorRows: 0 })
    })
  })

  describe('header', () => {
    it('[rule-foundation-import-header-matching] columns in any order, extra columns ignored', async () => {
      const csv = buildCsv([
        ['nom', 'role', 'commentaire', 'email', 'groupes'],
        ['Alice', 'user', 'ok', 'a@example.com', ''],
        ['Bob', 'admin', '', 'b@example.com', ''],
      ])
      const res = await upload(admin.token, csv, 'ordre.csv')
      expect(res.status).toBe(200)
      expect(res.body).toMatchObject({ totalRows: 2, validRows: 2, errorRows: 0 })
    })

    it('[rule-foundation-import-header-matching] names are compared without case nor edge spaces; the optional column may be absent', async () => {
      const res = await upload(admin.token, buildCsv([[' EMAIL ', ' Role'], ['a@example.com', 'user']]), 'casse.csv')
      expect(res.status).toBe(200)
      expect(res.body).toMatchObject({ totalRows: 1, validRows: 1, errorRows: 0 })
      const xlsx = await upload(admin.token, buildXlsx([[' EMAIL ', ' Role ', 'GROUPES'], ['a@example.com', 'user', '']]), 'casse.xlsx')
      expect(xlsx.status).toBe(200)
      expect(xlsx.body.validRows).toBe(1)
    })

    it('[rule-foundation-import-header-matching] "e-mail" is another name: 400 import.missing_columns', async () => {
      const res = await upload(admin.token, buildCsv([['e-mail', 'role', 'groupes'], ['a@example.com', 'user', '']]), 'autre.csv')
      expect(res.status).toBe(400)
      expect(res.body.code).toBe('import.missing_columns')
    })

    it('[rule-foundation-import-header-matching] a missing required column (role) is 400 import.missing_columns and keeps nothing', async () => {
      await expectRefused(buildCsv([['email', 'groupes'], ['a@example.com', '']]), 'sans-role.csv', 400, 'import.missing_columns')
      await expectRefused(buildXlsx([['email', 'groupes'], ['a@example.com', '']]), 'sans-role.xlsx', 400, 'import.missing_columns')
    })

    it('[rule-foundation-import-header-matching] a repeated header uses its first occurrence', async () => {
      const csv = buildCsv([
        ['email', 'role', 'groupes', 'email'],
        ['a@example.com', 'user', '', 'pas-un-email'],
      ])
      const res = await upload(admin.token, csv, 'repete.csv')
      expect(res.status).toBe(200)
      expect(res.body).toMatchObject({ totalRows: 1, validRows: 1, errorRows: 0 })
    })

    it('[rule-foundation-import-header-matching] an empty first row: 400 import.missing_columns (xlsx) or import.invalid_file_type/missing_columns (csv without header)', async () => {
      await expectRefused(buildXlsx([[], ['a@example.com', 'user', '']], { rowNumbers: [1, 2] }), 'vide1.xlsx', 400, 'import.missing_columns')
      await expectRefused(Buffer.from('\n\na@example.com,user,\n'), 'vide1.csv', 400, ['import.missing_columns', 'import.invalid_file_type'])
    })

    it('[rule-foundation-import-header-matching] the header is the FIRST row: a header on row 2 is not found', async () => {
      await expectRefused(buildXlsx([['Liste des comptes'], ['email', 'role', 'groupes'], ['a@example.com', 'user', '']]), 'titre.xlsx', 400, 'import.missing_columns')
    })
  })

  describe('blank rows, numbering and cell values', () => {
    it('[rule-foundation-import-cell-normalisation] blank rows are ignored (not counted) but keep their number, in .csv', async () => {
      const csv = usersCsv([['a@example.com', 'user', ''], ['', '', ''], ['', '', ''], ['', '', ''], ['b@example.com', 'boss', '']])
      const res = await upload(admin.token, csv, 'trous.csv')
      expect(res.status).toBe(200)
      expect(res.body).toMatchObject({ totalRows: 2, validRows: 1, errorRows: 1 })
      expect(errorsOfRow(await allErrors(admin.token, res.body.importId), 6).map((e) => e[0])).toEqual(['role'])
    })

    it('[rule-foundation-import-cell-normalisation] blank rows keep their number in .xlsx (absent rows and rows of blank cells)', async () => {
      const xlsx = usersXlsx([['a@example.com', 'user', ''], ['   ', null, ''], ['b@example.com', 'boss', '']], { rowNumbers: [1, 2, 5, 9] })
      const res = await upload(admin.token, xlsx, 'trous.xlsx')
      expect(res.status).toBe(200)
      expect(res.body).toMatchObject({ totalRows: 2, validRows: 1, errorRows: 1 })
      const errors = await allErrors(admin.token, res.body.importId)
      expect(errors.map((e) => e.row)).toEqual([9])
    })

    it('[rule-foundation-import-cell-normalisation] cells are trimmed; a blank cell is absent', async () => {
      await seedGroup('Équipe A')
      const res = await upload(admin.token, usersCsv([['  a@example.com  ', ' admin ', ' Équipe A ; '], ['   ', 'user', '']]), 'espaces.csv')
      expect(res.body).toMatchObject({ totalRows: 2, validRows: 1, errorRows: 1 })
      const errors = await allErrors(admin.token, res.body.importId)
      expect(errors.map((e) => [e.row, e.column])).toEqual([[3, 'email']])
    })

    it('[rule-foundation-import-cell-normalisation] a formula is never evaluated: its cached value is read', async () => {
      const xlsx = usersXlsx([[{ value: 'calcule@example.com', formula: '"calcule"&"@example.com"' }, 'user', '']])
      const res = await upload(admin.token, xlsx, 'formule.xlsx')
      expect(res.status).toBe(200)
      expect(res.body).toMatchObject({ totalRows: 1, validRows: 1, errorRows: 0 })
    })

    it('[rule-foundation-import-cell-normalisation] a numeric cell is read as its text; an error cell (#REF!) fails the validation of its column', async () => {
      const xlsx = usersXlsx([[12345, 'user', ''], [{ value: '#REF!', error: true }, 'user', ''], ['ok@example.com', { value: '#N/A', error: true }, '']])
      const res = await upload(admin.token, xlsx, 'types.xlsx')
      expect(res.status).toBe(200)
      expect(res.body).toMatchObject({ totalRows: 3, validRows: 0, errorRows: 3 })
      const errors = await allErrors(admin.token, res.body.importId)
      expect(errors.find((e) => e.row === 2)?.reason).toContain('12345')
      expect(errors.find((e) => e.row === 3)?.reason).toContain('#REF!')
      expect(errors.find((e) => e.row === 4)?.column).toBe('role')
    })
  })

  describe('two steps: a preview writes no business row', () => {
    it('[rule-foundation-import-two-steps] users, credentials and group memberships are unchanged by a preview; a temporary preview exists, expiring in about 2 hours', async () => {
      await seedGroup('Équipe A')
      const before = [await count('users'), await count('credentials'), await count('group_users'), await count('groups')]
      const res = await upload(admin.token, usersCsv([['a@example.com', 'user', 'Équipe A'], ['b@example.com', 'admin', '']]), 'sec.csv')
      expect(res.status).toBe(200)
      expect([await count('users'), await count('credentials'), await count('group_users'), await count('groups')]).toEqual(before)
      const rows = await sql<{ status: string; ttl: number }>(
        'select status, extract(epoch from (expires_at - now())) as ttl from base.import_previews where id = $1',
        [res.body.importId],
      )
      expect(rows).toHaveLength(1)
      expect(rows[0].status).toBe('previewed')
      expect(Number(rows[0].ttl)).toBeGreaterThan(115 * 60)
      expect(Number(rows[0].ttl)).toBeLessThanOrEqual(121 * 60)
      expect(Math.abs(Date.parse(res.body.expiresAt) - (Date.now() + 2 * 3600 * 1000))).toBeLessThan(10 * 60 * 1000)
      const list = await call('GET', '/users?size=100', admin.token)
      expect(list.body.total).toBe(3)
    })

    it('[rule-foundation-import-two-steps] [rule-foundation-import-trapped-files-refused] a refused file writes no business row either', async () => {
      const before = await count('users')
      expect((await upload(admin.token, Buffer.from('%PDF-1.4 pas un classeur'), 'x.xlsx')).status).toBe(400)
      expect(await count('users')).toBe(before)
    })

    it('[rule-foundation-import-two-steps] [rule-foundation-import-audited] a preview leaves no entry in the audit journal', async () => {
      await previewOk(admin.token, usersCsv([['a@example.com', 'user', '']]))
      expect(await count('audit_logs')).toBe(0)
    })
  })

  describe('duplicates inside the file', () => {
    it('[rule-foundation-import-in-file-duplicates] the first occurrence stays valid, the following ones are in error with « à la ligne N »', async () => {
      const csv = usersCsv([['dup@example.com', 'user', ''], ['autre@example.com', 'user', ''], ['dup@example.com', 'admin', ''], ['dup@example.com', 'user', '']])
      const res = await upload(admin.token, csv, 'doublons.csv')
      expect(res.body).toMatchObject({ totalRows: 4, validRows: 2, errorRows: 2 })
      const errors = await allErrors(admin.token, res.body.importId)
      expect(errors.map((e) => [e.row, e.column])).toEqual([[4, 'email'], [5, 'email']])
      for (const e of errors) expect(e.reason).toContain('à la ligne 2')
    })

    it('[rule-foundation-import-in-file-duplicates] a valid row after an otherwise invalid first occurrence is the duplicate (first row carrying the key wins)', async () => {
      const csv = usersCsv([['dup@example.com', 'boss', ''], ['dup@example.com', 'user', '']])
      const res = await upload(admin.token, csv, 'doublons2.csv')
      expect(res.body).toMatchObject({ totalRows: 2, validRows: 0, errorRows: 2 })
      const errors = await allErrors(admin.token, res.body.importId)
      expect(errorsOfRow(errors, 2).map((e) => e[0])).toEqual(['role'])
      expect(errorsOfRow(errors, 3).map((e) => e[0])).toEqual(['email'])
    })

    it('[rule-foundation-import-in-file-duplicates] [rule-foundation-import-users-email] the same address in a different case is another address: two valid rows', async () => {
      const res = await upload(admin.token, usersCsv([['A@Example.com', 'user', ''], ['a@example.com', 'user', '']]), 'casse.csv')
      expect(res.body).toMatchObject({ totalRows: 2, validRows: 2, errorRows: 0 })
    })

    it('[rule-foundation-import-in-file-duplicates] duplicates are also detected in a .xlsx', async () => {
      const res = await upload(admin.token, usersXlsx([['dup@example.com', 'user', ''], ['dup@example.com', 'user', '']]), 'd.xlsx')
      expect(res.body).toMatchObject({ totalRows: 2, validRows: 1, errorRows: 1 })
    })
  })

  describe('trapped and invalid files are refused with a clear code and nothing is kept', () => {
    it('[rule-foundation-import-trapped-files-refused] an archive bomb (64 MiB of zeros in a few KB) is 400 import.unsafe_archive', async () => {
      const bomb = Buffer.alloc(64 * 1024 * 1024)
      await expectRefused(xlsxWith({ extraEntries: [entry('xl/worksheets/sheet2.xml', bomb)] }), 'bombe.xlsx', 400, 'import.unsafe_archive')
    })

    it('[rule-foundation-import-trapped-files-refused] an entry whose real size exceeds its declared size is 400 import.unsafe_archive', async () => {
      const liar = entry('xl/worksheets/sheet2.xml', Buffer.alloc(3 * 1024 * 1024, 0x61), { declaredSize: 1000 })
      await expectRefused(xlsxWith({ extraEntries: [liar] }), 'menteur.xlsx', 400, 'import.unsafe_archive')
    })

    it.each([
      ['path traversal ../', () => [entry('../evil.xml')]],
      ['absolute entry name', () => [entry('/xl/evil.xml')]],
      ['backslash in an entry name', () => [entry('xl\\evil.xml')]],
      ['case-insensitive duplicate names', () => [entry('xl/Doublon.xml'), entry('xl/doublon.xml')]],
      ['1,001+ entries', () => Array.from({ length: 1001 }, (_, i) => entry(`xl/extra/f${i}.xml`))],
      ['VBA macros part', () => [entry('xl/vbaProject.bin', Buffer.from('MACRO'))]],
      ['nested archive part', () => [entry('xl/nested.zip', buildZip([entry('a.txt', 'a')]))]],
      ['DOCTYPE in an XML part', () => [entry('xl/sharedStrings.xml', '<?xml version="1.0"?><!DOCTYPE sst [<!ENTITY x "y">]><sst/>')]],
      ['ENTITY declaration (entity bomb)', () => [entry('xl/styles.xml', '<?xml version="1.0"?><!ENTITY lol "lol"><styleSheet/>')]],
    ])('[rule-foundation-import-trapped-files-refused] [rule-foundation-import-archive-limits] suspicious archive: %s → 400 import.unsafe_archive', async (_label, extra) => {
      await expectRefused(xlsxWith({ extraEntries: extra() }), 'piege.xlsx', 400, 'import.unsafe_archive')
    })

    const ext = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
    it.each([
      ['external link part', () => xlsxWith({ extraEntries: [entry('xl/externalLinks/externalLink1.xml')] })],
      ['data connections', () => xlsxWith({ extraEntries: [entry('xl/connections.xml')] })],
      ['query table', () => xlsxWith({ extraEntries: [entry('xl/queryTables/queryTable1.xml')] })],
      ['embedded OLE object', () => xlsxWith({ extraEntries: [entry('xl/embeddings/oleObject1.bin', Buffer.from('OLE'))] })],
      ['external non-hyperlink relationship (sheet)', () => xlsxWith({ sheetRels: `<Relationship Id="rId9" Type="${ext}/oleObject" Target="file:///C:/secret.xlsx" TargetMode="External"/>` })],
      ['external non-hyperlink relationship (workbook)', () => xlsxWith({ workbookRels: `<Relationship Id="rId9" Type="${ext}/externalLink" Target="https://exemple.invalid/a.xlsx" TargetMode="External"/>` })],
      ['formula referencing another workbook by index', () => usersXlsx([[{ value: 'a@example.com', formula: "[1]Sheet1!A1" }, 'user', '']])],
      ['formula referencing another workbook by path', () => usersXlsx([[{ value: 'a@example.com', formula: "'C:\\x\\[a.xlsx]S'!A1" }, 'user', '']])],
      ['formula with a URL', () => usersXlsx([[{ value: 'a@example.com', formula: "'https://exemple.invalid/[a.xlsx]S'!A1" }, 'user', '']])],
      ['DDE formula', () => usersXlsx([[{ value: 'a@example.com', formula: 'DDE("excel","a","b")' }, 'user', '']])],
      ['cmd| formula', () => usersXlsx([[{ value: 'a@example.com', formula: "cmd|' /c calc'!A1" }, 'user', '']])],
    ])('[rule-foundation-import-trapped-files-refused] [rule-foundation-import-external-links-refused] %s → 400 import.external_links', async (_label, make) => {
      await expectRefused(make(), 'externe.xlsx', 400, 'import.external_links')
    })

    it('[rule-foundation-import-external-links-refused] a hyperlink relationship and an ordinary internal formula are ACCEPTED', async () => {
      const link = `<Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://exemple.fr" TargetMode="External"/>`
      const xlsx = usersXlsx([[{ value: 'a@example.com', formula: 'LOWER("A@EXAMPLE.COM")' }, 'user', ''], ['b@example.com', 'admin', '']], { sheetRels: link })
      const res = await upload(admin.token, xlsx, 'liens-ok.xlsx')
      expect(res.status).toBe(200)
      expect(res.body).toMatchObject({ totalRows: 2, validRows: 2, errorRows: 0 })
    })

    it('[rule-foundation-import-external-links-refused] a formula-like cell in a .csv is plain text (accepted, only its column rules apply)', async () => {
      const res = await upload(admin.token, usersCsv([['=cmd|\' /c calc\'!A1', 'user', ''], ['a@example.com', 'user', '']]), 'formule.csv')
      expect(res.status).toBe(200)
      expect(res.body).toMatchObject({ totalRows: 2, validRows: 1, errorRows: 1 })
    })

    it('[rule-foundation-import-content-sniffing] [rule-foundation-import-formats] a pdf, a text renamed .xlsx, a .xlsx renamed .csv, a .txt, no extension: 400 import.invalid_file_type', async () => {
      await expectRefused(Buffer.from('%PDF-1.4\n%âãÏÓ\n1 0 obj'), 'doc.pdf', 400, 'import.invalid_file_type')
      await expectRefused(Buffer.from('email,role\na@example.com,user\n'), 'faux.xlsx', 400, 'import.invalid_file_type')
      await expectRefused(usersXlsx([['a@example.com', 'user', '']]), 'faux.csv', 400, 'import.invalid_file_type')
      await expectRefused(usersCsv([['a@example.com', 'user', '']]), 'notes.txt', 400, 'import.invalid_file_type')
      await expectRefused(usersCsv([['a@example.com', 'user', '']]), 'sansextension', 400, 'import.invalid_file_type')
    })

    it('[rule-foundation-import-content-sniffing] a truncated .xlsx, an encrypted entry, a binary OLE .xls renamed: refused, never 500', async () => {
      const whole = usersXlsx([['a@example.com', 'user', '']])
      await expectRefused(whole.subarray(0, Math.floor(whole.length / 2)), 'tronque.xlsx', 400, 'import.invalid_file_type')
      await expectRefused(
        xlsxWith({ extraEntries: [entry('xl/secret.xml', '<x/>', { encrypted: true })] }),
        'chiffre.xlsx',
        400,
        ['import.invalid_file_type', 'import.unsafe_archive'],
      )
      const ole = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(512)])
      await expectRefused(ole, 'ancien.xlsx', 400, 'import.invalid_file_type')
    })

    it('[rule-foundation-import-content-sniffing] a .csv with a NUL byte or invalid UTF-8 is 400 import.invalid_file_type', async () => {
      await expectRefused(Buffer.from('email,role,groupes\na@example.com,user,\u0000\n', 'utf8'), 'nul.csv', 400, 'import.invalid_file_type')
      await expectRefused(Buffer.concat([Buffer.from('email,role,groupes\n'), Buffer.from([0xff, 0xfe, 0xfd]), Buffer.from('@example.com,user,\n')]), 'latin.csv', 400, 'import.invalid_file_type')
    })

    it('[rule-foundation-import-content-sniffing] zero-byte files are 400 import.invalid_file_type', async () => {
      await expectRefused(Buffer.alloc(0), 'vide.xlsx', 400, 'import.invalid_file_type')
      await expectRefused(Buffer.alloc(0), 'vide.csv', 400, 'import.invalid_file_type')
    })

    it('[rule-foundation-import-trapped-files-refused] a zip that is not a workbook (no [Content_Types].xml / workbook part) is 400 import.invalid_file_type', async () => {
      await expectRefused(buildZip([entry('lisez-moi.txt', 'bonjour')]), 'zip.xlsx', 400, 'import.invalid_file_type')
    })

    it('[rule-foundation-import-trapped-files-refused] [rule-foundation-import-limits] a headers-only file is 400 import.empty_file (csv and xlsx)', async () => {
      await expectRefused(usersCsv([]), 'entetes.csv', 400, 'import.empty_file')
      await expectRefused(usersXlsx([]), 'entetes.xlsx', 400, 'import.empty_file')
      await expectRefused(usersCsv([['', '', ''], ['', '', '']]), 'blancs.csv', 400, 'import.empty_file')
    })

    it('[rule-foundation-import-trapped-files-refused] [rule-foundation-import-limits] 1,000,001 data rows: 400 import.too_many_rows and nothing kept', async () => {
      const lines: string[] = new Array(1_000_001).fill('a@example.com,user,')
      const csv = Buffer.from('email,role,groupes\n' + lines.join('\n') + '\n')
      await expectRefused(csv, 'enorme.csv', 400, 'import.too_many_rows')
    }, 300000)

    it('[rule-foundation-import-trapped-files-refused] [rule-foundation-import-limits] a file of maxFileSizeBytes + 1 bytes is 413 import.file_too_large (400 tolerated) and nothing is kept', async () => {
      const big = Buffer.alloc(104857600 + 1, 0x61)
      await expectRefused(big, 'gros.csv', [413, 400], 'import.file_too_large')
    }, 300000)

    it('[rule-foundation-import-trapped-files-refused] [rule-foundation-import-limits] a declared Content-Length of 5 GiB with no body is answered 413 at once', async () => {
      const res = await hugeDeclaredBody(admin.token, 5 * 1024 * 1024 * 1024)
      expect([413, 400]).toContain(res.status)
      expect(res.body.code).toBe('import.file_too_large')
      expect(res.ms).toBeLessThan(10000)
      expect(await previewCount()).toBe(0)
    })
  })

  describe('multipart shape and file name', () => {
    const csv = () => usersCsv([['a@example.com', 'user', '']])

    it('[rule-foundation-import-formats] no file part, a wrong field name, two files, a non-multipart body: 400 api.validation.incoming_failed', async () => {
      const none = await rawMultipart(admin.token, [{ name: 'note', content: 'bonjour' }])
      expect([none.status, none.body.code]).toEqual([400, 'api.validation.incoming_failed'])
      const wrong = await upload(admin.token, csv(), 'a.csv', { field: 'document' })
      expect([wrong.status, wrong.body.code]).toEqual([400, 'api.validation.incoming_failed'])
      const two = await rawMultipart(admin.token, [
        { name: 'file', filename: 'a.csv', content: csv() },
        { name: 'file', filename: 'b.csv', content: csv() },
      ])
      expect([two.status, two.body.code]).toEqual([400, 'api.validation.incoming_failed'])
      const json = await call('POST', PREVIEW, admin.token, { file: 'a' })
      expect([json.status, json.body.code]).toEqual([400, 'api.validation.incoming_failed'])
      expect(await previewCount()).toBe(0)
    })

    it('[rule-foundation-import-formats] a text field above 1 KiB is 400 api.validation.incoming_failed', async () => {
      const res = await rawMultipart(admin.token, [
        { name: 'note', content: 'x'.repeat(2048) },
        { name: 'file', filename: 'a.csv', content: csv() },
      ])
      expect([res.status, res.body.code]).toEqual([400, 'api.validation.incoming_failed'])
    })

    it('[rule-foundation-import-formats] a directory part in the file name is dropped: ../../etc/passwd.csv → passwd.csv', async () => {
      const res = await upload(admin.token, csv(), '../../etc/passwd.csv')
      expect(res.status).toBe(200)
      expect(res.body.fileName).toBe('passwd.csv')
      const win = await upload(admin.token, csv(), 'C:\\Users\\x\\comptes.csv')
      expect(win.status).toBe(200)
      expect(win.body.fileName).toBe('comptes.csv')
    })

    it('[rule-foundation-import-formats] a NUL byte / control character in the file name is replaced, never an error', async () => {
      const res = await rawMultipart(admin.token, [{ name: 'file', filename: 'co\u0000mp\u0007tes.csv', content: csv() }])
      expect(res.status).toBe(200)
      expect(res.body.fileName).not.toMatch(/[\u0000-\u001f]/)
      expect(res.body.fileName.endsWith('.csv')).toBe(true)
      expect(res.body.fileName.length).toBeGreaterThanOrEqual(1)
    })

    it('[rule-foundation-import-formats] a 300-character file name is cut to 255 characters keeping its extension', async () => {
      const res = await upload(admin.token, csv(), `${'n'.repeat(300)}.csv`)
      expect(res.status).toBe(200)
      expect(res.body.fileName).toHaveLength(255)
      expect(res.body.fileName.endsWith('.csv')).toBe(true)
    })
  })

  describe('a file is not imported twice', () => {
    const file = () => usersCsv([['a@example.com', 'user', ''], ['b@example.com', 'admin', '']])

    it('[rule-foundation-import-no-double] a confirmed file re-previewed byte-identical under another name: 409 import.already_imported', async () => {
      const p = await previewOk(admin.token, file(), 'premier.csv')
      expect((await plain('POST', confirmPath(p.importId), admin.token)).status).toBe(200)
      const again = await upload(admin.token, file(), 'copie-renommee.csv')
      expect(again.status).toBe(409)
      expect(again.body.code).toBe('import.already_imported')
      const other = await upload(admin2.token, file(), 'autre-admin.csv')
      expect([other.status, other.body.code]).toEqual([409, 'import.already_imported'])
    })

    it('[rule-foundation-import-no-double] a preview alone blocks nothing: the same file previewed twice answers 200 twice, with two importIds', async () => {
      const a = await previewOk(admin.token, file())
      const b = await previewOk(admin.token, file())
      expect(a.importId).not.toBe(b.importId)
    })

    it('[rule-foundation-import-no-double] a file with one byte changed is another file', async () => {
      const p = await previewOk(admin.token, file(), 'v1.csv')
      expect((await plain('POST', confirmPath(p.importId), admin.token)).status).toBe(200)
      const changed = Buffer.concat([file(), Buffer.from('\n')])
      expect((await upload(admin.token, changed, 'v1.csv')).status).toBe(200)
    })

    it('[rule-foundation-import-no-double] the same bytes as .xlsx and as .csv are different files', async () => {
      const x = await previewOk(admin.token, usersXlsx([['x@example.com', 'user', '']]), 'x.xlsx')
      expect((await plain('POST', confirmPath(x.importId), admin.token)).status).toBe(200)
      expect((await upload(admin.token, usersCsv([['x@example.com', 'user', '']]), 'x.csv')).status).toBe(200)
    })
  })

  describe('preview expiry and purge', () => {
    it('[rule-foundation-import-preview-expires] [rule-foundation-import-temp-cleanup] an expired preview is purged, with its staging rows, by the next preview', async () => {
      const old = await previewOk(admin.token, usersCsv([['a@example.com', 'user', ''], ['b@example.com', 'boss', '']]), 'vieux.csv')
      expect(await count('import_preview_rows')).toBeGreaterThan(0)
      await sql("update base.import_previews set expires_at = now() - interval '1 minute' where id = $1", [old.importId])
      await previewOk(admin.token, usersCsv([['c@example.com', 'user', '']]), 'neuf.csv')
      expect(await sql('select 1 from base.import_previews where id = $1', [old.importId])).toHaveLength(0)
      expect(await sql('select 1 from base.import_preview_rows where preview_id = $1', [old.importId])).toHaveLength(0)
      expect(await sql('select 1 from base.import_preview_errors where preview_id = $1', [old.importId])).toHaveLength(0)
      expect((await plain('GET', errorsPath(old.importId), admin.token)).status).toBe(404)
    })

    it('[rule-foundation-import-two-steps] [rule-foundation-import-temp-cleanup] staging keeps only valid rows (and key-bearing error rows); refused files leave no preview', async () => {
      const p = await previewOk(admin.token, usersCsv([['a@example.com', 'user', ''], ['b@example.com', 'boss', ''], ['', 'user', '']]), 's.csv')
      expect(p).toMatchObject({ totalRows: 3, validRows: 1, errorRows: 2 })
      const staged = await sql('select row_number, data is not null as has_data from base.import_preview_rows where preview_id = $1 order by row_number', [p.importId])
      expect(staged.filter((r) => r.has_data)).toHaveLength(1)
      expect(staged.length).toBeLessThanOrEqual(2) // the row without e-mail has no key and no data: not staged
    })
  })

  describe('permissions', () => {
    const small = () => usersCsv([['a@example.com', 'user', '']])

    it('[rule-foundation-import-users-admin-only] an ordinary user gets 403 security.access_denied and nothing is analysed or kept', async () => {
      const res = await upload(user.token, small(), 'u.csv')
      expect(res.status).toBe(403)
      expect(res.body.code).toBe('security.access_denied')
      expect(await previewCount()).toBe(0)
    })

    it('[rule-foundation-import-users-admin-only] anonymous and invalid-token calls get 401', async () => {
      expect((await upload(undefined, small(), 'u.csv')).status).toBe(401)
      expect((await upload('not-a-token', small(), 'u.csv')).status).toBe(401)
      expect(await previewCount()).toBe(0)
    })

    it('[rule-foundation-import-users-admin-only] no byte of the body is read for them: a declared 5 GiB body gets 401/403 at once, not 413', async () => {
      const anon = await hugeDeclaredBody(undefined, 5 * 1024 * 1024 * 1024)
      expect(anon.status).toBe(401)
      const ord = await hugeDeclaredBody(user.token, 5 * 1024 * 1024 * 1024)
      expect(ord.status).toBe(403)
      expect(Math.max(anon.ms, ord.ms)).toBeLessThan(10000)
    })

    it('[rule-foundation-import-users-admin-only] the call without body (permission probe) is answered 401 / 403 by the guards', async () => {
      expect((await plain('POST', PREVIEW)).status).toBe(401)
      expect((await plain('POST', PREVIEW, user.token)).status).toBe(403)
    })
  })

  describe('compressed inputs are decided on content', () => {
    it('[rule-foundation-import-content-sniffing] a raw-deflate blob or gzip named .csv is not a CSV: 400 import.invalid_file_type', async () => {
      await expectRefusedBinary(zlib.gzipSync(Buffer.from('email,role\na@example.com,user\n')), 'gz.csv')
    })
    async function expectRefusedBinary(file: Buffer, name: string) {
      const res = await upload(admin.token, file, name)
      expect(res.status).toBe(400)
      expect(res.body.code).toBe('import.invalid_file_type')
      expect(await previewCount()).toBe(0)
    }
  })

})
