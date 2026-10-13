import { Injectable } from '@nestjs/common'
import bcrypt from 'bcryptjs'
import { inArray } from 'drizzle-orm'
import { randomBytes } from 'node:crypto'
import { isValidEmail } from '../../platform/validation/email'
import { groups, groupUsers } from '../groups/groups.tables'
import { lockMemberships } from '../groups/memberships'
import { echo } from '../imports/imports.text'
import type {
  BatchCheckResult,
  CellResult,
  ImportColumn,
  ImportDefinition,
  ImportExecutor,
  ParsedRow,
  StagedRow,
} from '../imports/imports.types'
import { credentials, users } from './users.tables'

const fail = (reason: string): CellResult => ({ ok: false, reason })
const ok = (value: unknown): CellResult => ({ ok: true, value })
const quoted = (value: string): string => `« ${echo(value)} »`

/** `rule-foundation-import-users-email`: kept as typed (no lower-casing), 254 characters at most. */
const emailColumn: ImportColumn = {
  name: 'email',
  required: true,
  description: 'Adresse e-mail du compte (254 caractères maximum).',
  parse(cell) {
    if (cell === null) return fail("L'adresse e-mail est obligatoire.")
    if (cell.length > 254) return fail("L'adresse e-mail dépasse 254 caractères.")
    if (!isValidEmail(cell)) return fail(`${quoted(cell)} n'est pas une adresse e-mail valide.`)
    return ok(cell)
  },
}

/** `rule-foundation-import-users-role`: strictly `user` or `admin` once trimmed, no default. */
const roleColumn: ImportColumn = {
  name: 'role',
  required: true,
  description: 'Rôle du compte : user ou admin.',
  parse(cell) {
    if (cell === null) return fail('Le rôle est obligatoire (user ou admin).')
    if (cell !== 'user' && cell !== 'admin') return fail(`Rôle ${quoted(cell)} inconnu : attendu « user » ou « admin ».`)
    return ok(cell)
  },
}

const MAX_GROUPS_PER_CELL = 100
const MAX_UNKNOWN_QUOTED = 5

/** `rule-foundation-import-users-groups`: names separated by `;`, empty segments ignored, 100 at most, no repetition. */
const groupsColumn: ImportColumn = {
  name: 'groupes',
  required: false,
  description: 'Noms de groupes existants séparés par « ; ». Laisser vide pour aucun groupe.',
  parse(cell) {
    const names = (cell ?? '')
      .split(';')
      .map((name) => name.trim())
      .filter((name) => name !== '')
    if (names.length > MAX_GROUPS_PER_CELL) return fail('Trop de groupes dans la cellule (100 au maximum).')
    const seen = new Set<string>()
    for (const name of names) {
      const key = name.toLowerCase()
      if (seen.has(key)) return fail(`Le groupe ${quoted(name)} est cité plusieurs fois.`)
      seen.add(key)
    }
    return ok(names)
  },
}

/**
 * Declaration of the import of accounts (`rule-foundation-import-declared-columns`): columns, uniqueness key (the
 * exact e-mail), grouped checks against the database and registration of a batch. Everything else is the foundation.
 */
@Injectable()
export class UsersImportDefinition implements ImportDefinition {
  readonly feature = 'users'
  readonly columns = [emailColumn, roleColumn, groupsColumn]

  /** `rule-foundation-import-in-file-duplicates`: the first row carrying an address keeps it. */
  readonly uniqueKey = {
    column: 'email',
    duplicateReason: (firstRow: number) =>
      `Adresse déjà présente à la ligne ${firstRow} du fichier : seule la première occurrence est retenue.`,
  }

  /** One query for the addresses of the batch and one for the groups, whatever the number of rows. */
  async checkBatch(rows: ParsedRow[], db: ImportExecutor): Promise<BatchCheckResult[]> {
    const emails = rows.map((row) => row.values.email).filter((email): email is string => typeof email === 'string')
    const taken = new Set(
      emails.length === 0 ? [] : (await db.select({ email: users.email }).from(users).where(inArray(users.email, emails))).map((r) => r.email),
    )
    const groupNames = (row: ParsedRow) => (row.values.groupes as string[] | undefined) ?? []
    const known = new Map<string, string>()
    if (rows.some((row) => groupNames(row).length > 0)) {
      // group names are compared ignoring case, in the application: the same rule whatever the collation of the database
      for (const group of await db.select({ id: groups.id, name: groups.name }).from(groups)) known.set(group.name.toLowerCase(), group.id)
    }
    return rows.map((row): BatchCheckResult => {
      const faults: BatchCheckResult['faults'] = []
      const email = row.values.email
      if (typeof email === 'string' && taken.has(email)) {
        faults.push({ column: 'email', reason: `Un compte existe déjà avec l'adresse ${quoted(email)}.` })
      }
      const names = groupNames(row)
      const unknown = names.filter((name) => !known.has(name.toLowerCase()))
      if (unknown.length === 1) {
        faults.push({ column: 'groupes', reason: `Groupe inexistant : ${quoted(unknown[0])}.` })
      } else if (unknown.length > 1) {
        const listed = unknown.slice(0, MAX_UNKNOWN_QUOTED).map(quoted).join(', ')
        faults.push({
          column: 'groupes',
          reason: `Groupes inexistants : ${listed}${unknown.length > MAX_UNKNOWN_QUOTED ? '…' : '.'}`,
        })
      }
      return { faults, extra: { groupIds: unknown.length === 0 ? names.map((name) => known.get(name.toLowerCase())!) : [] } }
    })
  }

  /**
   * `rule-foundation-import-confirm-revalidates`: a row whose address is now taken, or whose group has disappeared, is
   * skipped. `rule-foundation-import-users-no-password`: each account gets a `token` credential holding the bcrypt
   * hash (cost 10) of a random secret nobody knows, so it exists but no password opens it. The secret is drawn once
   * per batch of 1,000 accounts: hashing 300,000 secrets one by one would take hours and protects nothing more, the
   * secret being discarded unread.
   */
  async saveBatch(rows: StagedRow[], tx: ImportExecutor): Promise<{ created: number; skipped: number }> {
    if (rows.length === 0) return { created: 0, skipped: 0 }
    const groupIds = [...new Set(rows.flatMap((row) => (row.data.groupIds as string[] | undefined) ?? []))]
    let existingGroups = new Set<string>()
    if (groupIds.length > 0) {
      await lockMemberships(tx)
      // `for key share`: a group cannot disappear before the memberships are written
      const found = await tx.select({ id: groups.id }).from(groups).where(inArray(groups.id, groupIds)).for('key share')
      existingGroups = new Set(found.map((group) => group.id))
    }
    const taken = new Set(
      (
        await tx
          .select({ email: users.email })
          .from(users)
          .where(inArray(users.email, rows.map((row) => row.data.email as string)))
      ).map((user) => user.email),
    )
    const usable = rows.filter(
      (row) =>
        !taken.has(row.data.email as string) && ((row.data.groupIds as string[] | undefined) ?? []).every((id) => existingGroups.has(id)),
    )
    if (usable.length === 0) return { created: 0, skipped: rows.length }

    const inserted = await tx
      .insert(users)
      .values(usable.map((row) => ({ email: row.data.email as string, role: row.data.role as 'user' | 'admin' })))
      .onConflictDoNothing({ target: users.email })
      .returning({ id: users.id, email: users.email })
    if (inserted.length > 0) {
      const secret = await bcrypt.hash(randomBytes(32).toString('hex'), 10)
      await tx.insert(credentials).values(inserted.map((user) => ({ userId: user.id, password: secret, type: 'token' as const })))
      const idByEmail = new Map(inserted.map((user) => [user.email, user.id]))
      const memberships = usable.flatMap((row) => {
        const userId = idByEmail.get(row.data.email as string)
        return userId ? ((row.data.groupIds as string[] | undefined) ?? []).map((groupId) => ({ groupId, userId })) : []
      })
      // up to 100 groups per account: stay under the 65,535 parameters of a statement
      for (let i = 0; i < memberships.length; i += 10_000) {
        await tx.insert(groupUsers).values(memberships.slice(i, i + 10_000)).onConflictDoNothing()
      }
    }
    return { created: inserted.length, skipped: rows.length - inserted.length }
  }
}
