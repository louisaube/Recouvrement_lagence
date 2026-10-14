import { Inject, Injectable } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { Database, DB } from '../../platform/database/database.module'
import { ApiError } from '../../platform/http/errors'
import type { AuthenticatedUser } from '../../platform/http/request-context'
import { loadActivePolicy, ruleOf } from '../brain/active-policy'
import { BrainService } from '../brain/brain.service'
import { DecisionJournal, NewDecision } from '../brain/decision-journal.service'
import { priceOffer } from '../brain/offers'
import { CaseStateService } from '../cases/case-state.service'
import { facts } from '../cases/cases.service'
import { ClockService, daysBetween } from '../cases/clock.service'
import { QueueService } from '../decision-queue/queue.service'
import { PolicyEngineService, EngineInput } from '../policies/policy-engine.service'
import { checkResult, computeShares } from './batch-checks'
import { DECISION_TYPES, HISTORY_SIZE } from './batches.constants'
import type { BatchCheckDto, DailyBatchDetailDto, DecisionShareDto } from './batches.schemas'
import { BatchesService } from './batches.service'
import { chooseRecipient, ContactFact, ExclusionReason, InvoiceFact, OrderKind, proposalConditions, reminderConditions } from './order-builder'

type Row = Record<string, unknown>
type DecisionType = (typeof DECISION_TYPES)[number]

const frenchDate = (iso: string): string => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`
const isDecisionType = (action: string): action is DecisionType => (DECISION_TYPES as readonly string[]).includes(action)
const emptyCounts = (): Record<DecisionType, number> => ({ none: 0, reminder: 0, proposal: 0, transfer_proposed: 0 })

interface CaseRow {
  id: string
  debtorId: string
  nature: string
  segment: string
  state: string
  authorizedCents: number
  rejectedTransferRule: string | null
  negotiableCents: number
  maxDaysLate: number
}

interface PendingOrder {
  caseId: string
  kind: OrderKind
  interlocutorId: string
  channel: string
  conditions: unknown[]
}

/**
 * rule-recouvrement-batch-prepared-by-supervisor (user): the supervisor triggers the preparation, nothing prepares a batch by
 * itself. One transaction (the one of the traced route): either the whole batch, its decisions, orders, items of the queue
 * and trace are written, or nothing is.
 */
@Injectable()
export class BatchPreparationService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly clock: ClockService,
    private readonly brain: BrainService,
    private readonly journal: DecisionJournal,
    private readonly queue: QueueService,
    private readonly engine: PolicyEngineService,
    private readonly states: CaseStateService,
    private readonly batches: BatchesService,
  ) {}

  async prepare(actor: AuthenticatedUser): Promise<DailyBatchDetailDto> {
    // Two preparations are serialised: the unique partial index must never be what arbitrates them.
    await this.db.execute(sql`select pg_advisory_xact_lock(hashtext('base.daily_batches.prepare'))`)
    // rule-recouvrement-batch-brain-decides (user): no active policy, no decision.
    const policy = await loadActivePolicy(this.db)
    if (!policy) throw new ApiError(409, 'batches.no_active_policy', 'No policy version is active')

    const today = this.clock.today()
    const label = frenchDate(today)
    const batchId = randomUUID()

    // rule-recouvrement-batch-one-per-day (inferred): a blocked batch of the day is replaced, a ready one is final.
    const [existing] = (
      await this.db.execute(sql`select id, status from base.daily_batches where batch_date = ${today}::date and status <> 'replaced' for update`)
    ).rows as Row[]
    if (existing?.status === 'ready') throw new ApiError(409, 'batches.already_released', 'The batch of the day is already ready')
    if (existing) {
      await this.db.execute(sql`update base.daily_batches set status = 'replaced', replaced_by = ${batchId}::uuid where id = ${String(existing.id)}::uuid`)
      await this.db.execute(sql`update base.send_orders set status = 'cancelled' where batch_id = ${String(existing.id)}::uuid and status <> 'cancelled'`)
    }
    const history = await this.history()
    await this.db.execute(sql`
      insert into base.daily_batches (id, batch_date, status, prepared_by, policy_version_id, case_count, checks, shares, excluded)
      values (${batchId}::uuid, ${today}::date, 'blocked', ${actor.id}::uuid, ${policy.id}::uuid, 0, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb)
    `)

    // rule-recouvrement-batch-prescription-flow (user): the evaluation of every non final case (prescription, threshold,
    // state) comes before the decision of the day.
    const liveIds = ((await this.db.execute(sql`select id from base.cases where state not in ('settled', 'transferred') order by debtor_id collate "C"`)).rows as Row[]).map((r) =>
      String(r.id),
    )
    await this.brain.evaluateMany(liveIds, { actor: `Lot du jour du ${label}`, reference: label })

    const cases = await this.loadCases(today)
    const invoicesOf = await this.loadInvoices(today)
    const contactsOf = await this.loadContacts()

    // rule-recouvrement-batch-brain-decides (user): the decision table of the policy, case by case.
    const inputs: EngineInput[] = cases.map((c) => {
      const rule = ruleOf(policy, c.segment, c.nature)
      return {
        segment: c.segment,
        nature: c.nature,
        state: c.state,
        daysLateMax: c.maxDaysLate,
        negotiableCents: c.negotiableCents,
        overThreshold: rule ? c.negotiableCents > rule.thresholdCents && c.negotiableCents > c.authorizedCents : false,
      }
    })
    const answers = await this.engine.evaluateMany(policy.document.decision, inputs)
    await this.journal.recordMany(
      this.db,
      cases.map(
        (c, k): NewDecision => ({
          caseId: c.id,
          kind: 'daily_action',
          outcome: answers[k].action,
          ruleId: answers[k].rule,
          policyVersionId: policy.id,
          inputs: [
            { name: 'Segment', value: inputs[k].segment },
            { name: 'Nature', value: inputs[k].nature },
            { name: 'État', value: inputs[k].state },
            { name: 'Retard maximal (jours)', value: String(inputs[k].daysLateMax) },
            { name: 'Montant négociable (centimes)', value: String(inputs[k].negotiableCents) },
            { name: 'Dépassement du seuil', value: inputs[k].overThreshold ? 'oui' : 'non' },
          ],
          internalReason: [
            { name: 'Règle', value: answers[k].rule },
            { name: 'Version de politique', value: policy.label },
            { name: 'Lot du jour', value: today },
          ],
          batchId,
          segment: c.segment,
        }),
      ),
    )
    const counts = emptyCounts()
    answers.forEach((a) => (counts[isDecisionType(a.action) ? a.action : 'none'] += 1))

    // rule-recouvrement-company-transfer-proposed (inferred, D-0003), rule-recouvrement-family-transfer-never-executed (user):
    // the brain proposes the transfer, for a family as for a company; only the supervisor decides it.
    const proposedAt = cases.map((_, k) => k).filter((k) => answers[k].action === 'transfer_proposed' && cases[k].rejectedTransferRule !== answers[k].rule)
    const proposed = proposedAt.map((k) => cases[k])
    if (proposed.length > 0) {
      await this.queue.openMany(
        this.db,
        proposedAt.map((k) => {
          const c = cases[k]
          const rule = ruleOf(policy, c.segment, c.nature)
          return {
            type: 'transfer_proposed' as const,
            caseId: c.id,
            objectKey: c.id,
            summary: `Transfert proposé pour le dossier ${c.debtorId} (règle ${answers[k].rule}).`,
            details: [
              { label: 'Règle appliquée', value: answers[k].rule },
              ...(rule ? [{ label: 'Étape suivante proposée', value: rule.nextStep.kind }] : []),
            ],
          }
        }),
      )
      await this.states.recomputeMany(this.db, proposed.map((c) => c.id), { actor: `Lot du jour du ${label}`, reference: label })
    }

    // rule-recouvrement-batch-statement-fresh (user)
    const statement = await this.statement(policy.document.parameters.global.statementMaxAgeDays, today)

    // Orders (rule-recouvrement-batch-order-eligibility, -channel-order, -orders-structured).
    const excluded = new Map<ExclusionReason, number>()
    const exclude = (reason: ExclusionReason) => excluded.set(reason, (excluded.get(reason) ?? 0) + 1)
    const pending: PendingOrder[] = []
    cases.forEach((c, k) => {
      // A frozen case, or one with nothing left to negotiate, receives no order whatever the decision of the day.
      if (c.state === 'frozen' || c.negotiableCents === 0) return exclude('frozen')
      const action = answers[k].action
      if (action !== 'reminder' && action !== 'proposal') return
      if (!statement.fresh) return exclude('statement_stale')
      const rule = ruleOf(policy, c.segment, c.nature)
      if (!rule) return
      const recipient = chooseRecipient(action, invoicesOf.get(c.id) ?? [], contactsOf.get(c.id) ?? [], rule.requiredDocuments)
      if (!recipient.ok) return exclude(recipient.reason)
      pending.push({
        caseId: c.id,
        kind: action,
        interlocutorId: recipient.contact.id,
        channel: recipient.channel,
        // The anchor is the first offer of the ladder, priced by the brain (rank 1, no counterpart).
        conditions:
          action === 'reminder' ? reminderConditions(recipient.invoices) : proposalConditions(priceOffer(rule.ladder[0], c.negotiableCents, today)),
      })
    })

    // rule-recouvrement-batch-no-duplicate-order (user): the database refuses a second active order per case, kind and day.
    let inserted = 0
    for (let i = 0; i < pending.length; i += 500) {
      const chunk = pending.slice(i, i + 500)
      const result = await this.db.execute(sql`
        insert into base.send_orders (batch_id, kind, status, case_id, interlocutor_id, channel, conditions, order_date)
        values ${sql.join(
          chunk.map((o) => sql`(${batchId}::uuid, ${o.kind}, 'planned', ${o.caseId}::uuid, ${o.interlocutorId}::uuid, ${o.channel}, ${JSON.stringify(o.conditions)}::jsonb, ${today}::date)`),
          sql`, `,
        )}
        on conflict (case_id, kind, order_date) where status <> 'cancelled' do nothing
        returning id
      `)
      inserted += result.rows.length
    }
    const duplicates = pending.length - inserted

    // The four checks.
    const witnesses = (await this.engine.runWitnesses(policy.document)).filter((w) => !w.passed)
    const { shares, check: shareCheck } = computeShares({
      counts,
      decided: cases.length,
      caps: policy.document.parameters.global.decisionTypeCapsBp,
      history,
    })
    const checks: BatchCheckDto[] = [
      checkResult('statement_fresh', !statement.fresh, statement.fresh ? [] : [statement.problem]),
      checkResult(
        'witnesses_replayed',
        witnesses.length > 0,
        witnesses.map(
          (w) =>
            `Témoin « ${w.id} » : décision attendue ${w.expected.action} (${w.expected.rule}), obtenue ${w.obtained ? `${w.obtained.action} (${w.obtained.rule})` : 'aucune réponse du moteur'}.`,
        ),
      ),
      shareCheck,
      checkResult('no_duplicate_order', false, duplicates > 0 ? [`${duplicates} ordre${duplicates > 1 ? 's' : ''} en double écarté${duplicates > 1 ? 's' : ''} par la base.`] : []),
    ]
    const blocked = checks.some((c) => c.status === 'failed')

    // rule-recouvrement-batch-release-mode (user, D-0020): all the checks pass, the batch is ready at once.
    if (blocked) {
      await this.db.execute(sql`update base.send_orders set status = 'blocked', block_reason = 'Lot du jour bloqué par un contrôle.' where batch_id = ${batchId}::uuid`)
    }
    // rule-recouvrement-batch-auto-stop (user): a block by the share of a decision opens one alert (one per batch).
    if (shareCheck.status === 'failed') {
      await this.queue.openMany(this.db, [
        {
          type: 'alert',
          caseId: null,
          objectKey: `batch:${batchId}`,
          summary: `Arrêt automatique du lot du jour du ${label} : la part d'un type de décision sort de la norme.`,
          details: shareCheck.problems.slice(0, 20).map((p, n) => ({ label: `Contrôle ${n + 1}`, value: p.slice(0, 300) })),
        },
      ])
    }
    await this.db.execute(sql`
      update base.daily_batches
      set status = ${blocked ? 'blocked' : 'ready'}, case_count = ${cases.length}, checks = ${JSON.stringify(checks)}::jsonb,
        shares = ${JSON.stringify(shares)}::jsonb,
        excluded = ${JSON.stringify([...excluded].map(([reason, count]) => ({ reason, count })))}::jsonb
      where id = ${batchId}::uuid
    `)
    return this.batches.get(batchId)
  }

  /** The shares of the 20 last batches that are not replaced (rule-recouvrement-batch-auto-stop). */
  private async history(): Promise<Record<DecisionType, number>[]> {
    const rows = (
      await this.db.execute(sql`
        select shares from base.daily_batches where status <> 'replaced' order by batch_date desc, created_at desc, id limit ${HISTORY_SIZE}
      `)
    ).rows as Row[]
    return rows.map((r) => {
      const shares = r.shares as DecisionShareDto[]
      const out = emptyCounts()
      for (const type of DECISION_TYPES) out[type] = shares.find((s) => s.type === type)?.shareBp ?? 0
      return out
    })
  }

  /** rule-recouvrement-statement-fresh: same reading as `GET /recovery-imports/status`. */
  private async statement(maxAgeDays: number, today: string): Promise<{ fresh: boolean; problem: string }> {
    const [row] = (await this.db.execute(sql`select statement_date::text as d from base.statements order by statement_date desc, confirmed_at desc limit 1`)).rows as Row[]
    if (!row) return { fresh: false, problem: "Aucun relevé bancaire n'a été confirmé : les ordres d'envoi ne peuvent pas être prévus." }
    const date = String(row.d)
    const age = daysBetween(date, today)
    if (age > maxAgeDays) {
      return { fresh: false, problem: `Le dernier relevé bancaire date du ${frenchDate(date)} (${age} jours) : la politique en accepte ${maxAgeDays} au plus.` }
    }
    return { fresh: true, problem: '' }
  }

  private async loadCases(today: string): Promise<CaseRow[]> {
    const rows = (
      await this.db.execute(sql`
        with ${facts(today)}
        select c.id, c.debtor_id, c.nature, c.segment, c.state, c.authorized_cents, c.rejected_transfer_rule,
          coalesce(a.negotiable_cents, 0)::bigint as negotiable_cents, coalesce(a.max_days_late, 0)::int as max_days_late
        from base.cases c left join agg a on a.case_id = c.id
        where c.state not in ('settled', 'transferred')
        order by c.debtor_id collate "C"
      `)
    ).rows as Row[]
    return rows.map((r) => ({
      id: String(r.id),
      debtorId: String(r.debtor_id),
      nature: String(r.nature),
      segment: String(r.segment),
      state: String(r.state),
      authorizedCents: Number(r.authorized_cents ?? 0),
      rejectedTransferRule: (r.rejected_transfer_rule as string | null) ?? null,
      negotiableCents: Math.max(0, Number(r.negotiable_cents)),
      maxDaysLate: Number(r.max_days_late),
    }))
  }

  /** The negotiable invoices of every case, with the types of documents indexed for them. */
  private async loadInvoices(today: string): Promise<Map<string, InvoiceFact[]>> {
    const rows = (
      await this.db.execute(sql`
        with ${facts(today)}
        select i.id, i.case_id, i.number, i.balance_cents, i.due_date::text as due_date, i.channels,
          coalesce((select array_agg(d.type) from base.invoice_documents d where d.invoice_id = i.id), '{}'::text[]) as documents
        from inv2 i
        where i.negotiable
        order by i.due_date, i.number collate "C", i.id
      `)
    ).rows as Row[]
    const byCase = new Map<string, InvoiceFact[]>()
    for (const r of rows) {
      const list = byCase.get(String(r.case_id)) ?? []
      list.push({
        id: String(r.id),
        number: String(r.number),
        balanceCents: Number(r.balance_cents),
        dueDate: String(r.due_date),
        channels: r.channels as string[],
        documents: r.documents as string[],
      })
      byCase.set(String(r.case_id), list)
    }
    return byCase
  }

  private async loadContacts(): Promise<Map<string, ContactFact[]>> {
    const rows = (await this.db.execute(sql`select id, case_id, role, email, phone, postal_address, suspended_channels from base.contacts`)).rows as Row[]
    const byCase = new Map<string, ContactFact[]>()
    for (const r of rows) {
      const list = byCase.get(String(r.case_id)) ?? []
      list.push({
        id: String(r.id),
        role: String(r.role),
        email: (r.email as string | null) ?? null,
        phone: (r.phone as string | null) ?? null,
        postalAddress: (r.postal_address as string | null) ?? null,
        suspendedChannels: r.suspended_channels as string[],
      })
      byCase.set(String(r.case_id), list)
    }
    return byCase
  }
}
