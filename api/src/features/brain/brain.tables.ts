import { sql } from 'drizzle-orm'
import { check, index, jsonb, numeric, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { base } from '../../platform/database/base-schema'
import { cases } from '../cases/cases.tables'
import { policyVersions } from '../policies/policies.tables'

export const DECISION_KINDS = ['daily_action', 'offer', 'commitment_check', 'threshold', 'prescription', 'exposure_ceiling'] as const

/**
 * Journal of the decisions of the brain (module recouvrement; an addition to the data contract, see DISPUTES.md).
 * rule-recouvrement-decision-journal: append-only (triggers of the migration `recouvrement_triggers`).
 * This lot creates the table and its reading (`GET /cases/:id/decisions`); the brain that writes it comes with the lot of the day.
 */
export const decisions = base.table(
  'decisions',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    caseId: uuid('case_id')
      .notNull()
      .references(() => cases.id),
    decidedAt: timestamp('decided_at', { withTimezone: true }).notNull().defaultNow(),
    kind: text('kind').notNull(),
    outcome: text('outcome').notNull(),
    ruleId: text('rule_id'),
    policyVersionId: uuid('policy_version_id').references(() => policyVersions.id),
    probability: numeric('probability', { precision: 5, scale: 4 }).notNull().default('1'),
    /** Complete inputs of the decision, frozen copy: `[{ name, value }]`. */
    inputs: jsonb('inputs').notNull(),
    /** Private reason (rule, version, reference amounts): `[{ name, value }]`. Never rendered to an agent. */
    internalReason: jsonb('internal_reason').notNull(),
    /** Plain uuid: the table of the batches comes with the lot of the day. */
    batchId: uuid('batch_id'),
    segment: text('segment').notNull(),
    agentVersion: text('agent_version'),
  },
  (table) => [
    check('decisions_kind_check', sql`${table.kind} in ('daily_action', 'offer', 'commitment_check', 'threshold', 'prescription', 'exposure_ceiling')`),
    check('decisions_outcome_check', sql`char_length(${table.outcome}) between 1 and 100`),
    check('decisions_probability_check', sql`${table.probability} between 0 and 1`),
    index('decisions_case_idx').on(table.caseId, table.decidedAt),
  ],
)
