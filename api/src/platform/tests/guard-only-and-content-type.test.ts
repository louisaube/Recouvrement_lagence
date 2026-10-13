import 'reflect-metadata'
import { CanActivate, Controller, ExecutionContext, Get, Module, Post, UseGuards } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { z } from 'zod'
import { AccessBootCheck } from '../access/access-boot-check'
import { describeRoute, findAccessProblems } from '../access/access-check'
import { Access } from '../access/access.decorators'
import { RouteCatalog } from '../access/route-catalog.service'
import { AuditExempt, Audited } from '../audit/audit.decorators'
import { configureApp } from '../http/configure-app'
import { buildOpenApiDocument } from '../openapi/openapi.builder'
import { ApiRoute, ApiTag, RouteContract } from '../openapi/route-contract'
import { PlatformModule } from '../platform.module'
import { PASSWORD, closePool, createUser, resetData, sql } from '../testing/helpers'
import { ValidBody } from '../validation/zod-validation.interceptor'

/**
 * Two declaration capabilities of the platform, proved with hidden routes of a fictitious feature present only in this
 * test: a route reserved to a business guard (`roles: []`) and the content type of a response.
 */
const body = z.strictObject({ value: z.string().min(1).max(10) })
let reached = 0

class AllowGuard implements CanActivate {
  canActivate(): boolean {
    return true
  }
}
class DenyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{ user?: { role: string } }>()
    if (!req.user) throw new Error('the platform must set req.user before a business guard')
    return false // Nest answers 403 Forbidden: the refusal is the guard's own
  }
}

@Controller('guarded')
@ApiTag('Guarded')
class GuardedController {
  @Post('open')
  @UseGuards(AllowGuard)
  @Access({ action: 'guarded:open', roles: [] })
  @AuditExempt('Probe route: nothing is created or changed')
  @ApiRoute({ hidden: true, body, responses: { 200: { description: 'ok' } } })
  open(@ValidBody() _body: z.infer<typeof body>): object {
    reached++
    return { ok: true }
  }

  @Post('closed')
  @UseGuards(DenyGuard)
  @Access({ action: 'guarded:closed', roles: [] })
  @AuditExempt('Probe route: nothing is created or changed')
  @ApiRoute({ hidden: true, body, responses: { 200: { description: 'ok' } } })
  closed(@ValidBody() _body: z.infer<typeof body>): object {
    reached++
    return { ok: true }
  }

  @Get('csv')
  @UseGuards(AllowGuard)
  @Access({ action: 'guarded:csv', roles: [] })
  @Audited({ objectType: 'Export', describe: () => ({ objectId: 'csv', summary: 'Export des données' }) })
  @ApiRoute({
    hidden: true,
    responses: { 200: { description: 'CSV file', contentType: 'text/csv; charset=utf-8', schema: z.string() } },
  })
  csv(): string {
    return 'a;b\n1;2\n'
  }

  @Get('csv-broken')
  @UseGuards(AllowGuard)
  @Access({ action: 'guarded:csv-broken', roles: [] })
  @Audited({ objectType: 'Export', describe: () => ({ objectId: 'csv', summary: 'Export des données' }) })
  @ApiRoute({
    hidden: true,
    responses: { 200: { description: 'CSV file', contentType: 'text/csv', schema: z.string() } },
  })
  csvBroken(): object {
    return { not: 'a string' }
  }
}

@Module({ imports: [PlatformModule], controllers: [GuardedController] })
class GuardedTestModule {}

const route = (over: object) => ({
  method: 'GET',
  path: '/x',
  controller: 'C',
  handlerName: 'h',
  controllerType: Object,
  handler: () => undefined,
  public: false,
  customGuards: [],
  ...over,
})

/** A catalog route whose handler carries the real decorators. */
function declared(access: object | undefined, contract: RouteContract, over: object = {}) {
  const handler = function handler() {
    return undefined
  }
  if (access) Access(access as never)({}, 'handler', { value: handler } as never)
  ApiRoute(contract)({}, 'handler', { value: handler } as never)
  return route({ handler, access, ...over }) as never
}

describe('route reserved to a business guard (roles: [])', () => {
  let app: NestExpressApplication
  let base: string
  let user: string
  let admin: string

  const login = async (email: string) => {
    const res = await fetch('http://localhost:4000/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: PASSWORD, returnToken: true }),
    })
    return ((await res.json()) as { token: string }).token
  }
  const call = (path: string, init: { method?: string; token?: string; raw?: string } = {}) =>
    fetch(`${base.replace('[::1]', 'localhost')}/guarded/${path}`, {
      method: init.method ?? 'POST',
      headers: {
        ...(init.raw ? { 'content-type': 'application/json' } : {}),
        ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
      },
      body: init.raw,
    })
  const valid = JSON.stringify({ value: 'ok' })

  beforeAll(async () => {
    app = await NestFactory.create<NestExpressApplication>(GuardedTestModule, { bodyParser: false, logger: false })
    configureApp(app)
    await app.listen(0)
    base = await app.getUrl()
  })
  afterAll(async () => {
    await app.close()
    await closePool()
  })
  beforeEach(async () => {
    await resetData()
    await createUser({ email: 'u@example.com', role: 'user' })
    await createUser({ email: 'a@example.com', role: 'admin' })
    user = await login('u@example.com')
    admin = await login('a@example.com')
  })

  it('[rule-foundation-access-guard-only-regime] without a valid token the route answers 401', async () => {
    const anonymous = await call('open', { raw: valid })
    expect(anonymous.status).toBe(401)
    expect(((await anonymous.json()) as { code: string }).code).toBe('security.missing_token')
    const forged = await call('open', { raw: valid, token: 'not-a-token' })
    expect(forged.status).toBe(401)
    expect(((await forged.json()) as { code: string }).code).toBe('security.invalid_token')
  })

  it.each(['user', 'admin'])('[rule-foundation-access-guard-only-regime] a valid %s token is let through when the guard admits', async (role) => {
    const res = await call('open', { raw: valid, token: role === 'user' ? user : admin })
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ ok: true })
  })

  it.each(['user', 'admin'])('[rule-foundation-access-guard-only-route] the refusal of the guard is its own (403 Forbidden, not security.access_denied) for %s', async (role) => {
    const res = await call('closed', { raw: valid, token: role === 'user' ? user : admin })
    expect(res.status).toBe(403)
    expect(((await res.json()) as { code?: string }).code).not.toBe('security.access_denied')
  })

  it('[rule-foundation-access-guard-only-regime] no validation or body reading before the guard: a broken body is refused by the guard, not with 400', async () => {
    const before = reached
    const res = await call('closed', { raw: '{broken json', token: user })
    expect(res.status).toBe(403)
    expect(reached).toBe(before)
  })

  it('[rule-foundation-access-guard-only-route] the route is reported auth+custom with allow: [] and its action', () => {
    const entry = describeRoute(
      route({ access: { action: 'exports:absences', roles: [] }, customGuards: ['CapabilityGuard'] }) as never,
    )
    expect(entry).toEqual({
      method: 'GET',
      path: '/x',
      regime: 'auth+custom',
      allow: [],
      action: 'exports:absences',
      customGuards: ['CapabilityGuard'],
    })
  })

  it('[rule-foundation-access-guard-only-route] the catalog of the real controller reports the guard-only route', () => {
    const catalog = app.get(RouteCatalog)
    const entry = catalog.list().find((r) => r.path === '/guarded/open')!
    expect(describeRoute(entry)).toMatchObject({
      regime: 'auth+custom',
      allow: [],
      action: 'guarded:open',
      customGuards: ['AllowGuard'],
    })
  })

  it('[rule-foundation-access-guard-only-route] the document carries the bearer and cookie security like any authenticated route', () => {
    const doc = buildOpenApiDocument([
      declared(
        { action: 'exports:absences', roles: [] },
        { responses: { 200: { description: 'ok' } } },
        { path: '/exports/absences', method: 'POST', customGuards: ['CapabilityGuard'] },
      ),
    ])
    expect(doc.paths['/exports/absences'].post.security).toEqual([{ bearer: [] }, { cookie: [] }])
  })

  it('[rule-foundation-access-undeclared-refused][rule-foundation-access-no-role-without-guard-refused][rule-foundation-access-owner-only-needs-role] findAccessProblems', () => {
    expect(findAccessProblems([route({ access: { action: 'x:read', roles: [] }, customGuards: ['G'] }) as never])).toEqual([])

    const noGuard = findAccessProblems([route({ access: { action: 'x:read', roles: [] } }) as never])
    expect(noGuard).toEqual([expect.stringMatching(/GET \/x \(C\.h\) admits no role and no business guard/)])
    expect(noGuard[0]).toMatch(/admits no role/) // the pattern of the older test of the platform

    const ownerOnly = findAccessProblems([
      route({ access: { action: 'x:read', roles: [], ownerOnly: true }, customGuards: ['G'] }) as never,
    ])
    expect(ownerOnly).toEqual([expect.stringMatching(/GET \/x .*ownerOnly/)])

    expect(findAccessProblems([route({}) as never])).toEqual([expect.stringMatching(/has no access declaration/)])
  })

  it('[rule-foundation-existing-routes-unchanged] roles: [user] and roles: [admin] keep their allow lists; ownerOnly with roles: [user] keeps admin only', () => {
    const allow = (access: object) => describeRoute(route({ access }) as never).allow
    expect(allow({ action: 'x:a', roles: ['user'] })).toEqual(['user', 'admin'])
    expect(allow({ action: 'x:b', roles: ['admin'] })).toEqual(['admin'])
    expect(allow({ action: 'x:c', roles: ['user'], ownerOnly: true })).toEqual(['admin'])
  })

  it('[rule-foundation-access-no-role-without-guard-refused] the start-up check refuses roles: [] without a guard and names the route', () => {
    const catalog = { list: () => [declared({ action: 'x:lonely', roles: [] }, { responses: { 200: { description: 'ok' } } }, { path: '/lonely' })] }
    expect(() => new AccessBootCheck(catalog as never).onApplicationBootstrap()).toThrow(
      /GET \/lonely .*admits no role and no business guard/s,
    )
  })

  it('[rule-foundation-access-guard-only-route] the start-up check accepts roles: [] with a guard', () => {
    const catalog = {
      list: () => [declared({ action: 'x:ok', roles: [] }, { responses: { 200: { description: 'ok' } } }, { customGuards: ['G'] })],
    }
    expect(() => new AccessBootCheck(catalog as never).onApplicationBootstrap()).not.toThrow()
  })

  describe('traced route with a non-JSON response', () => {
    it('[rule-foundation-response-content-type-declarative] the entry carries the declared action and the platform does not write the header', async () => {
      const res = await call('csv', { method: 'GET', token: admin })
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).not.toMatch(/text\/csv/)
      expect(await sql('select action, object_type, object_id from base.audit_logs')).toEqual([
        { action: 'guarded:csv', object_type: 'Export', object_id: 'csv' },
      ])
    })

    it('[rule-foundation-response-content-type-declarative] checkResponse still confronts the returned value with the declared schema: a mismatch is 500 and leaves no entry', async () => {
      const res = await call('csv-broken', { method: 'GET', token: admin })
      expect(res.status).toBe(500)
      expect(await sql('select action from base.audit_logs')).toEqual([])
    })
  })
})

describe('content type of a response in the OpenAPI document', () => {
  const operationOf = (responses: RouteContract['responses']) =>
    buildOpenApiDocument([
      declared(
        { action: 'exports:absences', roles: [] },
        { responses },
        { path: '/exports/absences', method: 'POST', customGuards: ['CapabilityGuard'] },
      ),
    ]).paths['/exports/absences'].post

  it('[rule-foundation-response-content-type] text/csv replaces application/json under the declared response only', () => {
    const operation = operationOf({
      200: { description: 'CSV file', contentType: 'text/csv', schema: z.string() },
      400: { description: 'invalid', schema: z.object({ code: z.string() }) },
    })
    expect(Object.keys(operation.responses['200'].content)).toEqual(['text/csv'])
    expect(Object.keys(operation.responses['400'].content)).toEqual(['application/json'])
  })

  it('[rule-foundation-response-content-type] text/csv; charset=utf-8 is published as is', () => {
    const operation = operationOf({ 200: { description: 'CSV file', contentType: 'text/csv; charset=utf-8', schema: z.string() } })
    expect(Object.keys(operation.responses['200'].content)).toEqual(['text/csv; charset=utf-8'])
  })

  it('[rule-foundation-response-content-type-default] without contentType, or with application/json, the document is the same', () => {
    const implicit = operationOf({ 200: { description: 'ok', schema: z.string() } })
    const explicit = operationOf({ 200: { description: 'ok', schema: z.string(), contentType: 'application/json' } })
    expect(explicit).toEqual(implicit)
    expect(Object.keys(implicit.responses['200'].content)).toEqual(['application/json'])
    expect(JSON.stringify(explicit)).toBe(JSON.stringify(implicit))
  })

  it('[rule-foundation-response-content-type-closed-list] a content type outside the list stops the start-up and names the route', () => {
    const catalog = {
      list: () => [
        declared(
          { action: 'exports:odd', roles: ['admin'] },
          { responses: { 200: { description: 'xml', schema: z.string(), contentType: 'application/xml' as never } } },
          { path: '/exports/odd' },
        ),
      ],
    }
    expect(() => new AccessBootCheck(catalog as never).onApplicationBootstrap()).toThrow(
      /GET \/exports\/odd .*unsupported response content type "application\/xml"/s,
    )
  })

  it.each(['application/json', 'text/csv', 'text/csv; charset=utf-8'] as const)(
    '[rule-foundation-response-content-type-closed-list] %s is admitted at start-up',
    (contentType) => {
      const catalog = {
        list: () => [
          declared({ action: 'exports:ok', roles: ['admin'] }, { responses: { 200: { description: 'ok', schema: z.string(), contentType } } }),
        ],
      }
      expect(() => new AccessBootCheck(catalog as never).onApplicationBootstrap()).not.toThrow()
    },
  )
})
