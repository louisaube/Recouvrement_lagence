import { Inject, Injectable } from '@nestjs/common'
import { sql, SQL } from 'drizzle-orm'
import { Database, DB } from '../../platform/database/database.module'
import type { AuthenticatedUser } from '../../platform/http/request-context'
import { pageOf } from '../../platform/validation/common'
import { previewNotFound } from '../imports/imports.errors'
import type { ImportExecutor } from '../imports/imports.types'
import { isoInstant } from '../recovery-common/sql'
import { FEATURE_OF, ImportType, REPORT_CATEGORY_LABELS } from './recovery-imports.constants'
import type { ReportCategory } from './recovery-imports.tables'
import { REPORT_CATEGORIES } from './recovery-imports.tables'

type Row = Record<string, unknown>

/** `1234,50` (sign first) from a bigint column: the details of the report are French texts written by the API. */
const money = (column: string): SQL =>
  sql.raw(`(case when ${column} < 0 then '-' else '' end || (abs(${column}) / 100)::text || ',' || lpad((abs(${column}) % 100)::text, 2, '0'))`)

const LABELS: Record<ImportType, Record<ReportCategory, string>> = {
  receivables: { new: 'Dossiers nouveaux', settled: 'Dossiers soldés', modified: 'Dossiers modifiés', removed: 'Pièces retirées' },
  payments: { new: 'Paiements nouveaux', settled: 'Paiements soldés', modified: 'Paiements modifiés', removed: 'Paiements disparus' },
  disputes: { new: 'Litiges nouveaux', settled: 'Litiges soldés', modified: 'Litiges modifiés', removed: 'Litiges disparus' },
  contacts: { new: 'Interlocuteurs nouveaux', settled: 'Interlocuteurs soldés', modified: 'Interlocuteurs modifiés', removed: 'Interlocuteurs disparus' },
  documents: { new: 'Pièces nouvelles', settled: 'Pièces soldées', modified: 'Pièces modifiées', removed: 'Pièces disparues' },
}

/**
 * rule-recouvrement-import-report: the report of the differences with the last confirmed import of the same type. It
 * is computed at the preview from the staged rows and the business tables (which it only reads), kept with the
 * preview, and readable after the confirmation.
 */
@Injectable()
export class ImportReportService {
  constructor(@Inject(DB) private readonly db: Database) {}

  // ------------------------------------------------------------------------------------------------ computation

  async compute(exec: ImportExecutor, type: ImportType, previewId: string): Promise<void> {
    const [previous] = (
      await exec.execute(sql`
        select id from base.import_previews where feature = ${FEATURE_OF[type]} and status = 'confirmed' and id <> ${previewId}::uuid
        order by confirmed_at desc limit 1
      `)
    ).rows as Row[]
    const previousId = previous ? String(previous.id) : null
    await exec.execute(sql`
      insert into base.recovery_import_details (import_id, previous_import_id) values (${previewId}::uuid, ${previousId}::uuid)
      on conflict (import_id) do update set previous_import_id = excluded.previous_import_id
    `)
    await exec.execute(sql`delete from base.recovery_import_report_items where import_id = ${previewId}::uuid`)
    await exec.execute(sql`delete from base.recovery_import_report_notes where import_id = ${previewId}::uuid`)

    if (type === 'receivables') await this.receivables(exec, previewId)
    else if (type === 'payments') await this.payments(exec, previewId, previousId)
    else if (type === 'disputes') await this.disputes(exec, previewId)
    else if (type === 'contacts') await this.contacts(exec, previewId, previousId)
    else await this.documents(exec, previewId, previousId)

    await exec.execute(sql`delete from base.recovery_import_report_categories where import_id = ${previewId}::uuid`)
    await exec.execute(sql`
      insert into base.recovery_import_report_categories (import_id, category, row_count, case_count)
      select ${previewId}::uuid, c.category, count(i.key)::int, count(distinct i.debtor_id)::int
      from (values ('new'), ('settled'), ('modified'), ('removed')) c(category)
      left join base.recovery_import_report_items i on i.import_id = ${previewId}::uuid and i.category = c.category
      group by c.category
    `)
  }

  private staged = (previewId: string): SQL => sql`from base.import_preview_rows where preview_id = ${previewId}::uuid and data is not null`

  /** New, settled and modified cases against the last snapshot (the pieces that are not closed). */
  private async receivables(exec: ImportExecutor, previewId: string): Promise<void> {
    const ctes = sql`
      s as (
        select data->>'debtorId' as debtor_id, data->>'creditorSiren' as siren, data->>'number' as number,
          (data->>'balanceCents')::bigint as bal, (data->>'amountCents')::bigint as amt, data->>'dueDate' as due
        ${this.staged(previewId)}
      ),
      prev as (
        select c.debtor_id, i.creditor_siren as siren, i.number, i.imported_balance_cents as bal, i.amount_cents as amt, i.due_date::text as due
        from base.invoices i join base.cases c on c.id = i.case_id where i.closed_at is null
      ),
      sd as (select debtor_id, bool_and(bal = 0) as all_zero from s group by debtor_id),
      pd as (select debtor_id, bool_or(bal > 0) as had_open from prev group by debtor_id),
      new_d as (select debtor_id from sd where debtor_id not in (select debtor_id from pd)),
      settled_d as (
        select debtor_id from pd where had_open and (debtor_id not in (select debtor_id from sd) or debtor_id in (select debtor_id from sd where all_zero))
      ),
      lines as (
        select coalesce(s.debtor_id, p.debtor_id) as debtor_id, coalesce(s.siren, p.siren) as siren, coalesce(s.number, p.number) as number,
          s.bal as new_bal, p.bal as old_bal, (s.number is not null) as in_file, (p.number is not null) as in_prev,
          (s.amt is distinct from p.amt or s.due is distinct from p.due) as changed
        from s full join prev p on p.siren = s.siren and p.number = s.number
      )`
    await exec.execute(sql`
      with ${ctes}
      insert into base.recovery_import_report_items (import_id, category, key, debtor_id, detail)
      select ${previewId}::uuid, 'new', siren || '/' || number, debtor_id, left('Nouvelle pièce, solde ' || ${money('new_bal')} || '.', 300)
      from lines where in_file and debtor_id in (select debtor_id from new_d)
      union all
      select ${previewId}::uuid, 'settled', siren || '/' || number, debtor_id,
        left(case when in_file then 'Dossier soldé : solde ' || ${money('old_bal')} || ' → ' || ${money('new_bal')} || '.' else 'Dossier soldé : pièce absente du cliché (solde ' || ${money('old_bal')} || ').' end, 300)
      from lines where in_prev and debtor_id in (select debtor_id from settled_d)
      union all
      select ${previewId}::uuid, 'modified', siren || '/' || number, debtor_id,
        left(case
          when not in_prev then 'Pièce ajoutée, solde ' || ${money('new_bal')} || '.'
          when not in_file then 'Pièce retirée du cliché (solde ' || ${money('old_bal')} || ').'
          when new_bal is distinct from old_bal then 'Solde ' || ${money('old_bal')} || ' → ' || ${money('new_bal')} || '.'
          else 'Montant ou échéance modifié.' end, 300)
      from lines
      where debtor_id in (select debtor_id from sd where not all_zero) and debtor_id in (select debtor_id from pd)
        and (not in_prev or not in_file or new_bal is distinct from old_bal or changed)
      on conflict do nothing
    `)
  }

  private async payments(exec: ImportExecutor, previewId: string, previousId: string | null): Promise<void> {
    await exec.execute(sql`
      with s as (
        select data->>'reference' as reference, (data->>'amountCents')::bigint as amt, data->>'paymentDate' as paid ${this.staged(previewId)}
      )
      insert into base.recovery_import_report_items (import_id, category, key, debtor_id, detail)
      select ${previewId}::uuid, 'new', s.reference, null, left('Nouveau paiement de ' || ${money('s.amt')} || ' du ' || s.paid || '.', 300)
      from s where not exists (select 1 from base.payments p where p.reference = s.reference)
      union all
      select ${previewId}::uuid, 'modified', s.reference, null, left('Paiement modifié : ' || ${money('p.amount_cents')} || ' du ' || p.payment_date::text || ' → ' || ${money('s.amt')} || ' du ' || s.paid || '.', 300)
      from s join base.payments p on p.reference = s.reference where p.amount_cents <> s.amt or p.payment_date::text <> s.paid
      union all
      select ${previewId}::uuid, 'removed', p.reference, null, left('Paiement du relevé précédent absent de ce relevé.', 300)
      from base.payments p
      where p.import_id = ${previousId}::uuid and not exists (select 1 from s where s.reference = p.reference)
      on conflict do nothing
    `)
    await exec.execute(sql`
      with s as (select data->>'reference' as reference ${this.staged(previewId)})
      insert into base.recovery_import_report_notes (import_id, code, label, count)
      select ${previewId}::uuid, 'known_references', 'Références déjà confirmées, ignorées à la confirmation', count(*)::int
      from s where exists (select 1 from base.payments p where p.reference = s.reference)
    `)
  }

  private async disputes(exec: ImportExecutor, previewId: string): Promise<void> {
    await exec.execute(sql`
      with s as (
        select data->>'creditorSiren' as siren, data->>'numero' as number, data->>'debtorId' as debtor_id, data->>'motif' as reason,
          data->>'responsable' as owner, (data->>'invoiceId')::uuid as invoice_id ${this.staged(previewId)}
      ),
      open_d as (select invoice_id, reason, owner from base.disputes where closed_at is null)
      insert into base.recovery_import_report_items (import_id, category, key, debtor_id, detail)
      select ${previewId}::uuid, 'new', s.siren || '/' || s.number, s.debtor_id, 'Nouveau litige sur la facture.'
      from s where not exists (select 1 from open_d where open_d.invoice_id = s.invoice_id)
      union all
      select ${previewId}::uuid, 'modified', s.siren || '/' || s.number, s.debtor_id, 'Litige déjà ouvert : motif ou responsable différent, la ligne sera ignorée.'
      from s join open_d on open_d.invoice_id = s.invoice_id where open_d.reason <> s.reason or open_d.owner <> s.owner
      on conflict do nothing
    `)
  }

  private async contacts(exec: ImportExecutor, previewId: string, previousId: string | null): Promise<void> {
    const keyOf = (prefix: string): SQL =>
      sql.raw(`left(${prefix}debtor_id || '|' || ${prefix}role || '|' || coalesce(${prefix}email, '') || '|' || coalesce(${prefix}phone, '') || '|' || coalesce(${prefix}address, ''), 200)`)
    await exec.execute(sql`
      with s as (
        select data->>'debiteur_id' as debtor_id, data->>'role' as role, data->>'courriel' as email, data->>'telephone' as phone,
          data->>'adresse_postale' as address, (data->>'caseId')::uuid as case_id ${this.staged(previewId)}
      ),
      cur as (
        select k.debtor_id, c.role, c.email, c.phone, c.postal_address as address, c.case_id, c.last_import_id
        from base.contacts c join base.cases k on k.id = c.case_id
      )
      insert into base.recovery_import_report_items (import_id, category, key, debtor_id, detail)
      select ${previewId}::uuid, 'new', ${keyOf('s.')}, s.debtor_id, 'Nouvel interlocuteur.'
      from s where not exists (
        select 1 from cur where cur.case_id = s.case_id and cur.role = s.role
          and coalesce(cur.email, '') = coalesce(s.email, '') and coalesce(cur.phone, '') = coalesce(s.phone, '') and coalesce(cur.address, '') = coalesce(s.address, ''))
      group by s.debtor_id, s.role, s.email, s.phone, s.address
      union all
      select ${previewId}::uuid, 'removed', ${keyOf('cur.')}, cur.debtor_id, 'Interlocuteur absent de ce fichier.'
      from cur where cur.last_import_id = ${previousId}::uuid and not exists (
        select 1 from s where s.case_id = cur.case_id and s.role = cur.role
          and coalesce(cur.email, '') = coalesce(s.email, '') and coalesce(cur.phone, '') = coalesce(s.phone, '') and coalesce(cur.address, '') = coalesce(s.address, ''))
      on conflict do nothing
    `)
    await exec.execute(sql`
      insert into base.recovery_import_report_notes (import_id, code, label, count)
      select ${previewId}::uuid, 'suspended_channels', 'Interlocuteurs à canal suspendu (coordonnée invalide)', count(*)::int
      ${this.staged(previewId)} and jsonb_array_length(coalesce(data->'suspended', '[]'::jsonb)) > 0
    `)
  }

  private async documents(exec: ImportExecutor, previewId: string, previousId: string | null): Promise<void> {
    await exec.execute(sql`
      with s as (
        select data->>'creditorSiren' as siren, data->>'numero' as number, data->>'type' as type, data->>'reference' as reference,
          data->>'debtorId' as debtor_id, (data->>'invoiceId')::uuid as invoice_id ${this.staged(previewId)}
      ),
      cur as (
        select d.invoice_id, d.type, d.reference, d.last_import_id, i.creditor_siren as siren, i.number, k.debtor_id
        from base.invoice_documents d join base.invoices i on i.id = d.invoice_id join base.cases k on k.id = i.case_id
      )
      insert into base.recovery_import_report_items (import_id, category, key, debtor_id, detail)
      select ${previewId}::uuid, 'new', left(s.siren || '/' || s.number || '/' || s.type, 200), s.debtor_id, 'Nouvelle pièce justificative.'
      from s where not exists (select 1 from cur where cur.invoice_id = s.invoice_id and cur.type = s.type)
      group by s.siren, s.number, s.type, s.debtor_id
      union all
      select ${previewId}::uuid, 'modified', left(s.siren || '/' || s.number || '/' || s.type, 200), s.debtor_id, 'Référence de la pièce modifiée.'
      from s join cur on cur.invoice_id = s.invoice_id and cur.type = s.type
      where cur.reference is distinct from s.reference
      group by s.siren, s.number, s.type, s.debtor_id
      union all
      select ${previewId}::uuid, 'removed', left(cur.siren || '/' || cur.number || '/' || cur.type, 200), cur.debtor_id, 'Pièce absente de ce fichier.'
      from cur where cur.last_import_id = ${previousId}::uuid and not exists (select 1 from s where s.invoice_id = cur.invoice_id and s.type = cur.type)
      on conflict do nothing
    `)
  }

  // ------------------------------------------------------------------------------------------------ reading

  /** The preview or the confirmed import, only for its creator (rule-foundation-import-preview-owner). */
  private async owned(type: ImportType, importId: string, actor: AuthenticatedUser): Promise<{ id: string; fileName: string }> {
    const [row] = (
      await this.db.execute(sql`
        select id, file_name from base.import_previews
        where id = ${importId.toLowerCase()}::uuid and actor_id = ${actor.id}::uuid and feature = ${FEATURE_OF[type]}
          and (status = 'confirmed' or (status = 'previewed' and expires_at > now()))
      `)
    ).rows as Row[]
    if (!row) throw previewNotFound()
    return { id: String(row.id), fileName: String(row.file_name) }
  }

  async report(type: ImportType, importId: string, actor: AuthenticatedUser) {
    const preview = await this.owned(type, importId, actor)
    const [details] = (
      await this.db.execute(sql`
        select d.previous_import_id, p.file_name as previous_file_name, p.confirmed_at as previous_confirmed_at
        from base.recovery_import_details d left join base.import_previews p on p.id = d.previous_import_id
        where d.import_id = ${preview.id}::uuid
      `)
    ).rows as Row[]
    const counts = new Map(
      ((await this.db.execute(sql`select category, row_count, case_count from base.recovery_import_report_categories where import_id = ${preview.id}::uuid`)).rows as Row[]).map(
        (r) => [String(r.category), r],
      ),
    )
    const notes = (
      await this.db.execute(sql`select code, label, count from base.recovery_import_report_notes where import_id = ${preview.id}::uuid order by code collate "C"`)
    ).rows as Row[]
    return {
      type,
      importId: preview.id,
      previous: details?.previous_import_id
        ? {
            importId: String(details.previous_import_id),
            fileName: String(details.previous_file_name),
            confirmedAt: isoInstant(details.previous_confirmed_at),
          }
        : null,
      categories: REPORT_CATEGORIES.map((code) => ({
        code,
        label: LABELS[type][code] ?? REPORT_CATEGORY_LABELS[code],
        rows: Number(counts.get(code)?.row_count ?? 0),
        cases: Number(counts.get(code)?.case_count ?? 0),
      })),
      notes: notes.map((n) => ({ code: String(n.code), label: String(n.label), count: Number(n.count) })),
    }
  }

  async items(type: ImportType, importId: string, actor: AuthenticatedUser, category: ReportCategory, page: { from?: number; size?: number }) {
    const preview = await this.owned(type, importId, actor)
    const { from, size } = pageOf(page)
    const rows = (
      await this.db.execute(sql`
        select key, debtor_id, detail from base.recovery_import_report_items
        where import_id = ${preview.id}::uuid and category = ${category} order by key collate "C" offset ${from} limit ${size}
      `)
    ).rows as Row[]
    const [count] = (
      await this.db.execute(sql`select count(*)::int as total from base.recovery_import_report_items where import_id = ${preview.id}::uuid and category = ${category}`)
    ).rows as Row[]
    return {
      items: rows.map((r) => ({ key: String(r.key), debtorId: (r.debtor_id as string | null) ?? null, detail: String(r.detail) })),
      total: Number(count?.total ?? 0),
    }
  }
}
