import { Inject, Injectable } from '@nestjs/common'
import { rm, readFile } from 'node:fs/promises'
import { sql } from 'drizzle-orm'
import type { ZodIssue } from 'zod'
import { Database, DB } from '../../platform/database/database.module'
import { ApiError, isUniqueViolation, notFound, ValidationDetail } from '../../platform/http/errors'
import type { ApiRequest, AuthenticatedUser } from '../../platform/http/request-context'
import { pageOf } from '../../platform/validation/common'
import { ImportCode } from '../imports/imports.errors'
import { receiveUpload } from '../imports/receive'
import { isoInstant } from '../recovery-common/sql'
import { runChecks } from './policy-checks'
import { PolicyEngineService } from './policy-engine.service'
import {
  PolicyCheckDto,
  PolicyFile,
  policyFileSchema,
  PolicyPreviewDto,
  PolicyRuleFile,
  PolicyVersionDto,
  PolicyVersionsQuery,
  PolicyWitnessResultDto,
} from './policies.schemas'

/** rule-recouvrement-policy-format: 2 MiB at most. */
export const POLICY_MAX_BYTES = 2_097_152
/** rule-recouvrement-policy-json-not-spreadsheet: a preview lives 2 hours and is private to its creator. */
const PREVIEW_HOURS = 2

type Row = Record<string, unknown>
type Natured = { segment: string; nature: 'family' | 'company' }
interface FileError {
  path: string
  reason: string
}

const iso = isoInstant
const bad = (status: number, code: string, message: string) => new ApiError(status, code, message)

/** `AAAA-MM-JJ` -> `JJ/MM/AAAA` (summaries of the audit trail). */
export const frenchDate = (date: string): string => date.split('-').reverse().join('/')

function pathOf(path: PropertyKey[]): string {
  if (path.length === 0) return '$'
  let out = ''
  for (const part of path) out += typeof part === 'number' ? `[${part}]` : out === '' ? String(part) : `.${String(part)}`
  return out.slice(0, 200)
}

/** One entry per fault; an unknown key is named on its own path. */
function errorsOf(issues: ZodIssue[]): FileError[] {
  const errors: FileError[] = []
  for (const issue of issues) {
    if (issue.code === 'unrecognized_keys') {
      for (const key of issue.keys) errors.push({ path: pathOf([...issue.path, key]), reason: `Unknown key "${key.slice(0, 60)}"` })
    } else {
      errors.push({ path: pathOf(issue.path), reason: (issue.message || 'Invalid value').slice(0, 300) })
    }
  }
  return errors
}

export function ruleDto(rule: PolicyRuleFile) {
  return {
    segment: rule.segment,
    nature: rule.nature,
    horizonDays: rule.horizonDays,
    nextStep: rule.nextStep,
    ladder: rule.ladder.map((rung, i) => ({
      rank: i + 1,
      offerKind: rung.offerKind,
      valueBp: rung.valueBp,
      payByDays: rung.payByDays,
      installments: rung.installments ?? null,
      delayFeeBp: rung.delayFeeBp,
      counterpart: rung.counterpart
        ? {
            type: rung.counterpart.type,
            deadlineDays: rung.counterpart.deadlineDays ?? null,
            firstPaymentBp: rung.counterpart.firstPaymentBp ?? null,
          }
        : null,
    })),
    maxScheduleDays: rule.maxScheduleDays,
    thresholdCents: rule.thresholdCents,
    requiredDocuments: rule.requiredDocuments,
    limitation: rule.limitation,
  }
}

@Injectable()
export class PoliciesService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly engine: PolicyEngineService,
  ) {}

  // ------------------------------------------------------------------------------------------------ analysis

  /** The (segment, nature) pairs of the cases not settled (rule-recouvrement-policy-segments-covered). */
  private async presentPairs(): Promise<Natured[]> {
    const rows = (await this.db.execute(sql`select segment, nature from base.cases where state <> 'settled' group by segment, nature order by segment collate "C", nature`))
      .rows as Row[]
    return rows.map((r) => ({ segment: String(r.segment), nature: r.nature as 'family' | 'company' }))
  }

  /** Checks and witnesses of a valid file against the receivables confirmed at this moment. */
  private async evaluateFile(file: PolicyFile): Promise<{ checks: PolicyCheckDto[]; witnesses: PolicyWitnessResultDto[] }> {
    const witnesses = await this.engine.runWitnesses(file)
    const checks = runChecks(file, await this.presentPairs(), witnesses)
    return { checks, witnesses }
  }

  private analyse(raw: unknown): { file: PolicyFile | null; errors: FileError[] } {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      return { file: null, errors: [{ path: '$', reason: 'The file must be a JSON object' }] }
    }
    const parsed = policyFileSchema.safeParse(raw)
    const errors = parsed.success ? [] : errorsOf(parsed.error.issues)
    const decision = (raw as Record<string, unknown>).decision
    if (decision !== null && typeof decision === 'object' && !Array.isArray(decision)) {
      for (const problem of this.engine.graphProblems(decision as Record<string, unknown>)) errors.push({ path: 'decision', reason: problem.slice(0, 300) })
    }
    if (errors.length > 0 || !parsed.success) return { file: null, errors: errors.slice(0, 100) }
    return { file: parsed.data, errors: [] }
  }

  // ------------------------------------------------------------------------------------------------ preview

  /** rule-recouvrement-policy-json-not-spreadsheet: nothing is written but the preview, kept 2 hours. */
  async preview(req: ApiRequest, actor: AuthenticatedUser): Promise<PolicyPreviewDto> {
    await this.db.execute(sql`delete from base.policy_previews where expires_at < now()`)
    let upload
    try {
      upload = await receiveUpload(req, POLICY_MAX_BYTES)
    } catch (error) {
      if (error instanceof ApiError && error.code === ImportCode.fileTooLarge) throw bad(413, 'policies.file_too_large', 'The policy file is too large')
      throw error
    }
    try {
      const bytes = await readFile(upload.path)
      let raw: unknown
      try {
        raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
      } catch {
        throw bad(400, 'policies.invalid_file_type', 'The file is not a JSON text in UTF-8')
      }
      const known = await this.db.execute(sql`select 1 from base.policy_versions where file_hash = ${upload.hash}`)
      if (known.rows.length > 0) throw bad(409, 'policies.already_imported', 'This policy file has already been imported')

      const { file, errors } = this.analyse(raw)
      const evaluated = file ? await this.evaluateFile(file) : { checks: [], witnesses: [] }
      const [saved] = (
        await this.db.execute(sql`
          insert into base.policy_previews (actor_id, file_name, file_hash, document, valid, errors, expires_at)
          values (${actor.id}::uuid, ${upload.fileName}, ${upload.hash}, ${file ? JSON.stringify(file) : null}::jsonb, ${file !== null},
            ${JSON.stringify(errors)}::jsonb, now() + make_interval(hours => ${PREVIEW_HOURS}))
          returning id
        `)
      ).rows as Row[]
      return {
        previewId: String(saved.id),
        fileName: upload.fileName,
        fileHash: upload.hash,
        valid: file !== null,
        errors,
        label: file?.label ?? null,
        versionDate: file?.versionDate ?? null,
        global: file?.parameters.global ?? null,
        rules: file ? file.parameters.rules.map(ruleDto) : [],
        checks: evaluated.checks,
        witnesses: evaluated.witnesses,
      }
    } finally {
      await rm(upload.path, { force: true }).catch(() => undefined)
    }
  }

  // ------------------------------------------------------------------------------------------------ versions

  private versionOf(r: Row): PolicyVersionDto {
    return {
      id: String(r.id),
      label: String(r.label),
      versionDate: String(r.version_date),
      status: r.status as PolicyVersionDto['status'],
      fileHash: String(r.file_hash),
      importedBy: { id: String(r.imported_by), email: String(r.imported_email ?? '') },
      importedAt: iso(r.imported_at),
      activatedBy: r.activated_by ? { id: String(r.activated_by), email: String(r.activated_email ?? '') } : null,
      activatedAt: r.activated_at ? iso(r.activated_at) : null,
      checksPassed: r.status === 'imported' ? ((r.checks_passed as boolean | null) ?? null) : null,
    }
  }

  private readonly versionColumns = sql`
    v.id, v.label, v.version_date::text as version_date, v.status, v.file_hash, v.imported_by, v.imported_at, v.activated_by, v.activated_at,
    v.checks_passed, ui.email as imported_email, ua.email as activated_email`
  private readonly versionJoins = sql`
    base.policy_versions v left join base.users ui on ui.id = v.imported_by left join base.users ua on ua.id = v.activated_by`

  private async loadVersion(id: string): Promise<{ version: PolicyVersionDto; document: PolicyFile }> {
    const [row] = (await this.db.execute(sql`select ${this.versionColumns}, v.document from ${this.versionJoins} where v.id = ${id}::uuid`)).rows as Row[]
    if (!row) throw notFound()
    return { version: this.versionOf(row), document: row.document as PolicyFile }
  }

  async list(query: PolicyVersionsQuery) {
    const { from, size } = pageOf(query)
    const filter = query.status ? sql`v.status = ${query.status}` : sql`true`
    const rows = (
      await this.db.execute(sql`
        select ${this.versionColumns} from ${this.versionJoins} where ${filter}
        order by v.version_date desc, v.imported_at desc, v.id desc offset ${from} limit ${size}
      `)
    ).rows as Row[]
    const [count] = (await this.db.execute(sql`select count(*)::int as total from base.policy_versions v where ${filter}`)).rows as Row[]
    return { items: rows.map((r) => this.versionOf(r)), total: Number(count?.total ?? 0) }
  }

  /** rule-recouvrement-policy-activation-checks: the checks are recomputed at every reading, nothing is written. */
  async get(id: string) {
    const { version, document } = await this.loadVersion(id)
    const { checks, witnesses } = await this.evaluateFile(document)
    return { ...version, global: document.parameters.global, rules: document.parameters.rules.map(ruleDto), checks, witnesses }
  }

  /** rule-recouvrement-policy-versioned: the version imported by the creator of the preview, which is consumed. */
  async confirm(previewId: string, actor: AuthenticatedUser): Promise<PolicyVersionDto> {
    const [preview] = (
      await this.db.execute(sql`
        select id, file_hash, document, valid from base.policy_previews
        where id = ${previewId}::uuid and actor_id = ${actor.id}::uuid and expires_at > now() for update
      `)
    ).rows as Row[]
    if (!preview) throw bad(404, 'policies.preview_not_found', 'Policy preview not found')
    if (!preview.valid) throw bad(409, 'policies.invalid_file', 'The file does not respect the policy format')
    const known = await this.db.execute(sql`select 1 from base.policy_versions where file_hash = ${String(preview.file_hash)}`)
    if (known.rows.length > 0) throw bad(409, 'policies.already_imported', 'This policy file has already been imported')

    const file = preview.document as PolicyFile
    const { checks } = await this.evaluateFile(file)
    let id: string
    try {
      const [created] = (
        await this.db.transaction(async (tx) =>
          tx.execute(sql`
            insert into base.policy_versions (label, version_date, status, file_hash, document, imported_by, checks_passed)
            values (${file.label}, ${file.versionDate}::date, 'imported', ${String(preview.file_hash)}, ${JSON.stringify(file)}::jsonb,
              ${actor.id}::uuid, ${checks.every((c) => c.passed)})
            returning id
          `),
        )
      ).rows as Row[]
      id = String(created.id)
    } catch (error) {
      if (isUniqueViolation(error)) throw bad(409, 'policies.already_imported', 'This policy file has already been imported')
      throw error
    }
    await this.db.execute(sql`delete from base.policy_previews where id = ${previewId}::uuid`)
    return (await this.loadVersion(id)).version
  }

  /**
   * rule-recouvrement-policy-immutable, rule-recouvrement-policy-activation-checks: the six checks are blocking; the
   * previous active version is superseded in the same transaction.
   */
  async activate(id: string, actor: AuthenticatedUser): Promise<PolicyVersionDto> {
    // Two activations of different versions are serialised: the unique partial index must never be what arbitrates them.
    await this.db.execute(sql`select pg_advisory_xact_lock(hashtext('base.policy_versions.activate'))`)
    const [locked] = (await this.db.execute(sql`select id, status, document from base.policy_versions where id = ${id}::uuid for update`)).rows as Row[]
    if (!locked) throw notFound()
    if (locked.status !== 'imported') throw bad(409, 'policies.not_activatable', 'This version is already active or superseded')

    const { checks } = await this.evaluateFile(locked.document as PolicyFile)
    const failed = checks.filter((c) => !c.passed)
    if (failed.length > 0) {
      // `details` carry the code of the check and the reason (the first problems), as the specification asks.
      const details = failed.map((c) => ({ path: c.code, reason: c.problems.slice(0, 3).join(' ').slice(0, 300) || c.code }))
      throw new ApiError(409, 'policies.activation_blocked', 'The version does not pass the activation checks', details as unknown as ValidationDetail[])
    }
    await this.db.execute(sql`update base.policy_versions set status = 'superseded' where status = 'active'`)
    await this.db.execute(
      sql`update base.policy_versions set status = 'active', activated_by = ${actor.id}::uuid, activated_at = now() where id = ${id}::uuid`,
    )
    return (await this.loadVersion(id)).version
  }
}
