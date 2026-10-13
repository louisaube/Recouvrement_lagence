import { join } from 'node:path'

// Version `socle-garde-metier-et-reponses-non-json` : tests des deux capacités de déclaration de la plateforme
// (route réservée à une garde métier, type de contenu d'une réponse). Aucune route servie ne les adopte et le
// refus de démarrage n'est pas observable en HTTP : ces tests appellent donc directement les fonctions publiques
// de la plateforme (`api/src/platform/**`) avec des routes synthétiques, sans serveur ni base. Ils échouent tant
// que les capacités n'existent pas. Voir COVERAGE-socle-garde-metier-et-reponses-non-json.md.

const API_DIR = join(__dirname, '..', 'api')
const PLATFORM = join(API_DIR, 'src', 'platform')

process.env.DATABASE_URL ??= 'postgres://database:database@localhost:5432/unused'
process.env.JWT_SECRET ??= 'acceptance-secret'
process.env.COOKIE_SECRET ??= 'acceptance-secret'

/* eslint-disable @typescript-eslint/no-var-requires */
const { findAccessProblems, describeRoute } = require(join(PLATFORM, 'access', 'access-check'))
const { Access } = require(join(PLATFORM, 'access', 'access.decorators'))
const { AccessGuard } = require(join(PLATFORM, 'access', 'access.guard'))
const { AccessBootCheck } = require(join(PLATFORM, 'access', 'access-boot-check'))
const { ApiRoute } = require(join(PLATFORM, 'openapi', 'route-contract'))
const { buildOpenApiDocument } = require(join(PLATFORM, 'openapi', 'openapi.builder'))
const { Reflector } = require(require.resolve('@nestjs/core', { paths: [API_DIR] }))
const { z } = require(require.resolve('zod', { paths: [API_DIR] }))

type AnyRoute = Record<string, any>

/** A synthetic route of the catalog; `contract` and `access` are applied through the real decorators. */
function route(over: { path?: string; method?: string; access?: any; contract?: any; customGuards?: string[]; public?: boolean } = {}): AnyRoute {
  const handler = function handler() {
    return undefined
  }
  const target = {}
  if (over.access) Access(over.access)(target, 'handler', { value: handler })
  ApiRoute(over.contract ?? { hidden: true, responses: { 200: { description: 'ok' } } })(target, 'handler', { value: handler })
  return {
    method: over.method ?? 'GET',
    path: over.path ?? '/probe',
    controller: 'ProbeController',
    handlerName: 'handler',
    controllerType: class ProbeController {},
    handler,
    public: over.public ?? false,
    access: over.access,
    customGuards: over.customGuards ?? [],
  }
}

const GUARD = ['CapabilityGuard']

describe('Socle - route réservée à une garde métier (déclaration)', () => {
  it('[rule-foundation-access-guard-only-route] a route declared roles: [] with a business guard raises no access problem and is reported with allow: []', () => {
    const r = route({ access: { action: 'exports:absences', roles: [] }, customGuards: GUARD })
    expect(findAccessProblems([r])).toEqual([])
    expect(describeRoute(r)).toEqual({
      method: 'GET',
      path: '/probe',
      regime: 'auth+custom',
      allow: [],
      action: 'exports:absences',
      customGuards: GUARD,
    })
  })

  it('[rule-foundation-access-no-role-without-guard-refused] roles: [] without any business guard is a problem that names the route', () => {
    const problems: string[] = findAccessProblems([route({ path: '/lonely', access: { action: 'exports:lonely', roles: [] } })])
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatch(/GET \/lonely \(ProbeController\.handler\)/)
    expect(problems[0]).toMatch(/admits no role and no business guard/)
  })

  it('[rule-foundation-access-owner-only-needs-role] ownerOnly with roles: [] is refused even with a business guard', () => {
    const problems: string[] = findAccessProblems([
      route({ path: '/mine', access: { action: 'exports:mine', roles: [], ownerOnly: true }, customGuards: GUARD }),
    ])
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatch(/GET \/mine/)
    expect(problems[0]).toMatch(/ownerOnly/)
  })

  it('[rule-foundation-access-undeclared-refused] a route without declaration is still refused, a guard-only route next to it is not', () => {
    const problems: string[] = findAccessProblems([
      route({ path: '/undeclared' }),
      route({ path: '/fine', access: { action: 'exports:fine', roles: [] }, customGuards: GUARD }),
    ])
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatch(/GET \/undeclared .* has no access declaration/)
  })

  it('[rule-foundation-access-no-role-without-guard-refused] the server start-up check refuses roles: [] without guard and names the route', () => {
    const catalog = { list: () => [route({ path: '/lonely', access: { action: 'exports:lonely', roles: [] } })] }
    expect(() => new AccessBootCheck(catalog).onApplicationBootstrap()).toThrow(/GET \/lonely .*admits no role and no business guard/s)
  })

  it('[rule-foundation-access-guard-only-route] the start-up check accepts roles: [] with a business guard', () => {
    const catalog = { list: () => [route({ path: '/ok', access: { action: 'exports:ok', roles: [] }, customGuards: GUARD })] }
    expect(() => new AccessBootCheck(catalog).onApplicationBootstrap()).not.toThrow()
  })
})

describe('Socle - garde globale avec roles: []', () => {
  function guardFor(access: any, user: { role: string } | null) {
    const handler = function handler() {
      return undefined
    }
    Access(access)({}, 'handler', { value: handler })
    const req: AnyRoute = {}
    const context = { getHandler: () => handler, switchToHttp: () => ({ getRequest: () => req }) }
    const guard = new AccessGuard(new Reflector(), { authenticate: async () => user })
    return { run: () => guard.canActivate(context), req }
  }

  /** What the guard decided, as plain data: `let through`, or the code of the refusal. Failures are then value diffs. */
  async function outcome(access: any, user: { role: string } | null): Promise<string> {
    try {
      const ok = await guardFor(access, user).run()
      return ok === true ? 'let through' : `returned ${String(ok)}`
    } catch (e: any) {
      return `refused ${e?.code ?? e?.response?.code ?? e?.message ?? String(e)}`
    }
  }

  it.each(['user', 'admin'])('[rule-foundation-access-guard-only-regime] a valid %s token is let through: the business guard alone decides', async (role) => {
    expect(await outcome({ action: 'exports:absences', roles: [] }, { role })).toBe('let through')
    const { run, req } = guardFor({ action: 'exports:absences', roles: [] }, { role })
    await run()
    expect(req.user).toEqual({ role })
  })

  it('[rule-foundation-access-guard-only-regime] a roles: [] route answers 401 security.missing_token without a valid token, yet admits an ordinary user with one', async () => {
    const access = { action: 'exports:absences', roles: [] }
    expect({
      withToken: await outcome(access, { role: 'user' }),
      withoutToken: await outcome(access, null),
    }).toEqual({ withToken: 'let through', withoutToken: 'refused security.missing_token' })
  })

  it('[rule-foundation-access-guard-only-route] roles: [] never refuses by role, whereas roles: [admin] still refuses an ordinary user with security.access_denied', async () => {
    expect({
      guardOnlyUser: await outcome({ action: 'x:guarded', roles: [] }, { role: 'user' }),
      adminOnlyUser: await outcome({ action: 'x:admin', roles: ['admin'] }, { role: 'user' }),
      adminOnlyAdmin: await outcome({ action: 'x:admin', roles: ['admin'] }, { role: 'admin' }),
    }).toEqual({
      guardOnlyUser: 'let through',
      adminOnlyUser: 'refused security.access_denied',
      adminOnlyAdmin: 'let through',
    })
  })
})

describe('Socle - type de contenu d\'une réponse dans le document OpenAPI', () => {
  const responseOf = (contract: any, access: any = { action: 'exports:absences', roles: [] }) => {
    const doc = buildOpenApiDocument([route({ path: '/exports/absences', method: 'POST', access, customGuards: GUARD, contract })])
    return doc.paths['/exports/absences'].post
  }
  const visible = (responses: any) => ({ description: 'CSV file', schema: z.string(), ...responses })

  it('[rule-foundation-response-content-type] text/csv replaces application/json under the declared response', () => {
    const operation = responseOf({ responses: { 200: visible({ contentType: 'text/csv' }) } })
    expect(Object.keys(operation.responses['200'].content)).toEqual(['text/csv'])
    expect(operation.responses['200'].content['text/csv'].schema.type).toBe('string')
  })

  it('[rule-foundation-response-content-type] text/csv; charset=utf-8 is admitted and published as is', () => {
    const operation = responseOf({ responses: { 200: visible({ contentType: 'text/csv; charset=utf-8' }) } })
    expect(Object.keys(operation.responses['200'].content)).toEqual(['text/csv; charset=utf-8'])
  })

  it('[rule-foundation-response-content-type] only the declared response changes: the others stay application/json, and the operation keeps its bearer and cookie security', () => {
    const operation = responseOf({
      responses: {
        200: visible({ contentType: 'text/csv' }),
        400: { description: 'invalid', schema: z.object({ code: z.string() }) },
      },
    })
    expect(Object.keys(operation.responses['200'].content)).toEqual(['text/csv'])
    expect(Object.keys(operation.responses['400'].content)).toEqual(['application/json'])
    expect(operation.security).toEqual([{ bearer: [] }, { cookie: [] }])
  })

  it('[rule-foundation-response-content-type-default] the content type is the only difference: explicit application/json equals no declaration, and text/csv differs by that key alone', () => {
    const implicit = responseOf({ responses: { 200: { description: 'ok', schema: z.string() } } })
    const explicit = responseOf({ responses: { 200: { description: 'ok', schema: z.string(), contentType: 'application/json' } } })
    const csv = responseOf({ responses: { 200: { description: 'ok', schema: z.string(), contentType: 'text/csv' } } })
    expect(explicit).toEqual(implicit)
    expect(Object.keys(implicit.responses['200'].content)).toEqual(['application/json'])
    expect(csv.responses['200'].content).toEqual({ 'text/csv': implicit.responses['200'].content['application/json'] })
    expect(csv.responses['200'].description).toBe(implicit.responses['200'].description)
  })

  it('[rule-foundation-response-content-type-closed-list] a content type outside the closed list stops the start-up and names the route', () => {
    const catalog = {
      list: () => [
        route({
          path: '/exports/odd',
          access: { action: 'exports:odd', roles: ['admin'] },
          contract: { responses: { 200: { description: 'xml', schema: z.string(), contentType: 'application/xml' } } },
        }),
      ],
    }
    expect(() => new AccessBootCheck(catalog).onApplicationBootstrap()).toThrow(/GET \/exports\/odd .*unsupported response content type "application\/xml"/s)
  })

  it('[rule-foundation-response-content-type-declarative] declaring a content type changes neither the route report nor the access decision, and the guard never touches the HTTP response', async () => {
    const access = { action: 'exports:absences', roles: ['admin'] }
    const plain = route({ access, contract: { responses: { 200: { description: 'ok', schema: z.string() } } } })
    const csv = route({ access, contract: { responses: { 200: { description: 'ok', schema: z.string(), contentType: 'text/csv' } } } })
    expect(describeRoute(csv)).toEqual(describeRoute(plain))

    const touched: string[] = []
    const response = new Proxy({}, { get: (_t, prop) => { touched.push(String(prop)); return () => undefined } })
    const req: AnyRoute = {}
    const handler = csv.handler
    const context = { getHandler: () => handler, switchToHttp: () => ({ getRequest: () => req, getResponse: () => response }) }
    const guard = new AccessGuard(new Reflector(), { authenticate: async () => ({ role: 'admin' }) })
    expect(await guard.canActivate(context)).toBe(true)
    expect(touched).toEqual([])
  })

  it('[rule-foundation-existing-routes-unchanged] roles user / admin and ownerOnly keep their allow lists and public routes stay open to everyone', () => {
    const allow = (over: Parameters<typeof route>[0]) => describeRoute(route(over)).allow
    expect({
      user: allow({ access: { action: 'x:a', roles: ['user'] } }),
      admin: allow({ access: { action: 'x:b', roles: ['admin'] } }),
      ownerOnly: allow({ access: { action: 'x:c', roles: ['user'], ownerOnly: true } }),
      public: allow({ public: true }),
    }).toEqual({
      user: ['user', 'admin'],
      admin: ['admin'],
      ownerOnly: ['admin'],
      public: ['anonymous', 'user', 'admin'],
    })
  })

  it.each(['application/json', 'text/csv', 'text/csv; charset=utf-8'])('[rule-foundation-response-content-type-closed-list] %s is admitted at start-up', (contentType) => {
    const catalog = {
      list: () => [
        route({
          path: '/exports/ok',
          access: { action: 'exports:ok', roles: ['admin'] },
          contract: { responses: { 200: { description: 'ok', schema: z.string(), contentType } } },
        }),
      ],
    }
    expect(() => new AccessBootCheck(catalog).onApplicationBootstrap()).not.toThrow()
  })
})
