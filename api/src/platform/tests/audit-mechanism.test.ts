import 'reflect-metadata'
import { Controller, Module, Post } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { z } from 'zod'
import { AccessBootCheck } from '../access/access-boot-check'
import { Access, Public } from '../access/access.decorators'
import { RouteCatalog } from '../access/route-catalog.service'
import { findAuditProblems } from '../audit/audit-check'
import { normaliseSummary } from '../audit/audit-text'
import { AuditExempt, Audited } from '../audit/audit.decorators'
import { Database, InjectDb } from '../database/database.module'
import { configureApp } from '../http/configure-app'
import { ApiError } from '../http/errors'
import { ApiRoute, ApiTag } from '../openapi/route-contract'
import { PlatformModule } from '../platform.module'
import { PASSWORD, closePool, createUser, resetData, sql } from '../testing/helpers'
import { ValidBody } from '../validation/zod-validation.interceptor'
import { sql as dsql } from 'drizzle-orm'

/**
 * The declarative trace (`@Audited`), proved with a fictitious feature present only in this test (Q-PLAT-12): its
 * table `base.audit_probe` is created here and dropped at the end, its routes are hidden from the contract.
 */
const probeBody = z.object({ value: z.string().min(1).max(50) })
const probeResponse = z.object({ id: z.string(), value: z.string() })
const hidden = { hidden: true, body: probeBody, responses: { 200: { description: 'ok', schema: probeResponse } } }

let reached = 0

@Controller('probes')
@ApiTag('Probes')
class ProbesController {
  constructor(@InjectDb() private readonly db: Database) {}

  private async write(value: string): Promise<{ id: string; value: string }> {
    const rows = await this.db.execute(dsql`insert into base.audit_probe (value) values (${value}) returning id, value`)
    return rows.rows[0] as { id: string; value: string }
  }

  @Post('ok')
  @Access({ action: 'probes:create', roles: ['admin'] })
  @Audited({
    objectType: 'Sonde',
    describe: ({ response, body }) => ({ objectId: response.id, scope: 'probe-scope', summary: `Création de la sonde ${body.value}` }),
  })
  @ApiRoute(hidden)
  ok(@ValidBody() body: z.infer<typeof probeBody>) {
    return this.write(body.value)
  }

  @Post('delete')
  @Access({ action: 'probes:delete', roles: ['admin'] })
  @Audited({ objectType: 'Sonde', describe: ({ response }) => ({ objectId: response.id, summary: 'Suppression de la sonde' }) })
  @ApiRoute(hidden)
  remove(@ValidBody() body: z.infer<typeof probeBody>) {
    return this.write(body.value)
  }

  @Post('messy')
  @Access({ action: 'probes:messy', roles: ['admin'] })
  @Audited({ objectType: 'Sonde', describe: ({ body, response }) => ({ objectId: response.id, summary: body.value }) })
  @ApiRoute(hidden)
  messy(@ValidBody() body: z.infer<typeof probeBody>) {
    return this.write(body.value)
  }

  @Post('long')
  @Access({ action: 'probes:long', roles: ['admin'] })
  @Audited({ objectType: 'Sonde', describe: ({ response }) => ({ objectId: response.id, summary: 'é'.repeat(700) }) })
  @ApiRoute(hidden)
  long(@ValidBody() body: z.infer<typeof probeBody>) {
    return this.write(body.value)
  }

  @Post('conflict')
  @Access({ action: 'probes:conflict', roles: ['admin'] })
  @Audited({ objectType: 'Sonde', describe: ({ response }) => ({ objectId: response.id, summary: 'jamais' }) })
  @ApiRoute(hidden)
  async conflict(@ValidBody() body: z.infer<typeof probeBody>) {
    await this.write(body.value)
    throw new ApiError(409, 'probes.conflict', 'Written then refused')
  }

  @Post('bad-id')
  @Access({ action: 'probes:bad-id', roles: ['admin'] })
  @Audited({ objectType: 'Sonde', describe: () => ({ objectId: 'x'.repeat(101), summary: 'trop long' }) })
  @ApiRoute(hidden)
  badId(@ValidBody() body: z.infer<typeof probeBody>) {
    return this.write(body.value)
  }

  @Post('throwing')
  @Access({ action: 'probes:throwing', roles: ['admin'] })
  @Audited({
    objectType: 'Sonde',
    describe: () => {
      throw new Error('boom')
    },
  })
  @ApiRoute(hidden)
  throwing(@ValidBody() body: z.infer<typeof probeBody>) {
    return this.write(body.value)
  }

  @Post('bad-response')
  @Access({ action: 'probes:bad-response', roles: ['admin'] })
  @Audited({ objectType: 'Sonde', describe: () => ({ objectId: 'x', summary: 'réponse invalide' }) })
  @ApiRoute(hidden)
  async badResponse(@ValidBody() body: z.infer<typeof probeBody>) {
    await this.write(body.value)
    return { unexpected: true }
  }

  @Post('public')
  @Public()
  @Audited({ objectType: 'Sonde', describe: () => ({ objectId: 'x', summary: 'publique' }) })
  @ApiRoute({ hidden: true, responses: { 200: { description: 'ok' } } })
  publicRoute() {
    reached++
    return {}
  }
}

/** Write routes of a feature that forgot the declaration, exempted without reason, or both traced and exempted. */
@Controller('forgotten')
@ApiTag('Forgotten')
class ForgottenController {
  @Post('untraced')
  @Access({ action: 'forgotten:create', roles: ['admin'] })
  @ApiRoute({ responses: { 200: { description: 'ok' } } })
  untraced() {
    return {}
  }

  @Post('exempt')
  @Access({ action: 'forgotten:exempt', roles: ['admin'] })
  @AuditExempt('Analysis of a file: nothing is created or changed')
  @ApiRoute({ responses: { 200: { description: 'ok' } } })
  exempt() {
    return {}
  }

  @Post('blank')
  @Access({ action: 'forgotten:blank', roles: ['admin'] })
  @AuditExempt(' ')
  @ApiRoute({ responses: { 200: { description: 'ok' } } })
  blank() {
    return {}
  }

  @Post('both')
  @Access({ action: 'forgotten:both', roles: ['admin'] })
  @AuditExempt('both')
  @Audited({ objectType: 'X', describe: () => ({ objectId: 'x', summary: 'x' }) })
  @ApiRoute({ responses: { 200: { description: 'ok' } } })
  both() {
    return {}
  }
}

@Module({ imports: [PlatformModule], controllers: [ProbesController, ForgottenController] })
class AuditProbeModule {}

describe('declarative audit mechanism', () => {
  let app: NestExpressApplication
  let base: string
  let token: string

  const post = (path: string, body: unknown = { value: 'v' }, bearer: string | undefined = token) =>
    fetch(`${base.replace('[::1]', 'localhost')}/probes/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) },
      body: JSON.stringify(body),
    })
  const probes = async () => (await sql('select value from base.audit_probe')).length
  const journal = async () => sql('select action, object_type, object_id, scope_code, summary, actor_email from base.audit_logs')

  beforeAll(async () => {
    await sql('create table if not exists base.audit_probe (id uuid primary key default gen_random_uuid(), value text not null)')
    AccessBootCheck.enabled = false // ForgottenController is wrong on purpose: the check itself is tested below
    app = await NestFactory.create<NestExpressApplication>(AuditProbeModule, { bodyParser: false, logger: false })
    configureApp(app)
    await app.listen(0)
    base = await app.getUrl()
    AccessBootCheck.enabled = true
  })
  afterAll(async () => {
    await app.close()
    await sql('drop table if exists base.audit_probe')
    await closePool()
  })
  beforeEach(async () => {
    await resetData()
    await createUser({ email: 'admin@example.com', role: 'admin' })
    const res = await fetch('http://localhost:4000/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'admin@example.com', password: PASSWORD, returnToken: true }),
    })
    token = ((await res.json()) as { token: string }).token
  })

  it('[rule-foundation-audit-declarative-route] a declared route leaves one entry: action of the access regime, type, id, scope, summary, author', async () => {
    const res = await post('ok', { value: 'alpha' })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { id: string }
    expect(await journal()).toEqual([
      {
        action: 'probes:create',
        object_type: 'Sonde',
        object_id: body.id,
        scope_code: 'probe-scope',
        summary: 'Création de la sonde alpha',
        actor_email: 'admin@example.com',
      },
    ])
  })

  it('[rule-foundation-audit-trace-content] a deletion is traced with the verb delete', async () => {
    expect((await post('delete')).status).toBe(201)
    expect((await journal())[0]).toMatchObject({ action: 'probes:delete', summary: 'Suppression de la sonde', scope_code: null })
  })

  it('[rule-foundation-audit-summary-no-secret] the summary is normalised: whitespace and control characters collapsed, cut at 500 with an ellipsis', async () => {
    expect(normaliseSummary('  a \n\t b\u0007\u0007c  ')).toBe('a b c')
    expect((await post('messy', { value: 'a  \n  b\tc' })).status).toBe(201)
    expect((await post('long')).status).toBe(201)
    const rows = await journal()
    expect(rows.find((r) => r.action === 'probes:messy')?.summary).toBe('a b c')
    const long = rows.find((r) => r.action === 'probes:long')!.summary
    expect(Array.from(long)).toHaveLength(500)
    expect(long.endsWith('é…')).toBe(true)
  })

  it('[rule-foundation-audit-atomic-with-action] an action refused after writing leaves neither data nor entry', async () => {
    const res = await post('conflict')
    expect(res.status).toBe(409)
    expect(((await res.json()) as { code: string }).code).toBe('probes.conflict')
    expect(await probes()).toBe(0)
    expect(await journal()).toHaveLength(0)
  })

  it.each(['bad-id', 'throwing'])(
    '[rule-foundation-audit-atomic-with-action] an invalid description (%s) is 500 audit.invalid_descriptor and cancels the action',
    async (path) => {
      const res = await post(path)
      expect(res.status).toBe(500)
      expect(((await res.json()) as { code: string }).code).toBe('audit.invalid_descriptor')
      expect(await probes()).toBe(0)
      expect(await journal()).toHaveLength(0)
    },
  )

  it('[rule-foundation-audit-atomic-with-action] a response that does not match the contract cancels the action and the entry', async () => {
    const res = await post('bad-response')
    expect(res.status).toBe(500)
    expect(await probes()).toBe(0)
    expect(await journal()).toHaveLength(0)
  })

  it('[rule-foundation-audit-atomic-with-action] a validation error (400), a visitor (401) and a missing token leave nothing', async () => {
    expect((await post('ok', { value: '' })).status).toBe(400)
    expect((await post('ok', { value: 'x' }, '')).status).toBe(401)
    expect(await probes()).toBe(0)
    expect(await journal()).toHaveLength(0)
  })

  it('[rule-foundation-audit-declarative-route] a traced route without authenticated regime is 500 audit.misconfigured before any handling', async () => {
    const before = reached
    const res = await post('public', {}, '')
    expect(res.status).toBe(500)
    expect(((await res.json()) as { code: string }).code).toBe('audit.misconfigured')
    expect(reached).toBe(before)
  })

  it('[rule-foundation-audit-declarative-route] the pre-delivery check names every write route that is neither traced nor exempted', () => {
    const routes = app.get(RouteCatalog).list()
    const problems = findAuditProblems(routes)
    expect(problems.filter((p) => p.includes('neither traced'))).toEqual([
      expect.stringContaining('POST /forgotten/untraced (ForgottenController.untraced)'),
    ])
    expect(problems.some((p) => p.includes('/forgotten/exempt'))).toBe(false)
    expect(problems.some((p) => p.includes('/forgotten/blank') && p.includes('without a reason'))).toBe(true)
    expect(problems.some((p) => p.includes('/forgotten/both') && p.includes('both traced and exempted'))).toBe(true)
    // the hidden test routes are exempt by nature; only the deliberately public traced one is reported
    expect(problems.filter((p) => p.includes('/probes/'))).toEqual([expect.stringContaining('POST /probes/public')])
  })

  it('[rule-foundation-audit-declarative-route] the real application has no write route left untraced (boot check)', async () => {
    const res = await fetch('http://localhost:4000/server/health-check')
    expect(res.status).toBe(200) // the running server refused to start otherwise
  })
})
