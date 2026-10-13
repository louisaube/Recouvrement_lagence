import { sql, resetData, closePool } from './harness'
import { userWithToken, seedGroup, UNKNOWN_UUID } from './scope-helpers'
import { plain, usersCsv, previewOk, allErrors, errorsOfRow, errorsPath, longEmail, type Preview, type Row } from './import-helpers'

// Acceptance suite of version socle-import-excel: GET /users/imports/:importId/errors
// (row-level causes with their French reasons, boundaries of the columns, pagination, ownership, expiry).
describe('GET /users/imports/:importId/errors', () => {
  let admin: Awaited<ReturnType<typeof userWithToken>>
  let admin2: Awaited<ReturnType<typeof userWithToken>>
  let user: Awaited<ReturnType<typeof userWithToken>>

  const preview = (rows: Row[], name = 'comptes.csv') => previewOk(admin.token, usersCsv(rows), name)
  const errorsFor = async (rows: Row[]) => allErrors(admin.token, (await preview(rows)).importId)

  beforeEach(async () => {
    await resetData()
    admin = await userWithToken('admin@example.com', 'admin')
    admin2 = await userWithToken('admin2@example.com', 'admin')
    user = await userWithToken('user@example.com', 'user')
  })
  afterAll(async () => {
    await closePool()
  })

  describe('causes of row errors and their French reasons', () => {
    it('[rule-foundation-import-preview-content] [rule-foundation-import-reason-texts] e-mail absent / invalid, role absent / unknown: exact reason, column and row', async () => {
      const errors = await errorsFor([
        ['', 'user', ''],
        ['pas-un-email', 'user', ''],
        ['ok1@example.com', '', ''],
        ['ok2@example.com', 'boss', ''],
      ])
      expect(errors).toEqual([
        { row: 2, column: 'email', reason: "L'adresse e-mail est obligatoire." },
        { row: 3, column: 'email', reason: "« pas-un-email » n'est pas une adresse e-mail valide." },
        { row: 4, column: 'role', reason: 'Le rôle est obligatoire (user ou admin).' },
        { row: 5, column: 'role', reason: 'Rôle « boss » inconnu : attendu « user » ou « admin ».' },
      ])
    })

    it('[rule-foundation-import-preview-content] [rule-foundation-import-users-email] an e-mail already used by an existing account is an error on the email column', async () => {
      const errors = await errorsFor([['admin@example.com', 'user', ''], ['libre@example.com', 'user', '']])
      expect(errors).toEqual([{ row: 2, column: 'email', reason: "Un compte existe déjà avec l'adresse « admin@example.com »." }])
    })

    it('[rule-foundation-import-in-file-duplicates] [rule-foundation-import-reason-texts] a repeated e-mail names the line of the first occurrence', async () => {
      const errors = await errorsFor([['a@example.com', 'user', ''], ['b@example.com', 'user', ''], ['a@example.com', 'user', '']])
      expect(errors).toEqual([
        { row: 4, column: 'email', reason: 'Adresse déjà présente à la ligne 2 du fichier : seule la première occurrence est retenue.' },
      ])
    })

    it('[rule-foundation-import-users-groups] [rule-foundation-import-reason-texts] an unknown group, several unknown groups, the same group twice', async () => {
      await seedGroup('Équipe A')
      const errors = await errorsFor([
        ['a@example.com', 'user', 'Fantôme'],
        ['b@example.com', 'user', 'Fantôme 1;Fantôme 2'],
        ['c@example.com', 'user', 'Équipe A;équipe a'],
        ['d@example.com', 'user', 'Équipe A;ÉQUIPE A;Équipe A'],
      ])
      expect(errors.map((e) => [e.row, e.column])).toEqual([[2, 'groupes'], [3, 'groupes'], [4, 'groupes'], [5, 'groupes']])
      expect(errors[0].reason).toBe('Groupe inexistant : « Fantôme ».')
      expect(errors[1].reason).toMatch(/^Groupes inexistants : « Fantôme 1 », « Fantôme 2 »/)
      expect(errors[2].reason).toMatch(/^Le groupe « .+ » est cité plusieurs fois\.$/)
      expect(errors[2].reason.toLowerCase()).toContain('équipe a')
    })

    it('[rule-foundation-import-users-groups] several unknown groups give ONE entry listing at most 5 names then …', async () => {
      const names = Array.from({ length: 8 }, (_, i) => `Inconnu${i + 1}`)
      const errors = await errorsFor([['a@example.com', 'user', names.join(';')]])
      expect(errors).toHaveLength(1)
      for (const n of names.slice(0, 5)) expect(errors[0].reason).toContain(`« ${n} »`)
      for (const n of names.slice(5)) expect(errors[0].reason).not.toContain(n)
      expect(errors[0].reason).toContain('…')
    })

    it('[rule-foundation-import-users-groups] more than 100 groups in a cell: « Trop de groupes dans la cellule (100 au maximum). »', async () => {
      const names: string[] = []
      for (let i = 1; i <= 101; i++) {
        names.push(`G${i}`)
        await seedGroup(`G${i}`)
      }
      const errors = await errorsFor([['ok@example.com', 'user', names.slice(0, 100).join(';')], ['ko@example.com', 'user', names.join(';')]])
      expect(errors).toEqual([{ row: 3, column: 'groupes', reason: 'Trop de groupes dans la cellule (100 au maximum).' }])
    })

    it('[rule-foundation-import-reason-texts] a cell above 1,000 characters is « Valeur trop longue »', async () => {
      const errors = await errorsFor([['a@example.com', 'user', 'x'.repeat(1001)]])
      expect(errors).toHaveLength(1)
      expect(errors[0].column).toBe('groupes')
      expect(errors[0].reason).toMatch(/^Valeur trop longue/)
    })

    it('[rule-foundation-import-preview-content] a row with several faulty columns gives several entries, ordered by row then declared column; errorRows counts rows, total counts entries', async () => {
      const p = await preview([
        ['ok@example.com', 'user', ''],
        ['', 'boss', 'Fantôme'],
        ['bad', 'user', ''],
      ])
      expect(p).toMatchObject({ totalRows: 3, validRows: 1, errorRows: 2 })
      const res = await plain('GET', errorsPath(p.importId), admin.token)
      expect(res.status).toBe(200)
      expect(res.body.total).toBe(4)
      expect(res.body.errors.map((e: any) => [e.row, e.column])).toEqual([[3, 'email'], [3, 'role'], [3, 'groupes'], [4, 'email']])
    })

    it('[rule-foundation-import-preview-content] a file without error has an empty list and total 0', async () => {
      const p = await preview([['ok@example.com', 'user', '']])
      const res = await plain('GET', errorsPath(p.importId), admin.token)
      expect(res.status).toBe(200)
      expect(res.body).toEqual({ errors: [], total: 0 })
    })

    it('[rule-foundation-import-reason-texts] the faulty value is cut (100 characters at most) and a reason never exposes path, SQL, stack or another account', async () => {
      const errors = await errorsFor([['x'.repeat(150), 'user', ''], ['admin@example.com', 'z'.repeat(150), ''], ['  ', 'user', '']])
      const echoed = errors.find((e) => e.row === 2)!
      expect(echoed.reason).toContain('x'.repeat(90))
      expect(echoed.reason).not.toContain('x'.repeat(101))
      expect(errors.find((e) => e.row === 3)!.reason).not.toContain('z'.repeat(101))
      for (const e of errors) {
        expect(e.reason.length).toBeLessThanOrEqual(500)
        expect(e.reason).not.toMatch(/\/tmp|\/home|node_modules|select |insert |\bat .*\(.*:\d+|Error:|undefined|null/i)
      }
    })

    it('[rule-foundation-import-reason-texts] an over-long e-mail is reported without echoing the value, and control characters are stripped from echoed values', async () => {
      const errors = await errorsFor([[`${'a'.repeat(300)}@example.com`, 'user', ''], ['bad\u0001value', 'user', '']])
      expect(errors[0].reason).toBe("L'adresse e-mail dépasse 254 caractères.")
      expect(errors[1].reason).not.toMatch(/[\u0000-\u001f]/)
    })
  })

  describe('boundaries of the columns', () => {
    it('[rule-foundation-import-users-email] an e-mail of exactly 254 characters is valid, 255 characters is an error', async () => {
      const ok = longEmail(254)
      const ko = longEmail(255)
      expect(ok).toHaveLength(254)
      expect(ko).toHaveLength(255)
      const p = await preview([[ok, 'user', ''], [ko, 'user', '']])
      expect(p).toMatchObject({ totalRows: 2, validRows: 1, errorRows: 1 })
      const errors = await allErrors(admin.token, p.importId)
      expect(errors).toEqual([{ row: 3, column: 'email', reason: "L'adresse e-mail dépasse 254 caractères." }])
    })

    it('[rule-foundation-import-users-email] the e-mail is kept as typed: an existing A@example.com does not block a@example.com', async () => {
      await userWithToken('Mixte@Example.com', 'user')
      const p = await preview([['mixte@example.com', 'user', ''], ['Mixte@Example.com', 'user', '']])
      expect(p).toMatchObject({ totalRows: 2, validRows: 1, errorRows: 1 })
      expect((await allErrors(admin.token, p.importId))[0]).toMatchObject({ row: 3, column: 'email' })
    })

    it('[rule-foundation-import-users-role] "user" and "admin" valid (trimmed), "Admin" / "ADMIN" / "utilisateur" in error, no default', async () => {
      const p = await preview([
        ['a@example.com', 'user', ''],
        ['b@example.com', ' admin ', ''],
        ['c@example.com', 'Admin', ''],
        ['d@example.com', 'ADMIN', ''],
        ['e@example.com', 'utilisateur', ''],
        ['f@example.com', '', ''],
      ])
      expect(p).toMatchObject({ totalRows: 6, validRows: 2, errorRows: 4 })
      const errors = await allErrors(admin.token, p.importId)
      expect(errors.map((e) => [e.row, e.column])).toEqual([[4, 'role'], [5, 'role'], [6, 'role'], [7, 'role']])
      expect(errors[0].reason).toContain('« Admin »')
    })

    it('[rule-foundation-import-users-groups] group names match like the group-name uniqueness (case-insensitive), empty segments are ignored, an empty cell is no group', async () => {
      await seedGroup('Équipe A')
      await seedGroup('Équipe B')
      const p = await preview([
        ['a@example.com', 'user', 'équipe a'],
        ['b@example.com', 'user', 'Équipe A;;Équipe B; '],
        ['c@example.com', 'user', ';'],
        ['d@example.com', 'user', ''],
        ['e@example.com', 'user', '   '],
      ])
      expect(p).toMatchObject({ totalRows: 5, validRows: 5, errorRows: 0 })
    })

    it('[rule-foundation-import-users-groups] 100 groups in a cell are accepted', async () => {
      const names: string[] = []
      for (let i = 1; i <= 100; i++) {
        names.push(`Groupe${i}`)
        await seedGroup(`Groupe${i}`)
      }
      const p = await preview([['a@example.com', 'user', names.join(';')]])
      expect(p).toMatchObject({ totalRows: 1, validRows: 1, errorRows: 0 })
    })

    it('[rule-foundation-import-users-columns] an optional column (groupes) may be empty on every row', async () => {
      const p = await preview([['a@example.com', 'user', ''], ['b@example.com', 'admin', '']])
      expect(p.validRows).toBe(2)
    })
  })

  describe('pagination', () => {
    let big: Preview

    beforeEach(async () => {
      const rows: Row[] = Array.from({ length: 1000 }, (_, i) => [`u${i}@example.com`, 'mauvais', ''])
      big = await preview(rows, 'mille.csv')
    })

    it('[rule-foundation-import-errors-paginated] 1,000 errors paginated by 100 have no gap, no duplicate, are sorted by row, total = 1000', async () => {
      expect(big).toMatchObject({ totalRows: 1000, validRows: 0, errorRows: 1000 })
      const seen: number[] = []
      for (let from = 0; from < 1000; from += 100) {
        const res = await plain('GET', errorsPath(big.importId, `?from=${from}&size=100`), admin.token)
        expect(res.status).toBe(200)
        expect(res.body.total).toBe(1000)
        expect(res.body.errors).toHaveLength(100)
        seen.push(...res.body.errors.map((e: any) => e.row))
      }
      expect(seen).toEqual(Array.from({ length: 1000 }, (_, i) => i + 2))
      const past = await plain('GET', errorsPath(big.importId, '?from=1000&size=100'), admin.token)
      expect(past.body).toEqual({ errors: [], total: 1000 })
    })

    it('[rule-foundation-import-errors-paginated] defaults are from=0 and size=10; size 1 and 100 are accepted', async () => {
      const def = await plain('GET', errorsPath(big.importId), admin.token)
      expect(def.status).toBe(200)
      expect(def.body.errors.map((e: any) => e.row)).toEqual(Array.from({ length: 10 }, (_, i) => i + 2))
      const one = await plain('GET', errorsPath(big.importId, '?size=1&from=5'), admin.token)
      expect(one.body.errors.map((e: any) => e.row)).toEqual([7])
      const hundred = await plain('GET', errorsPath(big.importId, '?size=100'), admin.token)
      expect(hundred.body.errors).toHaveLength(100)
    })

    it.each([
      ['size=0', '?size=0'],
      ['size=101', '?size=101'],
      ['size=abc', '?size=abc'],
      ['size=1.5', '?size=1.5'],
      ['from=-1', '?from=-1'],
      ['from=2147483648', '?from=2147483648'],
      ['from=abc', '?from=abc'],
      ['repeated size', '?size=1&size=2'],
      ['NUL byte', '?size=1%00'],
    ])('[rule-foundation-import-errors-paginated] out-of-bounds parameter %s: 400 api.validation.incoming_failed', async (_label, query) => {
      const res = await plain('GET', errorsPath(big.importId, query), admin.token)
      expect(res.status).toBe(400)
      expect(res.body.code).toBe('api.validation.incoming_failed')
    })

    it('[rule-foundation-import-errors-paginated] from=2147483647 is accepted (empty page)', async () => {
      const res = await plain('GET', errorsPath(big.importId, '?from=2147483647'), admin.token)
      expect(res.status).toBe(200)
      expect(res.body.errors).toEqual([])
    })

    it('[rule-foundation-import-errors-paginated] a malformed importId is 400', async () => {
      const res = await plain('GET', errorsPath('pas-un-uuid'), admin.token)
      expect(res.status).toBe(400)
    })
  })

  describe('unknown, expired and foreign previews', () => {
    it('[rule-foundation-import-preview-expires] an unknown importId is 404 import.preview_not_found', async () => {
      const res = await plain('GET', errorsPath(UNKNOWN_UUID), admin.token)
      expect(res.status).toBe(404)
      expect(res.body.code).toBe('import.preview_not_found')
    })

    it('[rule-foundation-import-preview-expires] an expired preview is 404 import.preview_not_found', async () => {
      const p = await preview([['bad', 'user', '']])
      await sql("update base.import_previews set expires_at = now() - interval '1 second' where id = $1", [p.importId])
      const res = await plain('GET', errorsPath(p.importId), admin.token)
      expect(res.status).toBe(404)
      expect(res.body.code).toBe('import.preview_not_found')
    })

    it('[rule-foundation-import-preview-expires] a preview whose analysis is not complete (analyzing) is invisible: 404', async () => {
      const p = await preview([['bad', 'user', '']])
      await sql("update base.import_previews set status = 'analyzing' where id = $1", [p.importId])
      const res = await plain('GET', errorsPath(p.importId), admin.token)
      expect(res.status).toBe(404)
      expect(res.body.code).toBe('import.preview_not_found')
    })

    it('[rule-foundation-import-preview-owner] another administrator listing the errors of a preview gets the same 404 import.preview_not_found as for an unknown id', async () => {
      const p = await preview([['bad', 'user', '']])
      const foreign = await plain('GET', errorsPath(p.importId), admin2.token)
      const unknown = await plain('GET', errorsPath(UNKNOWN_UUID), admin2.token)
      expect(foreign.status).toBe(404)
      expect(foreign.body.code).toBe('import.preview_not_found')
      expect(foreign.body).toEqual(unknown.body)
      expect(JSON.stringify(foreign.body)).not.toContain('pas-un')
      const own = await plain('GET', errorsPath(p.importId), admin.token)
      expect(own.status).toBe(200)
      expect(own.body.total).toBe(1)
    })

    it('[rule-foundation-import-preview-owner] the errors of a confirmed preview are gone: 404 (staging deleted at confirmation)', async () => {
      const p = await preview([['ok@example.com', 'user', ''], ['bad', 'user', '']])
      expect((await plain('POST', `/users/imports/${p.importId}/confirm`, admin.token)).status).toBe(200)
      const res = await plain('GET', errorsPath(p.importId), admin.token)
      expect(res.status).toBe(404)
      expect(res.body.code).toBe('import.preview_not_found')
    })
  })

  describe('permissions', () => {
    it('[rule-foundation-import-users-admin-only] an ordinary user gets 403 security.access_denied, anonymous 401, even for an unknown id', async () => {
      const p = await preview([['bad', 'user', '']])
      for (const id of [p.importId, UNKNOWN_UUID]) {
        const forbidden = await plain('GET', errorsPath(id), user.token)
        expect(forbidden.status).toBe(403)
        expect(forbidden.body.code).toBe('security.access_denied')
        expect(forbidden.body.errors).toBeUndefined()
        expect((await plain('GET', errorsPath(id))).status).toBe(401)
      }
    })

    it('[rule-foundation-import-users-admin-only] the role is checked before the parameters: user with size=0 is 403, anonymous with a malformed id is 401', async () => {
      expect((await plain('GET', errorsPath(UNKNOWN_UUID, '?size=0'), user.token)).status).toBe(403)
      expect((await plain('GET', errorsPath('pas-un-uuid'))).status).toBe(401)
    })
  })

  it('[rule-foundation-import-preview-content] errorsOfRow helper agrees with the API on a mixed file', async () => {
    const errors = await errorsFor([['a@example.com', 'boss', 'Fantôme']])
    expect(errorsOfRow(errors, 2).map((e) => e[0])).toEqual(['role', 'groupes'])
  })
})
