import { sql } from 'drizzle-orm'
import type { ImportExecutor } from '../imports/imports.types'
import type { PolicyFile, PolicyRuleFile } from '../policies/policies.schemas'

export interface ActivePolicy {
  id: string
  label: string
  document: PolicyFile
}

/** The active version of the policy, or null (at most one: unique partial index of `policy_versions`). */
export async function loadActivePolicy(db: Pick<ImportExecutor, 'execute'>): Promise<ActivePolicy | null> {
  const [row] = (await db.execute(sql`select id, label, document from base.policy_versions where status = 'active'`)).rows as {
    id: string
    label: string
    document: PolicyFile
  }[]
  return row ? { id: String(row.id), label: String(row.label), document: row.document } : null
}

/** The rule of the policy for a (segment, nature) pair, or undefined (rule-recouvrement-no-rule-segment). */
export function ruleOf(policy: ActivePolicy, segment: string, nature: string): PolicyRuleFile | undefined {
  return policy.document.parameters.rules.find((r) => r.segment === segment && r.nature === nature)
}
