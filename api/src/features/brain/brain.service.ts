import { Inject, Injectable } from '@nestjs/common'
import { sql } from 'drizzle-orm'
import { Database, DB } from '../../platform/database/database.module'
import { CaseStateService } from '../cases/case-state.service'
import { facts } from '../cases/cases.service'
import { ClockService } from '../cases/clock.service'
import { QueueService, NewQueueItem } from '../decision-queue/queue.service'
import type { QueueType } from '../decision-queue/decision-queue.tables'
import { textArray, uuidArray } from '../recovery-common/sql'
import { loadActivePolicy, ruleOf } from './active-policy'
import { DecisionJournal, NewDecision } from './decision-journal.service'

type Row = Record<string, unknown>

export interface EvaluationContext {
  /** Who moves the cases in the history of the states (1 to 200 characters). */
  actor: string
  reference?: string | null
}

const frenchDate = (iso: string): string => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`

/**
 * rule-recouvrement-evaluation-points: the evaluation of a case (there is no scheduler). This lot calls it at the
 * preparation of a batch; the other points (imports, tools of the agents, disputes, decisions) call the same method.
 * The steps, in this order: (1) prescription, (4) amount threshold, (6) state of the case. The steps that read the
 * engagements (2) and the exposure ceilings (5) come with the lot of the agent tools, which creates their tables.
 */
@Injectable()
export class BrainService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly clock: ClockService,
    private readonly queue: QueueService,
    private readonly journal: DecisionJournal,
    private readonly states: CaseStateService,
  ) {}

  async evaluateMany(caseIds: string[], ctx: EvaluationContext): Promise<void> {
    if (caseIds.length === 0) return
    const policy = await loadActivePolicy(this.db)
    if (policy) {
      const today = this.clock.today()
      await this.prescription(caseIds, today, policy)
      await this.threshold(caseIds, today, policy)
    }
    await this.states.recomputeMany(this.db, caseIds, { actor: ctx.actor, reference: ctx.reference })
  }

  /**
   * rule-recouvrement-prescription (user), step 1: from `date - alertDays` the invoice raises `prescription_near` (with
   * the next step proposed), from the date `prescription_expired`; one item per invoice, once: an item already decided
   * is not opened again. The invoice leaves the negotiable amount by itself (computed at the reading).
   */
  private async prescription(caseIds: string[], today: string, policy: NonNullable<Awaited<ReturnType<typeof loadActivePolicy>>>): Promise<void> {
    const due = (
      await this.db.execute(sql`
        with ${facts(today)}
        select i.id, i.number, i.case_id, i.prescription, i.presc_date::text as presc_date, i.due_date::text as due_date, i.balance_cents,
          c.segment, c.nature, c.debtor_id
        from inv2 i join base.cases c on c.id = i.case_id
        where i.case_id = any(${uuidArray(caseIds)}) and i.is_open and i.prescription in ('near', 'expired')
        order by c.debtor_id collate "C", i.number collate "C", i.id
      `)
    ).rows as Row[]
    if (due.length === 0) return

    const known = new Set(
      (
        await this.db.execute(sql`
          select type, object_key from base.queue_items
          where type in ('prescription_near', 'prescription_expired') and object_key = any(${textArray(due.map((r) => String(r.id)))})
        `)
      ).rows.map((r) => `${(r as Row).type}|${(r as Row).object_key}`),
    )
    const items: NewQueueItem[] = []
    const decisions: NewDecision[] = []
    for (const r of due) {
      const type: QueueType = r.prescription === 'expired' ? 'prescription_expired' : 'prescription_near'
      if (known.has(`${type}|${r.id}`)) continue
      const rule = ruleOf(policy, String(r.segment), String(r.nature))
      const details = [
        { label: 'Facture', value: String(r.number) },
        { label: 'Date de prescription', value: frenchDate(String(r.presc_date)) },
      ]
      if (type === 'prescription_near' && rule) details.push({ label: 'Étape suivante proposée', value: rule.nextStep.kind })
      items.push({
        type,
        caseId: String(r.case_id),
        objectKey: String(r.id),
        summary: `${type === 'prescription_expired' ? 'Prescription échue' : 'Prescription proche'} : facture ${r.number} du dossier ${r.debtor_id}.`,
        details,
      })
      decisions.push({
        caseId: String(r.case_id),
        kind: 'prescription',
        outcome: type,
        policyVersionId: policy.id,
        inputs: [
          { name: 'Facture', value: String(r.number) },
          { name: 'Échéance', value: String(r.due_date) },
          { name: 'Solde (centimes)', value: String(r.balance_cents) },
          { name: 'Date du jour', value: today },
        ],
        internalReason: [
          { name: 'Version de politique', value: policy.label },
          { name: 'Délai de prescription (jours)', value: String(rule?.limitation.delayDays ?? '') },
          { name: 'Délai d’alerte (jours)', value: String(rule?.limitation.alertDays ?? '') },
          { name: 'Date de prescription', value: String(r.presc_date) },
        ],
        segment: String(r.segment),
      })
    }
    await this.queue.openMany(this.db, items)
    await this.journal.recordMany(this.db, decisions)
  }

  /**
   * rule-recouvrement-amount-threshold (user), step 4: a negotiable amount above the threshold of the rule stops the
   * negotiation and opens one `amount_over_threshold` item for the case. The amount authorized by the supervisor is
   * remembered: the case is not stopped again until its negotiable amount exceeds it (rule-recouvrement-queue-effects).
   */
  private async threshold(caseIds: string[], today: string, policy: NonNullable<Awaited<ReturnType<typeof loadActivePolicy>>>): Promise<void> {
    const rows = (
      await this.db.execute(sql`
        with ${facts(today)}
        select c.id, c.debtor_id, c.segment, c.nature, c.authorized_cents, coalesce(a.negotiable_cents, 0)::bigint as negotiable_cents
        from base.cases c join agg a on a.case_id = c.id
        where c.id = any(${uuidArray(caseIds)}) and c.state not in ('settled', 'transferred')
        order by c.debtor_id collate "C"
      `)
    ).rows as Row[]
    const over = rows.filter((r) => {
      const rule = ruleOf(policy, String(r.segment), String(r.nature))
      const negotiable = Number(r.negotiable_cents)
      return rule !== undefined && negotiable > rule.thresholdCents && negotiable > Number(r.authorized_cents ?? 0)
    })
    if (over.length === 0) return
    const open = new Set(
      (
        await this.db.execute(sql`
          select object_key from base.queue_items
          where type = 'amount_over_threshold' and status = 'open' and object_key = any(${textArray(over.map((r) => String(r.id)))})
        `)
      ).rows.map((r) => String((r as Row).object_key)),
    )
    const fresh = over.filter((r) => !open.has(String(r.id)))
    await this.queue.openMany(
      this.db,
      fresh.map((r) => ({
        type: 'amount_over_threshold' as const,
        caseId: String(r.id),
        objectKey: String(r.id),
        summary: `Montant négociable du dossier ${r.debtor_id} au-delà du seuil de la politique.`,
        details: [{ label: 'Montant négociable (centimes)', value: String(r.negotiable_cents) }],
      })),
    )
    await this.journal.recordMany(
      this.db,
      fresh.map((r): NewDecision => {
        const rule = ruleOf(policy, String(r.segment), String(r.nature))!
        return {
          caseId: String(r.id),
          kind: 'threshold',
          outcome: 'negotiation_stopped',
          policyVersionId: policy.id,
          inputs: [
            { name: 'Montant négociable (centimes)', value: String(r.negotiable_cents) },
            { name: 'Montant autorisé (centimes)', value: String(r.authorized_cents ?? 0) },
          ],
          internalReason: [
            { name: 'Version de politique', value: policy.label },
            { name: 'Seuil (centimes)', value: String(rule.thresholdCents) },
          ],
          segment: String(r.segment),
        }
      }),
    )
  }
}
