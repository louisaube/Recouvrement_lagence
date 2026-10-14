import { Injectable } from '@nestjs/common'
import { sql } from 'drizzle-orm'
import type { ImportExecutor } from '../imports/imports.types'
import type { DECISION_KINDS } from './brain.tables'

export interface NameValue {
  name: string
  value: string
}

export interface NewDecision {
  caseId: string
  kind: (typeof DECISION_KINDS)[number]
  /** 1 to 100 characters. */
  outcome: string
  ruleId?: string | null
  policyVersionId: string | null
  /** Complete inputs of the decision (frozen copy): no coordinate of an interlocutor. */
  inputs: NameValue[]
  /** Private reason: rule, version, reference amounts. Never rendered to an agent. */
  internalReason: NameValue[]
  batchId?: string | null
  segment: string
  agentVersion?: string | null
}

const clip = (items: NameValue[]): NameValue[] => items.map((i) => ({ name: i.name.slice(0, 100), value: i.value.slice(0, 500) }))

/**
 * rule-recouvrement-decision-journal: every decision of the brain is journaled, in the transaction of the event, in an
 * append-only table (the triggers of the migration `recouvrement_triggers` refuse UPDATE and DELETE). The replay of the
 * witness cases never comes here (rule-recouvrement-witness-no-order).
 */
@Injectable()
export class DecisionJournal {
  async recordMany(tx: ImportExecutor, decisions: NewDecision[]): Promise<void> {
    for (let i = 0; i < decisions.length; i += 500) {
      const chunk = decisions.slice(i, i + 500)
      await tx.execute(sql`
        insert into base.decisions (case_id, kind, outcome, rule_id, policy_version_id, inputs, internal_reason, batch_id, segment, agent_version)
        values ${sql.join(
          chunk.map(
            (d) =>
              sql`(${d.caseId}::uuid, ${d.kind}, ${d.outcome.slice(0, 100)}, ${d.ruleId ?? null}, ${d.policyVersionId}::uuid,
                ${JSON.stringify(clip(d.inputs))}::jsonb, ${JSON.stringify(clip(d.internalReason))}::jsonb, ${d.batchId ?? null}::uuid,
                ${d.segment}, ${d.agentVersion ?? null})`,
          ),
          sql`, `,
        )}
      `)
    }
  }
}
