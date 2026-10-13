import 'reflect-metadata'
import { Controller, Get, Module, Patch, Post } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { z } from 'zod'
import { AccessBootCheck } from '../access/access-boot-check'
import { findAccessProblems } from '../access/access-check'
import { Access, Public } from '../access/access.decorators'
import { RouteCatalog } from '../access/route-catalog.service'
import { configureApp } from '../http/configure-app'
import { buildOpenApiDocument } from '../openapi/openapi.builder'
import { ApiRoute, ApiTag } from '../openapi/route-contract'
import { PlatformModule } from '../platform.module'
import { ApiResponse, PASSWORD, closePool, createUser, resetData, sql } from '../testing/helpers'
import { ValidBody, ValidQuery } from '../validation/zod-validation.interceptor'

/** A fictitious feature, present only in this test (EXI-PLAT-12): routes of every access regime. */
const widgetSchema = z.object({ name: z.string().min(1).max(10) })
const patchSchema = z.strictObject({ name: z.string().min(1).max(10) })
const listQuery = z.object({ size: z.coerce.number().int().min(1).max(100).default(10), q: z.string().optional() })
let reached = 0

@Controller('widgets')
@ApiTag('Widgets')
class WidgetsController {
  @Get('undeclared')
  undeclared(): object {
    reached++
    return { reached }
  }

  @Get('open')
  @Public()
  @ApiRoute({ responses: { 200: { description: 'ok' } } })
  open(): object {
    return { ok: true }
  }

  @Get('for-users')
  @Access({ action: 'widgets:read', roles: ['user'] })
  @ApiRoute({ query: listQuery, responses: { 200: { description: 'ok' } } })
  forUsers(@ValidQuery() query: z.infer<typeof listQuery>): object {
    return { query }
  }

  @Post('for-admins')
  @Access({ action: 'widgets:create', roles: ['admin'] })
  @ApiRoute({ body: widgetSchema, responses: { 200: { description: 'ok' } } })
  forAdmins(@ValidBody() body: z.infer<typeof widgetSchema>): object {
    reached++
    return { body }
  }

  @Patch('patchable')
  @Access({ action: 'widgets:update', roles: ['admin'] })
  @ApiRoute({ body: patchSchema, responses: { 200: { description: 'ok' } } })
  patchable(@ValidBody() body: z.infer<typeof patchSchema>): object {
    return { body }
  }
}

@Module({ imports: [PlatformModule], controllers: [WidgetsController] })
class WidgetsTestModule {}

/** Declares its access but no @ApiRoute contract: its inputs would escape the validation and the OpenAPI document. */
@Controller('uncontracted')
class UncontractedController {
  @Get()
  @Public()
  open(): object {
    return {}
  }
}

@Module({ imports: [PlatformModule], controllers: [UncontractedController] })
class UncontractedTestModule {}

describe('platform', () => {
  let app: NestExpressApplication
  let base: string

  beforeAll(async () => {
    AccessBootCheck.enabled = false // the undeclared route is on purpose: the check itself is tested below
    app = await NestFactory.create<NestExpressApplication>(WidgetsTestModule, { bodyParser: false, logger: false })
    configureApp(app)
    await app.listen(0)
    base = await app.getUrl()
    AccessBootCheck.enabled = true
  })
  afterAll(async () => {
    await app.close()
    await closePool()
  })
  beforeEach(resetData)

  const send = (
    path: string,
    init: { method?: string; token?: string; body?: unknown; raw?: string } = {},
  ): Promise<ApiResponse> =>
    fetch(`${base.replace('[::1]', 'localhost')}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        ...(init.body !== undefined || init.raw ? { 'content-type': 'application/json' } : {}),
        ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
      },
      body: init.raw ?? (init.body !== undefined ? JSON.stringify(init.body) : undefined),
    }) as Promise<ApiResponse>

  const tokenOf = async (email: string, role: 'user' | 'admin') => {
    await createUser({ email, role })
    const res = await fetch('http://localhost:4000/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: PASSWORD, returnToken: true }),
    })
    return ((await res.json()) as { token: string }).token
  }

  describe('access declaration', () => {
    it('[EXI-PLAT-11] a route without declaration is never served: 401 to a visitor, 403 to an authenticated caller', async () => {
      const user = await tokenOf('u@example.com', 'user')
      const admin = await tokenOf('a@example.com', 'admin')
      const before = reached
      const visitor = await send('/widgets/undeclared')
      expect(visitor.status).toBe(401)
      expect((await visitor.json()).code).toBe('security.missing_token')
      for (const token of [user, admin]) {
        const res = await send('/widgets/undeclared', { token })
        expect(res.status).toBe(403)
        expect(await res.json()).toMatchObject({ status: 403, code: 'security.access_denied' })
      }
      expect(reached).toBe(before)
    })

    it('[Q-PLAT-05] the server refuses to start and names the undeclared route', async () => {
      const failing = NestFactory.createApplicationContext(WidgetsTestModule, { logger: false })
      await expect(failing).rejects.toThrow(/GET \/widgets\/undeclared \(WidgetsController\.undeclared\)/)
    })

    it('[Q-PLAT-05][EXI-PLAT-09] the server refuses to start when a route has no @ApiRoute contract', async () => {
      const failing = NestFactory.createApplicationContext(UncontractedTestModule, { logger: false })
      await expect(failing).rejects.toThrow(/GET \/uncontracted \(UncontractedController\.open\) has no @ApiRoute contract/)
    })

    it('[Q-PLAT-05] findAccessProblems reports a conflict, a malformed or duplicated action code and no role', () => {
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
      const problems = findAccessProblems([
        route({ public: true, access: { action: 'x:read', roles: ['user'] } }),
        route({ path: '/y', access: { action: 'Bad Action', roles: ['user'] } }),
        route({ path: '/z', access: { action: 'x:read', roles: [] } }),
        route({ path: '/w', access: { action: 'x:read', roles: ['admin'] } }),
      ] as never)
      expect(problems).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/both public and authenticated/),
          expect.stringMatching(/invalid action code "Bad Action"/),
          expect.stringMatching(/admits no role/),
          expect.stringMatching(/reuses the action code "x:read"/),
        ]),
      )
    })

    it('[EXI-PLAT-10] a public route needs no token; a user-role route admits user and admin, an admin route only admin', async () => {
      expect((await send('/widgets/open')).status).toBe(200)
      expect((await send('/widgets/for-users')).status).toBe(401)
      const user = await tokenOf('u@example.com', 'user')
      const admin = await tokenOf('a@example.com', 'admin')
      expect((await send('/widgets/for-users', { token: user })).status).toBe(200)
      expect((await send('/widgets/for-users', { token: admin })).status).toBe(200)
      expect((await send('/widgets/for-admins', { method: 'POST', token: user, body: { name: 'ok' } })).status).toBe(403)
      expect((await send('/widgets/for-admins', { method: 'POST', token: admin, body: { name: 'ok' } })).status).toBe(201)
    })

    it('[EXI-PLAT-11] the role check precedes validation and body reading', async () => {
      const user = await tokenOf('u@example.com', 'user')
      const before = reached
      const refused = await send('/widgets/for-admins', { method: 'POST', token: user, raw: '{broken json' })
      expect(refused.status).toBe(403)
      const anonymous = await send('/widgets/for-admins', { method: 'POST', raw: '{broken json' })
      expect(anonymous.status).toBe(401)
      expect(reached).toBe(before)
    })

    it('[EXI-PLAT-10] a token of an unknown account is refused with security.invalid_token', async () => {
      const token = await tokenOf('u@example.com', 'user')
      await sql('delete from base.users')
      const res = await send('/widgets/for-users', { token })
      expect(res.status).toBe(401)
      expect((await res.json()).code).toBe('security.invalid_token')
    })
  })

  describe('validation', () => {
    it('[EXI-PLAT-07] query parameters are validated and defaulted, a repeated parameter is refused', async () => {
      const admin = await tokenOf('a@example.com', 'admin')
      const ok = await send('/widgets/for-users', { token: admin })
      expect((await ok.json()).query).toEqual({ size: 10 })
      for (const query of ['size=0', 'size=101', 'size=1.5', 'size=abc', 'size=-1', 'q=a&q=b']) {
        const res = await send(`/widgets/for-users?${query}`, { token: admin })
        expect(res.status).toBe(400)
        expect((await res.json()).code).toBe('api.validation.incoming_failed')
      }
      expect((await send('/widgets/for-users?size=100', { token: admin })).status).toBe(200)
    })

    it('[EXI-PLAT-06] a null character is refused in a query parameter, a path or a body value', async () => {
      const admin = await tokenOf('a@example.com', 'admin')
      expect((await send('/widgets/for-users?q=a%00b', { token: admin })).status).toBe(400)
      const body = await send('/widgets/for-admins', { method: 'POST', token: admin, body: { name: 'a\u0000b' } })
      expect(body.status).toBe(400)
    })

    it('[Q-PLAT-07] unknown keys are stripped outside PATCH and refused on PATCH', async () => {
      const admin = await tokenOf('a@example.com', 'admin')
      const post = await send('/widgets/for-admins', { method: 'POST', token: admin, body: { name: 'ok', extra: 1 } })
      expect((await post.json()).body).toEqual({ name: 'ok' })
      const patch = await send('/widgets/patchable', { method: 'PATCH', token: admin, body: { name: 'ok', extra: 1 } })
      expect(patch.status).toBe(400)
      expect((await patch.json()).details[0].path).toBe('body')
      expect((await send('/widgets/patchable', { method: 'PATCH', token: admin, body: { name: 'ok' } })).status).toBe(200)
    })

    it('[EXI-PLAT-03] a body the parser cannot read (unsupported charset or encoding) is a 400, never a 500', async () => {
      const admin = await tokenOf('a@example.com', 'admin')
      const url = `${base.replace('[::1]', 'localhost')}/widgets/for-admins`
      const variants: Record<string, string>[] = [
        { 'content-type': 'application/json; charset=utf-32' },
        { 'content-type': 'application/json', 'content-encoding': 'br' },
      ]
      for (const headers of variants) {
        const res = await fetch(url, {
          method: 'POST',
          headers: { ...headers, authorization: `Bearer ${admin}` },
          body: JSON.stringify({ name: 'ok' }),
        })
        expect(res.status).toBe(400)
        expect(await res.json()).toMatchObject({ status: 400, code: 'api.validation.incoming_failed' })
      }
    })

    it('[Q-PLAT-01] a validation error lists { path, message } and nothing else', async () => {
      const admin = await tokenOf('a@example.com', 'admin')
      const res = await send('/widgets/for-admins', { method: 'POST', token: admin, body: { name: 'far too long a name' } })
      const body = await res.json()
      expect(Object.keys(body).sort()).toEqual(['code', 'details', 'message', 'status'])
      expect(body.details).toEqual([{ path: 'body.name', message: expect.any(String) }])
    })
  })

  describe('OpenAPI document', () => {
    it('[EXI-PLAT-15][EXI-PLAT-09] is generated from the declared routes and carries every bound of the Zod schemas', () => {
      const doc = buildOpenApiDocument(app.get(RouteCatalog).list())
      const query = doc.paths['/widgets/for-users'].get.parameters
      expect(query).toEqual([
        expect.objectContaining({ name: 'size', in: 'query', required: false, schema: expect.objectContaining({ minimum: 1, maximum: 100 }) }),
        expect.objectContaining({ name: 'q', in: 'query', required: false }),
      ])
      const body = doc.paths['/widgets/for-admins'].post.requestBody.content['application/json'].schema
      expect(body.properties.name).toMatchObject({ type: 'string', minLength: 1, maxLength: 10 })
      expect(doc.paths['/widgets/undeclared']).toBeUndefined() // no contract: not documented
      expect(doc.paths['/widgets/for-users'].get.security).toEqual([{ bearer: [] }, { cookie: [] }])
      expect(doc.paths['/widgets/open'].get.security).toBeUndefined()
    })
  })
})
