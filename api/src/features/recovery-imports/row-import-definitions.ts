import { sql } from 'drizzle-orm'
import { isValidEmail } from '../../platform/validation/email'
import type { BatchCheckResult, ImportDefinition, ImportExecutor, ParsedRow, StagedRow } from '../imports/imports.types'
import { textArray } from '../recovery-common/sql'
import { CONTACTS_COLUMNS, DISPUTES_COLUMNS, DOCUMENTS_COLUMNS } from './recovery-columns'
import { FEATURE_OF } from './recovery-imports.constants'
import { quoted } from './recovery-parsers'

type Row = Record<string, unknown>

interface InvoiceRef {
  id: string
  caseId: string
  creditorSiren: string
  debtorId: string
}

/** The invoices (not credit notes) that carry each of the numbers, one query for the whole batch. */
async function invoicesByNumber(db: ImportExecutor, numbers: string[]): Promise<Map<string, InvoiceRef[]>> {
  const found = new Map<string, InvoiceRef[]>()
  if (numbers.length === 0) return found
  const rows = (
    await db.execute(sql`
      select i.id, i.number, i.case_id, i.creditor_siren, c.debtor_id
      from base.invoices i join base.cases c on c.id = i.case_id
      where i.kind = 'invoice' and i.number = any(${textArray(numbers)})
    `)
  ).rows as Row[]
  for (const r of rows) {
    const ref: InvoiceRef = { id: String(r.id), caseId: String(r.case_id), creditorSiren: String(r.creditor_siren), debtorId: String(r.debtor_id) }
    const list = found.get(String(r.number))
    if (list) list.push(ref)
    else found.set(String(r.number), [ref])
  }
  return found
}

/** Resolves the invoice of a row by its number and, when given, the SIREN of the creditor entity. */
function resolveInvoice(row: ParsedRow, byNumber: Map<string, InvoiceRef[]>): { invoice?: InvoiceRef; fault?: { column: string; reason: string } } {
  const number = row.values.numero
  const siren = row.values.entite_siren
  // a cell that failed its own rule is already reported
  if (typeof number !== 'string' || siren === undefined) return {}
  const candidates = (byNumber.get(number) ?? []).filter((c) => siren === null || c.creditorSiren === siren)
  if (candidates.length === 0) {
    return {
      fault: {
        column: 'numero',
        reason: siren === null ? `Facture inconnue : ${quoted(number)}.` : `Aucune facture ${quoted(number)} pour l'entité ${siren}.`,
      },
    }
  }
  if (candidates.length > 1) {
    return { fault: { column: 'numero', reason: `Le numéro ${quoted(number)} existe chez plusieurs entités créancières : indiquer entite_siren.` } }
  }
  return { invoice: candidates[0] }
}

// -------------------------------------------------------------------------------------------------------- disputes

/**
 * rule-recouvrement-disputes-import-freeze, rule-recouvrement-disputes-import-additive: each valid row opens a dispute of
 * origin `import` and freezes the invoice; an invoice already in an open dispute is skipped; the file never closes one.
 * The author (`opened_by`) and the state of the cases are completed by the service around the confirmation.
 */
export const disputesDefinition: ImportDefinition = {
  feature: FEATURE_OF.disputes,
  columns: DISPUTES_COLUMNS,

  async checkBatch(rows, db): Promise<BatchCheckResult[]> {
    const byNumber = await invoicesByNumber(
      db,
      rows.map((r) => r.values.numero).filter((n): n is string => typeof n === 'string'),
    )
    return rows.map((row): BatchCheckResult => {
      const { invoice, fault } = resolveInvoice(row, byNumber)
      if (fault) return { faults: [fault] }
      return { faults: [], extra: invoice ? { invoiceId: invoice.id, caseId: invoice.caseId, creditorSiren: invoice.creditorSiren, debtorId: invoice.debtorId } : {} }
    })
  },

  async saveBatch(rows: StagedRow[], tx: ImportExecutor): Promise<{ created: number; skipped: number }> {
    // the first row of the batch for an invoice wins
    const seen = new Set<string>()
    const usable = rows.filter((row) => {
      const id = String(row.data.invoiceId)
      if (seen.has(id)) return false
      seen.add(id)
      return true
    })
    if (usable.length === 0) return { created: 0, skipped: rows.length }
    const inserted = (
      await tx.execute(sql`
        insert into base.disputes (invoice_id, case_id, origin, reason, owner, opened_at)
        values ${sql.join(
          usable.map(
            (row) =>
              sql`(${String(row.data.invoiceId)}::uuid, ${String(row.data.caseId)}::uuid, 'import', ${String(row.data.motif)}, ${String(row.data.responsable)},
                (${String(row.data.date_ouverture)}::date)::timestamp at time zone 'Europe/Paris')`,
          ),
          sql`, `,
        )}
        on conflict (invoice_id) where closed_at is null do nothing
        returning id, invoice_id, case_id, reason
      `)
    ).rows as Row[]
    if (inserted.length > 0) {
      await tx.execute(sql`
        insert into base.freezes (case_id, code, scope, invoice_id, source_type, source_id, reference)
        values ${sql.join(
          inserted.map((d) => sql`(${String(d.case_id)}::uuid, 'dispute', 'invoice', ${String(d.invoice_id)}::uuid, 'dispute', ${String(d.id)}::uuid, ${String(d.reason).slice(0, 100)})`),
          sql`, `,
        )}
        on conflict do nothing
      `)
    }
    return { created: inserted.length, skipped: rows.length - inserted.length }
  },
}

// ------------------------------------------------------------------------------------------------------- contacts

const PHONE_FILLER = /[\s.\-()]/g

/**
 * rule-recouvrement-contact-invalid-suspends-channel: an invalid coordinate is not a row error, it suspends the
 * channels it serves. An empty coordinate suspends nothing (the channel is only unavailable).
 */
export function suspendedChannels(email: string | null, phone: string | null, address: string | null): string[] {
  const suspended = new Set<string>()
  if (email !== null && !isValidEmail(email)) suspended.add('email_sms')
  if (phone !== null && !/^\+?[0-9]{8,15}$/.test(phone.replace(PHONE_FILLER, ''))) {
    suspended.add('voice')
    suspended.add('email_sms')
  }
  if (address !== null && !/\d{5}/.test(address)) suspended.add('mail')
  return ['voice', 'email_sms', 'mail'].filter((c) => suspended.has(c))
}

/**
 * rule-recouvrement-contacts-columns: the confirmation replaces the whole set of contacts, keeping the identifier of
 * those whose (case, role, coordinates) do not change. The rows written by the confirmation are marked by an empty
 * `last_import_id`; the service around the confirmation removes the others and marks these with the import.
 */
export const contactsDefinition: ImportDefinition = {
  feature: FEATURE_OF.contacts,
  columns: CONTACTS_COLUMNS,

  async checkBatch(rows, db): Promise<BatchCheckResult[]> {
    const ids = [...new Set(rows.map((r) => r.values.debiteur_id).filter((d): d is string => typeof d === 'string'))]
    const cases = new Map<string, { id: string; nature: string }>()
    if (ids.length > 0) {
      for (const r of (await db.execute(sql`select id, debtor_id, nature from base.cases where debtor_id = any(${textArray(ids)})`)).rows as Row[]) {
        cases.set(String(r.debtor_id), { id: String(r.id), nature: String(r.nature) })
      }
    }
    return rows.map((row): BatchCheckResult => {
      const v = row.values
      const faults: BatchCheckResult['faults'] = []
      let caseId: string | undefined
      if (typeof v.debiteur_id === 'string') {
        const found = cases.get(v.debiteur_id)
        if (!found) faults.push({ column: 'debiteur_id', reason: `Débiteur inconnu : ${quoted(v.debiteur_id)}.` })
        else {
          caseId = found.id
          if (typeof v.role === 'string') {
            const family = found.nature === 'family'
            if (family && v.role !== 'payer') faults.push({ column: 'role', reason: 'Un débiteur famille n\'a qu\'un interlocuteur de rôle « payeur ».' })
            if (!family && v.role === 'payer') faults.push({ column: 'role', reason: 'Le rôle « payeur » est réservé aux familles : une entreprise a comptabilite_fournisseurs, acheteur ou valideur.' })
          }
        }
      }
      const email = (v.courriel as string | null | undefined) ?? null
      const phone = (v.telephone as string | null | undefined) ?? null
      const address = (v.adresse_postale as string | null | undefined) ?? null
      const parsedAll = v.courriel !== undefined && v.telephone !== undefined && v.adresse_postale !== undefined
      if (parsedAll && email === null && phone === null && address === null) {
        faults.push({ column: 'courriel', reason: 'Au moins une coordonnée (courriel, téléphone ou adresse postale) est obligatoire.' })
      }
      return { faults, extra: { caseId, suspended: suspendedChannels(email, phone, address) } }
    })
  },

  async saveBatch(rows: StagedRow[], tx: ImportExecutor): Promise<{ created: number; skipped: number }> {
    // identical rows of a batch are one contact; across batches the marker below does the same
    const seen = new Set<string>()
    const usable = rows.filter((row) => {
      const k = [row.data.caseId, row.data.role, row.data.courriel ?? '', row.data.telephone ?? '', row.data.adresse_postale ?? ''].join('\u0000')
      if (seen.has(k)) return false
      seen.add(k)
      return true
    })
    const written = (
      await tx.execute(sql`
        insert into base.contacts (case_id, role, email, phone, postal_address, suspended_channels, last_import_id)
        values ${sql.join(
          usable.map(
            (row) =>
              sql`(${String(row.data.caseId)}::uuid, ${String(row.data.role)}, ${(row.data.courriel as string | null) ?? null}, ${(row.data.telephone as string | null) ?? null},
                ${(row.data.adresse_postale as string | null) ?? null}, ${textArray((row.data.suspended as string[]) ?? [])}, null)`,
          ),
          sql`, `,
        )}
        on conflict (case_id, role, (coalesce(email, '')), (coalesce(phone, '')), (coalesce(postal_address, '')))
        do update set suspended_channels = excluded.suspended_channels, last_import_id = null
        where contacts.last_import_id is not null
        returning id
      `)
    ).rows.length
    return { created: written, skipped: rows.length - written }
  },
}

// ------------------------------------------------------------------------------------------------------ documents

/**
 * rule-recouvrement-documents-columns: which supporting documents exist for an invoice. The confirmation replaces the
 * whole index (same marker as the contacts); a repeated (invoice, type) is ignored.
 */
export const documentsDefinition: ImportDefinition = {
  feature: FEATURE_OF.documents,
  columns: DOCUMENTS_COLUMNS,

  async checkBatch(rows, db): Promise<BatchCheckResult[]> {
    const byNumber = await invoicesByNumber(
      db,
      rows.map((r) => r.values.numero).filter((n): n is string => typeof n === 'string'),
    )
    return rows.map((row): BatchCheckResult => {
      const { invoice, fault } = resolveInvoice(row, byNumber)
      if (fault) return { faults: [fault] }
      return { faults: [], extra: invoice ? { invoiceId: invoice.id, creditorSiren: invoice.creditorSiren, debtorId: invoice.debtorId } : {} }
    })
  },

  async saveBatch(rows: StagedRow[], tx: ImportExecutor): Promise<{ created: number; skipped: number }> {
    const seen = new Set<string>()
    const usable = rows.filter((row) => {
      const k = `${row.data.invoiceId}|${row.data.type}`
      if (seen.has(k)) return false
      seen.add(k)
      return true
    })
    const written = (
      await tx.execute(sql`
        insert into base.invoice_documents (invoice_id, type, reference, last_import_id)
        values ${sql.join(
          usable.map((row) => sql`(${String(row.data.invoiceId)}::uuid, ${String(row.data.type)}, ${(row.data.reference as string | null) ?? null}, null)`),
          sql`, `,
        )}
        on conflict (invoice_id, type) do update set reference = excluded.reference, last_import_id = null
        where invoice_documents.last_import_id is not null
        returning invoice_id
      `)
    ).rows.length
    return { created: written, skipped: rows.length - written }
  },
}
