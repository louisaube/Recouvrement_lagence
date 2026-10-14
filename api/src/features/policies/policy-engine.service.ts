import { Injectable } from '@nestjs/common'
import { ZenEngine } from '@gorules/zen-engine'
import { PolicyFile, PolicyWitnessFile } from './policies.schemas'
import type { PolicyWitnessResultDto } from './policies.schemas'

export interface ActionRule {
  action: string
  rule: string
}

export interface EngineInput {
  segment: string
  nature: string
  state: string
  daysLateMax: number
  negotiableCents: number
  overThreshold: boolean
}

/** Node types a policy may use: the decision table and its plumbing. Code nodes and sub-decisions are refused. */
const ALLOWED_NODES = new Set(['inputNode', 'outputNode', 'decisionTableNode', 'expressionNode', 'switchNode'])

/**
 * rule-recouvrement-policy-format: the decision of the policy is a JDM graph evaluated by `@gorules/zen-engine`.
 * rule-recouvrement-policy-no-business-value-in-code: nothing here knows an action, a rule or a threshold; the engine
 * answers and the answer is passed on. An input that matches no row gives `{ action: 'none', rule: 'no_rule' }`.
 */
@Injectable()
export class PolicyEngineService {
  private readonly engine = new ZenEngine()

  /** Problems that make the engine refuse to load the graph (empty when it is loadable). */
  graphProblems(graph: Record<string, unknown>): string[] {
    const { nodes, edges } = graph
    if (!Array.isArray(nodes) || nodes.length === 0) return ['The decision graph needs a non-empty array "nodes"']
    if (!Array.isArray(edges)) return ['The decision graph needs an array "edges"']
    const ids = new Set<string>()
    const kinds = new Set<string>()
    for (const [index, node] of nodes.entries()) {
      const n = node as { id?: unknown; type?: unknown } | null
      if (!n || typeof n !== 'object' || typeof n.id !== 'string' || typeof n.type !== 'string') {
        return [`Node ${index} of the decision graph needs an "id" and a "type"`]
      }
      if (!ALLOWED_NODES.has(n.type)) return [`Node type "${n.type.slice(0, 40)}" is not allowed in a policy`]
      ids.add(n.id)
      kinds.add(n.type)
    }
    if (!kinds.has('inputNode') || !kinds.has('outputNode')) return ['The decision graph needs an input node and an output node']
    for (const [index, edge] of edges.entries()) {
      const e = edge as { sourceId?: unknown; targetId?: unknown } | null
      if (!e || typeof e !== 'object' || !ids.has(e.sourceId as string) || !ids.has(e.targetId as string)) {
        return [`Edge ${index} of the decision graph links a node that does not exist`]
      }
    }
    try {
      this.engine.createDecision(graph as never)
    } catch (error) {
      return [`The engine refuses the decision graph: ${(error as Error).message.slice(0, 200)}`]
    }
    return []
  }

  async evaluate(graph: Record<string, unknown>, input: EngineInput): Promise<ActionRule> {
    const decision = this.engine.createDecision(graph as never)
    const { result } = (await decision.evaluate(input as never)) as { result?: Partial<ActionRule> }
    if (!result || typeof result.action !== 'string' || typeof result.rule !== 'string') return { action: 'none', rule: 'no_rule' }
    return { action: result.action, rule: result.rule }
  }

  /** The same answer as `evaluate` for many inputs, the graph being loaded once (the daily batch decides every case). */
  async evaluateMany(graph: Record<string, unknown>, inputs: EngineInput[]): Promise<ActionRule[]> {
    const decision = this.engine.createDecision(graph as never)
    const answers: ActionRule[] = []
    for (const input of inputs) {
      const { result } = (await decision.evaluate(input as never)) as { result?: Partial<ActionRule> }
      answers.push(
        result && typeof result.action === 'string' && typeof result.rule === 'string'
          ? { action: result.action, rule: result.rule }
          : { action: 'none', rule: 'no_rule' },
      )
    }
    return answers
  }

  /** Runs every witness case of the file: the result is the one of the engine, never a guess. */
  async runWitnesses(file: Pick<PolicyFile, 'decision' | 'witnesses' | 'parameters'>): Promise<PolicyWitnessResultDto[]> {
    const results: PolicyWitnessResultDto[] = []
    for (const witness of file.witnesses) results.push(await this.runWitness(file, witness))
    return results
  }

  private async runWitness(file: Pick<PolicyFile, 'decision' | 'parameters'>, witness: PolicyWitnessFile): Promise<PolicyWitnessResultDto> {
    const rule = file.parameters.rules.find((r) => r.segment === witness.input.segment && r.nature === witness.input.nature)
    const input: EngineInput = { ...witness.input, overThreshold: rule ? witness.input.negotiableCents > rule.thresholdCents : false }
    let obtained: ActionRule | null = null
    try {
      obtained = await this.evaluate(file.decision, input)
    } catch {
      obtained = null
    }
    return {
      id: witness.id,
      description: witness.description,
      expected: witness.expected,
      obtained,
      passed: obtained !== null && obtained.action === witness.expected.action && obtained.rule === witness.expected.rule,
    }
  }
}
