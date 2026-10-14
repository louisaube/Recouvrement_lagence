import { Injectable } from '@nestjs/common'
import { sql } from 'drizzle-orm'
import { QueueService } from '../decision-queue/queue.service'
import type { ImportExecutor } from '../imports/imports.types'
import { uuidArray } from '../recovery-common/sql'
import { formatCents } from './recovery-parsers'

export interface LettrageStats {
  /** Payments dated after the extraction of the latest snapshot. */
  applied: number
  /** Payments (at least partly) assigned to an invoice. */
  assigned: number
  /** Unassigned amounts (a payment, or the excess of a payment). */
  unassigned: number
  /** Items of the queue opened / closed without decision by this pass. */
  queueOpened: number
  queueClosed: number
}

interface OpenInvoice {
  id: string
  remaining: number
}

interface Desired {
  paymentId: string
  invoiceId: string | null
  amount: number
  origin: 'reference' | 'amount' | 'excess' | 'unassigned'
}

interface AppliedPayment {
  id: string
  reference: string
  amount: number
}

const key = (a: { paymentId: string; invoiceId: string | null; origin: string }): string => `${a.paymentId}|${a.invoiceId ?? ''}|${a.origin}`

/** The longest span of words of a reference that is looked up as an invoice number. */
const MAX_SPAN_WORDS = 8
const MAX_NUMBER_LENGTH = 50

/**
 * rule-recouvrement-lettrage-order, rule-recouvrement-lettrage-excess: the invoices whose number is a whole word (or a
 * whole sequence of words) of the reference, ignoring case. A span starts and ends on a word boundary: `FA-001X` does
 * not contain `FA-001`.
 */
export function numbersInReference(reference: string, known: Map<string, OpenInvoice[]>): OpenInvoice[] {
  const words = [...reference.matchAll(/[\p{L}\p{N}]+/gu)]
  const found = new Set<OpenInvoice>()
  for (let i = 0; i < words.length; i++) {
    for (let j = i; j < Math.min(words.length, i + MAX_SPAN_WORDS); j++) {
      const span = reference.slice(words[i].index, words[j].index! + words[j][0].length)
      if (span.length > MAX_NUMBER_LENGTH) break
      for (const invoice of known.get(span.toLowerCase()) ?? []) found.add(invoice)
    }
  }
  return [...found]
}

/**
 * Rebuilds the allocation of the payments to the invoices from the facts at every confirmation of receivables or of
 * payments (rule-recouvrement-unassigned-payment-freeze: the lettrage is replayed, the allocations of the supervisor are
 * kept). The balance of an invoice is its snapshot balance minus its allocations; a payment already counted by the
 * snapshot (dated on or before the extraction) changes nothing.
 */
@Injectable()
export class LettrageService {
  constructor(private readonly queue: QueueService) {}

  async rebuild(tx: ImportExecutor): Promise<LettrageStats> {
    // rule-recouvrement-lettrage-after-extraction: the latest snapshot is the greatest extraction date, then the last confirmed.
    const [snapshot] = (
      await tx.execute(sql`select extraction_date::text as extraction_date from base.receivable_snapshots order by extraction_date desc, confirmed_at desc limit 1`)
    ).rows as { extraction_date: string }[]
    const extraction = snapshot?.extraction_date ?? null
    await tx.execute(sql`
      update base.payments set status = case when ${extraction}::date is not null and payment_date > ${extraction}::date then 'applied' else 'already_in_balances' end
      where status is distinct from case when ${extraction}::date is not null and payment_date > ${extraction}::date then 'applied' else 'already_in_balances' end
    `)
    // an allocation of the supervisor to a payment the snapshot now counts has no object any more
    await tx.execute(sql`
      delete from base.payment_allocations a using base.payments p
      where a.payment_id = p.id and a.origin = 'supervisor' and p.status <> 'applied'
    `)

    const applied = (
      (await tx.execute(sql`
        select id, reference, amount_cents from base.payments where status = 'applied' order by payment_date, reference collate "C", id
      `)).rows as { id: string; reference: string; amount_cents: string | number }[]
    ).map((r): AppliedPayment => ({ id: r.id, reference: r.reference, amount: Number(r.amount_cents) }))

    const desired = applied.length === 0 ? [] : await this.decide(tx, applied)
    await this.persist(tx, desired)

    // the balance of an invoice: snapshot balance minus allocations (never below zero)
    await tx.execute(sql`
      with alloc as (select invoice_id, sum(amount_cents) as s from base.payment_allocations where invoice_id is not null group by invoice_id)
      update base.invoices i set balance_cents = greatest(0, i.imported_balance_cents - coalesce(alloc.s, 0))
      from base.invoices i2 left join alloc on alloc.invoice_id = i2.id
      where i.id = i2.id and i.kind = 'invoice' and i.balance_cents is distinct from greatest(0, i.imported_balance_cents - coalesce(alloc.s, 0))
    `)

    const unassigned = (
      (await tx.execute(sql`
        select a.id, a.amount_cents, p.reference
        from base.payment_allocations a join base.payments p on p.id = a.payment_id
        where a.invoice_id is null and a.origin in ('excess', 'unassigned')
        order by a.id
      `)).rows as { id: string; amount_cents: string | number; reference: string }[]
    )
    const queueOpened = await this.queue.openMany(
      tx,
      unassigned.map((u) => ({
        type: 'unassigned_payment' as const,
        caseId: null,
        objectKey: u.id,
        summary: `Paiement non affecté de ${formatCents(Number(u.amount_cents))} (référence « ${u.reference.slice(0, 100)} »).`,
      })),
    )
    const queueClosed = await this.queue.autoCloseMissing(tx, 'unassigned_payment', unassigned.map((u) => u.id))
    await this.syncFreezes(tx)

    return {
      applied: applied.length,
      assigned: new Set(desired.filter((d) => d.invoiceId !== null).map((d) => d.paymentId)).size,
      unassigned: unassigned.length,
      queueOpened,
      queueClosed,
    }
  }

  /** The allocations the rules give for the payments to apply, in order of date. */
  private async decide(tx: ImportExecutor, payments: AppliedPayment[]): Promise<Desired[]> {
    const supervisor = new Map<string, number>()
    const supervisorOnInvoice = new Map<string, number>()
    for (const r of (
      await tx.execute(sql`select payment_id, invoice_id, amount_cents from base.payment_allocations where origin = 'supervisor'`)
    ).rows as { payment_id: string; invoice_id: string | null; amount_cents: string | number }[]) {
      supervisor.set(r.payment_id, (supervisor.get(r.payment_id) ?? 0) + Number(r.amount_cents))
      if (r.invoice_id) supervisorOnInvoice.set(r.invoice_id, (supervisorOnInvoice.get(r.invoice_id) ?? 0) + Number(r.amount_cents))
    }

    // Open invoices of the portfolio (credit notes receive nothing). Held in memory for the pass.
    const byNumber = new Map<string, OpenInvoice[]>()
    const byRemaining = new Map<number, Set<OpenInvoice>>()
    const indexAt = (invoice: OpenInvoice) => {
      let set = byRemaining.get(invoice.remaining)
      if (!set) byRemaining.set(invoice.remaining, (set = new Set()))
      set.add(invoice)
    }
    for (const r of (
      await tx.execute(sql`
        select id, lower(number) as number, imported_balance_cents from base.invoices where kind = 'invoice' and closed_at is null and imported_balance_cents > 0
      `)
    ).rows as { id: string; number: string; imported_balance_cents: string | number }[]) {
      const invoice: OpenInvoice = { id: r.id, remaining: Math.max(0, Number(r.imported_balance_cents) - (supervisorOnInvoice.get(r.id) ?? 0)) }
      const list = byNumber.get(r.number)
      if (list) list.push(invoice)
      else byNumber.set(r.number, [invoice])
      if (invoice.remaining > 0) indexAt(invoice)
    }
    const take = (invoice: OpenInvoice, amount: number) => {
      byRemaining.get(invoice.remaining)?.delete(invoice)
      invoice.remaining -= amount
      if (invoice.remaining > 0) indexAt(invoice)
    }

    const out: Desired[] = []
    for (const payment of payments) {
      let rest = payment.amount - (supervisor.get(payment.id) ?? 0)
      if (rest <= 0) continue
      // (1) the number of one single open invoice is in the reference
      const named = numbersInReference(payment.reference, byNumber).filter((i) => i.remaining > 0)
      if (named.length === 1) {
        const invoice = named[0]
        const part = Math.min(rest, invoice.remaining)
        out.push({ paymentId: payment.id, invoiceId: invoice.id, amount: part, origin: 'reference' })
        take(invoice, part)
        rest -= part
        // rule-recouvrement-lettrage-excess: the excess becomes an unassigned payment
        if (rest > 0) out.push({ paymentId: payment.id, invoiceId: null, amount: rest, origin: 'excess' })
        continue
      }
      // (2) the amount is the balance of one single open invoice
      const equal = byRemaining.get(rest)
      if (equal && equal.size === 1) {
        const invoice = [...equal][0]
        out.push({ paymentId: payment.id, invoiceId: invoice.id, amount: rest, origin: 'amount' })
        take(invoice, rest)
        continue
      }
      // (3) unassigned
      out.push({ paymentId: payment.id, invoiceId: null, amount: rest, origin: 'unassigned' })
    }
    return out
  }

  /** Brings the automatic allocations to `desired`, keeping the identifier of those that do not change. */
  private async persist(tx: ImportExecutor, desired: Desired[]): Promise<void> {
    const existing = (
      await tx.execute(sql`
        select id, payment_id, invoice_id, origin, amount_cents from base.payment_allocations where origin in ('reference', 'amount', 'excess', 'unassigned')
      `)
    ).rows as { id: string; payment_id: string; invoice_id: string | null; origin: string; amount_cents: string | number }[]
    const wanted = new Map(desired.map((d) => [key(d), d]))
    const present = new Map(existing.map((e) => [key({ paymentId: e.payment_id, invoiceId: e.invoice_id, origin: e.origin }), e]))

    const remove = existing.filter((e) => !wanted.has(key({ paymentId: e.payment_id, invoiceId: e.invoice_id, origin: e.origin }))).map((e) => e.id)
    for (let i = 0; i < remove.length; i += 5000) {
      await tx.execute(sql`delete from base.payment_allocations where id = any(${uuidArray(remove.slice(i, i + 5000))})`)
    }
    for (const [k, d] of wanted) {
      const old = present.get(k)
      if (old && Number(old.amount_cents) !== d.amount) {
        await tx.execute(sql`update base.payment_allocations set amount_cents = ${d.amount} where id = ${old.id}::uuid`)
      }
    }
    const added = desired.filter((d) => !present.has(key(d)))
    for (let i = 0; i < added.length; i += 2000) {
      const chunk = added.slice(i, i + 2000)
      await tx.execute(sql`
        insert into base.payment_allocations (payment_id, invoice_id, amount_cents, origin)
        values ${sql.join(chunk.map((d) => sql`(${d.paymentId}::uuid, ${d.invoiceId}::uuid, ${d.amount}, ${d.origin})`), sql`, `)}
      `)
    }
    await tx.execute(sql`
      update base.payment_allocations e set parent_allocation_id = r.id
      from base.payment_allocations r
      where e.origin = 'excess' and r.origin = 'reference' and r.payment_id = e.payment_id and e.parent_allocation_id is distinct from r.id
    `)
  }

  /**
   * rule-recouvrement-unassigned-payment-freeze: an unassigned amount freezes (freeze `unassigned_payment`, case scope)
   * the cases that have an open invoice, or a total open balance, equal to it; the freeze falls when the amount is assigned
   * or disappears from the snapshot.
   */
  private async syncFreezes(tx: ImportExecutor): Promise<void> {
    const desired = sql`
      select a.id as alloc_id, m.case_id
      from base.payment_allocations a
      join (
        select case_id, balance_cents as v from base.invoices where kind = 'invoice' and balance_cents > 0
        union
        select case_id, sum(balance_cents) from base.invoices where kind = 'invoice' and balance_cents > 0 group by case_id
      ) m on m.v = a.amount_cents
      where a.invoice_id is null and a.origin in ('excess', 'unassigned')
      group by a.id, m.case_id`
    await tx.execute(sql`
      update base.freezes f set released_at = now()
      where f.code = 'unassigned_payment' and f.source_type = 'payment_allocation' and f.released_at is null
        and not exists (select 1 from (${desired}) d where d.alloc_id = f.source_id and d.case_id = f.case_id)
    `)
    await tx.execute(sql`
      insert into base.freezes (case_id, code, scope, source_type, source_id, reference)
      select d.case_id, 'unassigned_payment', 'case', 'payment_allocation', d.alloc_id, left(p.reference, 100)
      from (${desired}) d
      join base.payment_allocations a on a.id = d.alloc_id
      join base.payments p on p.id = a.payment_id
      where not exists (
        select 1 from base.freezes f
        where f.case_id = d.case_id and f.code = 'unassigned_payment' and f.source_type = 'payment_allocation' and f.source_id = d.alloc_id and f.released_at is null
      )
    `)
  }
}
