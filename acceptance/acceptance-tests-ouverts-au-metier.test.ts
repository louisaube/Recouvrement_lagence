import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { API_URL, resetData, closePool } from './harness'

// Version `socle-tests-ouverts-au-metier` : le document OpenAPI servi doit contenir le socle
// sans interdire les ajouts métier (chemins, schémas de sécurité, mots). Boîte noire : seul le
// document servi par `GET /api-json` est lu ; aucune route n'est créée ni modifiée.

const FOUNDATION_PATHS = [
  '/audit-logs',
  '/audit-logs/filters',
  '/auth/current-user',
  '/auth/login',
  '/auth/logout',
  '/groups',
  '/groups/{id}',
  '/scopes',
  '/scopes/{id}',
  '/server/health-check',
  '/users',
  '/users/imports/preview',
  '/users/imports/specification',
  '/users/imports/{importId}/confirm',
  '/users/imports/{importId}/errors',
  '/users/{id}',
]

const METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']
const FORBIDDEN_WORDS = /company|tenant|entreprise/i

async function getDoc(): Promise<any> {
  const res = await fetch(`${API_URL}/api-json`)
  expect(res.status).toBe(200)
  return res.json()
}

/** Schémas de `components.schemas` atteints (transitivement par `$ref`) depuis des fragments. */
function reachedSchemas(doc: any, fragments: unknown[]): Record<string, unknown> {
  const all = doc.components?.schemas ?? {}
  const reached: Record<string, unknown> = {}
  const queue: unknown[] = [...fragments]
  while (queue.length > 0) {
    const text = JSON.stringify(queue.pop())
    for (const match of text.matchAll(/"\$ref":"#\/components\/schemas\/([^"]+)"/g)) {
      const name = match[1]
      if (!(name in reached) && name in all) {
        reached[name] = all[name]
        queue.push(all[name])
      }
    }
  }
  return reached
}

describe('Socle - document OpenAPI ouvert aux ajouts métier', () => {
  beforeEach(async () => {
    await resetData()
  })
  afterAll(async () => {
    await closePool()
  })

  it('[Q-PLAT-03] every foundation path is present in the served OpenAPI document (extra paths are allowed)', async () => {
    const doc = await getDoc()
    expect(Object.keys(doc.paths)).toEqual(expect.arrayContaining(FOUNDATION_PATHS))
  })

  it('[Q-PLAT-03][EXI-PLAT-15] every foundation path keeps at least the operations of the contract of record', async () => {
    const doc = await getDoc()
    const contract = JSON.parse(readFileSync(join(__dirname, '..', 'specifications', 'openapi.json'), 'utf8'))
    for (const path of FOUNDATION_PATHS) {
      const expected = Object.keys(contract.paths[path]).filter((k) => METHODS.includes(k))
      const served = Object.keys(doc.paths[path] ?? {}).filter((k) => METHODS.includes(k))
      expect({ path, methods: served }).toEqual({ path, methods: expect.arrayContaining(expected) })
    }
  })

  it('[Q-PLAT-03][EXI-PLAT-15] no path of the served document is a test route (/test/)', async () => {
    const doc = await getDoc()
    const testPaths = Object.keys(doc.paths).filter((p) => p.includes('/test/'))
    expect(testPaths).toEqual([])
  })

  it('[Q-PLAT-03][EXI-PLAT-15] both security schemes, bearer and cookie, are declared (more are allowed)', async () => {
    const doc = await getDoc()
    const schemes = doc.components?.securitySchemes ?? {}
    expect(Object.keys(schemes)).toEqual(expect.arrayContaining(['bearer', 'cookie']))
    expect(schemes.bearer).toEqual(expect.objectContaining({ type: 'http', scheme: 'bearer' }))
    expect(schemes.cookie).toEqual(expect.objectContaining({ type: 'apiKey', in: 'cookie' }))
  })

  it('[Q-PLAT-03] the OpenAPI viewer GET /api answers 200', async () => {
    const res = await fetch(`${API_URL}/api`)
    expect(res.status).toBe(200)
  })

  it('[rule-foundation-no-multi-company] foundation operations and the schemas they reference mention no company, tenant or entreprise', async () => {
    const doc = await getDoc()
    const operations = FOUNDATION_PATHS.map((p) => doc.paths[p])
    expect(operations.every((o) => o !== undefined)).toBe(true)
    const schemas = reachedSchemas(doc, operations)
    const text = JSON.stringify({ operations, schemas })
    expect(text.match(FORBIDDEN_WORDS)?.[0]).toBeUndefined()
  })

  describe('le test développeur [Q-PLAT-03] du socle, rejoué sur des documents modifiés', () => {
    const SOURCE = join(__dirname, '..', 'api', 'src', 'features', 'auth', 'tests', 'auth.test.ts')
    const TITLE = '[Q-PLAT-03] the OpenAPI document is served in test'

    /** Corps de la fonction du test `[Q-PLAT-03]`, extrait du source par appariement des accolades. */
    function devTestBody(): string {
      const src = readFileSync(SOURCE, 'utf8')
      const start = src.indexOf(TITLE)
      expect(start).toBeGreaterThan(-1)
      const open = src.indexOf('{', src.indexOf('=>', start))
      let depth = 0
      for (let i = open; i < src.length; i++) {
        if (src[i] === '{') depth++
        else if (src[i] === '}' && --depth === 0) return src.slice(open + 1, i)
      }
      throw new Error('test body not closed')
    }

    /** Rejoue le corps du test développeur avec un `call` qui sert `doc` ; rejette si une assertion échoue. */
    async function replay(doc: any): Promise<void> {
      const AsyncFunction = Object.getPrototypeOf(async () => undefined).constructor
      const run = new AsyncFunction('call', 'expect', devTestBody())
      const call = async (_path: string) => ({ status: 200, json: async () => structuredClone(doc) })
      await run(call, expect)
    }

    const businessOperation = {
      get: {
        summary: 'Mon entreprise',
        description: 'Company and tenant wording belongs to business modules',
        responses: { '200': { description: 'ok' } },
      },
    }

    it('[Q-PLAT-03] baseline: the developer test passes on the document served today', async () => {
      await expect(replay(await getDoc())).resolves.toBeUndefined()
    })

    it('[Q-PLAT-03] the developer test still passes when a business module adds a path', async () => {
      const doc = await getDoc()
      doc.paths['/account'] = businessOperation
      await expect(replay(doc)).resolves.toBeUndefined()
    })

    it('[Q-PLAT-03] the developer test still passes when a business module adds a security scheme', async () => {
      const doc = await getDoc()
      doc.components.securitySchemes.apiKeyHeader = { type: 'apiKey', in: 'header', name: 'X-Key' }
      await expect(replay(doc)).resolves.toBeUndefined()
    })

    it('[rule-foundation-no-multi-company] the developer test still passes when business content mentions company, tenant or entreprise', async () => {
      const doc = await getDoc()
      doc.paths['/account'] = businessOperation
      doc.components.schemas.AccountDto = { type: 'object', properties: { entreprise: { type: 'string' }, tenant: { type: 'string' } } }
      await expect(replay(doc)).resolves.toBeUndefined()
    })

    it('[Q-PLAT-03] the developer test still fails when a foundation path disappears', async () => {
      const doc = await getDoc()
      delete doc.paths['/audit-logs/filters']
      await expect(replay(doc)).rejects.toThrow()
    })

    it('[Q-PLAT-03] the developer test still fails when a test route (/test/) is served', async () => {
      const doc = await getDoc()
      doc.paths['/test/reset'] = businessOperation
      await expect(replay(doc)).rejects.toThrow()
    })

    it('[Q-PLAT-03] the developer test still fails when the cookie security scheme is missing', async () => {
      const doc = await getDoc()
      delete doc.components.securitySchemes.cookie
      await expect(replay(doc)).rejects.toThrow()
    })

    it('[Q-PLAT-03] the developer test still fails when the bearer security scheme is missing', async () => {
      const doc = await getDoc()
      delete doc.components.securitySchemes.bearer
      await expect(replay(doc)).rejects.toThrow()
    })
  })

  it('[rule-foundation-no-multi-company] the check is not extended to the whole document: it reads foundation content only', async () => {
    // Garde-fou de la recette : la vérification porte sur un sous-ensemble non vide du document.
    const doc = await getDoc()
    const operations = FOUNDATION_PATHS.map((p) => doc.paths[p])
    const schemas = reachedSchemas(doc, operations)
    expect(Object.keys(schemas).length).toBeGreaterThan(0)
    expect(JSON.stringify(operations).length).toBeGreaterThan(1000)
  })
})
