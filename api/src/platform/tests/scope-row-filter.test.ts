/**
 * Proof of the row-level rule (Q-PERIM-02). The tests create, in their own preparation, a table attached to a scope
 * (outside the data contract, dropped at the end) and a test-only controller (EXI-PLAT-12, hidden from the contract), then
 * check reads, writes and refusals for an ordinary user, a member of a group and an administrator.
 */
import 'reflect-metadata'
import { Controller, Delete, Get, Module, Patch, Post, Put } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { eq, sql as dsql } from 'drizzle-orm'
import { text, uuid } from 'drizzle-orm/pg-core'
import { z } from 'zod'
import { Access } from '../access/access.decorators'
import { base } from '../database/base-schema'
import { Database, InjectDb } from '../database/database.module'
import { configureApp } from '../http/configure-app'
import { ApiRoute } from '../openapi/route-contract'
import { PlatformModule } from '../platform.module'
import { runWithScopeAccess } from '../scopes/scope-access'
import { declareScopedTable, ScopedRepository } from '../scopes/scoped-repository'
import { ApiResponse, closePool, createUser, login, resetData, sql } from '../testing/helpers'
import { idParamsSchema } from '../validation/common'
import { ValidBody, ValidParams } from '../validation/zod-validation.interceptor'

const testItems = declareScopedTable(
  base.table('test_items', {
    id: uuid('id').primaryKey().default(dsql`gen_random_uuid()`),
    label: text('label').notNull(),
    scopeCode: text('scope_code').notNull(),
  }),
)

const createSchema = z.object({ label: z.string().min(1).max(50), scopeCode: z.string().min(1).max(50) })
const patchSchema = z.strictObject({ label: z.string().min(1).max(50).optional(), scopeCode: z.string().min(1).max(50).optional() })
const upsertSchema = z.object({ id: z.uuid(), label: z.string().min(1).max(50), scopeCode: z.string().min(1).max(50) })
const hidden = { hidden: true } as const
const ok = { 200: { description: 'ok' }, 201: { description: 'ok' } }

@Controller('test/items')
class ItemsController {
  constructor(
    private readonly items: ScopedRepository,
    @InjectDb() private readonly db: Database,
  ) {}

  @Get()
  @Access({ action: 'items:list', roles: ['user'] })
  @ApiRoute({ ...hidden, responses: ok })
  async list() {
    const items = await this.items.find(testItems, { orderBy: [dsql`label`] })
    return { items, total: await this.items.count(testItems) }
  }

  /** A hand-written aggregate applies the condition itself. */
  @Get('aggregate')
  @Access({ action: 'items:aggregate', roles: ['user'] })
  @ApiRoute({ ...hidden, responses: ok })
  async aggregate() {
    const condition = await this.items.condition(testItems)
    const rows = await this.db.execute(dsql`select count(*)::int as n from base.test_items where ${condition}`)
    return { n: rows.rows[0].n }
  }

  @Get(':id')
  @Access({ action: 'items:get', roles: ['user'] })
  @ApiRoute({ ...hidden, params: idParamsSchema, responses: ok })
  get(@ValidParams() params: z.infer<typeof idParamsSchema>) {
    return this.items.get(testItems, eq(testItems.id, params.id))
  }

  @Post()
  @Access({ action: 'items:create', roles: ['user'] })
  @ApiRoute({ ...hidden, body: createSchema, responses: ok })
  async create(@ValidBody() body: z.infer<typeof createSchema>) {
    return (await this.items.insert(testItems, body))[0]
  }

  @Post('bulk')
  @Access({ action: 'items:bulk', roles: ['user'] })
  @ApiRoute({ ...hidden, body: z.object({ rows: z.array(createSchema).max(20) }), responses: ok })
  async bulk(@ValidBody() body: { rows: z.infer<typeof createSchema>[] }) {
    return { created: (await this.items.insert(testItems, body.rows)).length }
  }

  @Patch(':id')
  @Access({ action: 'items:update', roles: ['user'] })
  @ApiRoute({ ...hidden, params: idParamsSchema, body: patchSchema, responses: ok })
  update(@ValidParams() params: z.infer<typeof idParamsSchema>, @ValidBody() body: z.infer<typeof patchSchema>) {
    return this.items.updateOne(testItems, body, eq(testItems.id, params.id))
  }

  @Put()
  @Access({ action: 'items:upsert', roles: ['user'] })
  @ApiRoute({ ...hidden, body: upsertSchema, responses: ok })
  async upsert(@ValidBody() body: z.infer<typeof upsertSchema>) {
    const rows = await this.items.upsert(testItems, body, {
      target: testItems.id,
      set: { label: body.label, scopeCode: body.scopeCode },
    })
    return { written: rows.length }
  }

  @Delete(':id')
  @Access({ action: 'items:delete', roles: ['user'] })
  @ApiRoute({ ...hidden, params: idParamsSchema, responses: ok })
  async delete(@ValidParams() params: z.infer<typeof idParamsSchema>) {
    await this.items.removeOne(testItems, eq(testItems.id, params.id))
    return {}
  }

  @Post('purge')
  @Access({ action: 'items:purge', roles: ['user'] })
  @ApiRoute({ ...hidden, responses: ok })
  async purge() {
    return { deleted: await this.items.remove(testItems, dsql`true`) }
  }
}

/** Same operations on routes where an administrator has read-only / no access to the scopes. */
@Controller('test/readonly-items')
class ReadOnlyItemsController {
  constructor(private readonly items: ScopedRepository) {}

  @Get()
  @Access({ action: 'readonly:list', roles: ['user'], adminScopes: 'read' })
  @ApiRoute({ ...hidden, responses: ok })
  async list() {
    return { total: await this.items.count(testItems) }
  }

  @Post()
  @Access({ action: 'readonly:create', roles: ['user'], adminScopes: 'read' })
  @ApiRoute({ ...hidden, body: createSchema, responses: ok })
  async create(@ValidBody() body: z.infer<typeof createSchema>) {
    return (await this.items.insert(testItems, body))[0]
  }
}

@Controller('test/closed-items')
class ClosedItemsController {
  constructor(private readonly items: ScopedRepository) {}

  @Get()
  @Access({ action: 'closed:list', roles: ['user'], adminScopes: 'none' })
  @ApiRoute({ ...hidden, responses: ok })
  async list() {
    return { total: await this.items.count(testItems) }
  }

  @Post()
  @Access({ action: 'closed:create', roles: ['user'], adminScopes: 'none' })
  @ApiRoute({ ...hidden, body: createSchema, responses: ok })
  async create(@ValidBody() body: z.infer<typeof createSchema>) {
    return (await this.items.insert(testItems, body))[0]
  }
}

@Module({ imports: [PlatformModule], controllers: [ItemsController, ReadOnlyItemsController, ClosedItemsController] })
class ItemsTestModule {}

describe('row-level rule (scopes)', () => {
  let app: NestExpressApplication
  let url: string
  let repository: ScopedRepository
  let admin: string
  let member: string // member of the group of s1 and s2
  let lonely: string // member of no group
  let memberId: string
  let s1: { id: string }
  let s2: { id: string }
  let groupId: string

  const send = (path: string, token: string | undefined, method = 'GET', body?: unknown): Promise<ApiResponse> =>
    fetch(`${url.replace('[::1]', 'localhost')}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }) as Promise<ApiResponse>
  const seedItem = async (label: string, scopeCode: string) =>
    (await sql<{ id: string }>('insert into base.test_items (label, scope_code) values ($1, $2) returning id', [label, scopeCode]))[0]
  const labels = async () => (await sql('select label from base.test_items order by label')).map((r) => r.label)

  beforeAll(async () => {
    await sql('drop table if exists base.test_items')
    await sql(`create table base.test_items (
      id uuid primary key default gen_random_uuid(),
      label text not null,
      scope_code text not null references base.scopes (code) on delete restrict on update restrict)`)
    app = await NestFactory.create<NestExpressApplication>(ItemsTestModule, { bodyParser: false, logger: false })
    configureApp(app)
    await app.listen(0)
    url = await app.getUrl()
    repository = app.get(ScopedRepository)
  })
  afterAll(async () => {
    await app.close()
    await sql('drop table if exists base.test_items')
    await closePool()
  })

  beforeEach(async () => {
    await resetData()
    await createUser({ email: 'admin@example.com', role: 'admin' })
    memberId = (await createUser({ email: 'member@example.com' })).id
    await createUser({ email: 'lonely@example.com' })
    admin = await login('admin@example.com')
    member = await login('member@example.com')
    lonely = await login('lonely@example.com')
    s1 = (await sql<{ id: string }>("insert into base.scopes (code, name) values ('s1', 'S1') returning id"))[0]
    s2 = (await sql<{ id: string }>("insert into base.scopes (code, name) values ('s2', 'S2') returning id"))[0]
    await sql("insert into base.scopes (code, name) values ('s3', 'S3')")
    groupId = (await sql<{ id: string }>("insert into base.groups (name) values ('G') returning id"))[0].id
    await sql('insert into base.group_scopes (group_id, scope_id) values ($1, $2), ($1, $3)', [groupId, s1.id, s2.id])
    await sql('insert into base.group_users (group_id, user_id) values ($1, $2)', [groupId, memberId])
  })

  it('[rule-foundation-scope-row-filter] a table declared attached without scope_code makes the module fail to load', () => {
    expect(() => declareScopedTable(base.table('no_scope', { id: uuid('id').primaryKey() }))).toThrow(/no_scope.*scope_code/)
    expect(() => declareScopedTable(base.table('nullable_scope', { scopeCode: text('scope_code') }))).toThrow(/not null/)
  })

  describe('reads', () => {
    beforeEach(async () => {
      await seedItem('a1', 's1')
      await seedItem('a2', 's1')
      await seedItem('b1', 's2')
      await seedItem('c1', 's3')
    })

    it('[rule-foundation-scope-row-filter] a member sees only the rows of the scopes of its group, without duplicate', async () => {
      // a second group gives s1 again: the scope is reached twice, the rows are listed once
      const [second] = await sql<{ id: string }>("insert into base.groups (name) values ('G2') returning id")
      await sql('insert into base.group_scopes (group_id, scope_id) values ($1, $2)', [second.id, s1.id])
      await sql('insert into base.group_users (group_id, user_id) values ($1, $2)', [second.id, memberId])
      const body = await (await send('/test/items', member)).json()
      expect(body.items.map((i: any) => i.label)).toEqual(['a1', 'a2', 'b1'])
      expect(body.total).toBe(3)
    })

    it('[rule-foundation-scope-row-filter] a row outside the scopes is a 404 repository.not_found, like a missing row', async () => {
      const [outside] = await sql<{ id: string }>("select id from base.test_items where label = 'c1'")
      const [inside] = await sql<{ id: string }>("select id from base.test_items where label = 'a1'")
      const hidden = await send(`/test/items/${outside.id}`, member)
      expect(hidden.status).toBe(404)
      expect((await hidden.json()).code).toBe('repository.not_found')
      expect((await send(`/test/items/${inside.id}`, member)).status).toBe(200)
    })

    it('[rule-foundation-user-no-group-no-data] a user without group reads nothing: empty list, count 0, detail not found', async () => {
      const body = await (await send('/test/items', lonely)).json()
      expect(body).toEqual({ items: [], total: 0 })
      const [row] = await sql<{ id: string }>("select id from base.test_items where label = 'a1'")
      expect((await send(`/test/items/${row.id}`, lonely)).status).toBe(404)
    })

    it('[rule-foundation-admin-scope-access] an administrator reads every row by default', async () => {
      expect((await (await send('/test/items', admin)).json()).total).toBe(4)
    })

    it('[rule-foundation-scope-row-filter] a hand-written aggregate applies the condition provided by the foundation', async () => {
      expect((await (await send('/test/items/aggregate', member)).json()).n).toBe(3)
      expect((await (await send('/test/items/aggregate', lonely)).json()).n).toBe(0)
      expect((await (await send('/test/items/aggregate', admin)).json()).n).toBe(4)
    })

    it('[rule-foundation-scope-row-filter] memberships are read on every request: a change applies at once, without reconnection', async () => {
      expect((await (await send('/test/items', lonely)).json()).total).toBe(0)
      const [lonelyUser] = await sql<{ id: string }>("select id from base.users where email = 'lonely@example.com'")
      await sql('insert into base.group_users (group_id, user_id) values ($1, $2)', [groupId, lonelyUser.id])
      expect((await (await send('/test/items', lonely)).json()).total).toBe(3)
      await sql('delete from base.group_scopes where group_id = $1 and scope_id = $2', [groupId, s2.id])
      expect((await (await send('/test/items', lonely)).json()).total).toBe(2)
      await sql('delete from base.group_users where user_id = $1', [lonelyUser.id])
      expect((await (await send('/test/items', lonely)).json()).total).toBe(0)
    })
  })

  describe('writes', () => {
    it('[rule-foundation-scope-row-filter] a member creates in a scope reached, and is refused (403 scopes.access_denied) elsewhere', async () => {
      expect((await send('/test/items', member, 'POST', { label: 'x', scopeCode: 's1' })).status).toBe(201)
      const refused = await send('/test/items', member, 'POST', { label: 'y', scopeCode: 's3' })
      expect(refused.status).toBe(403)
      expect((await refused.json()).code).toBe('scopes.access_denied')
      expect(await labels()).toEqual(['x'])
    })

    it('[rule-foundation-scope-row-filter] a bulk write applies the same rule: one row out of scope and nothing is written', async () => {
      const res = await send('/test/items/bulk', member, 'POST', {
        rows: [{ label: 'a', scopeCode: 's1' }, { label: 'b', scopeCode: 's3' }],
      })
      expect(res.status).toBe(403)
      expect(await labels()).toEqual([])
      expect((await send('/test/items/bulk', member, 'POST', { rows: [{ label: 'a', scopeCode: 's1' }, { label: 'b', scopeCode: 's2' }] })).status).toBe(201)
      expect(await labels()).toEqual(['a', 'b'])
    })

    it('[rule-foundation-scope-row-filter] modifying a row outside the scopes behaves as a missing row and leaves it intact', async () => {
      const outside = await seedItem('out', 's3')
      const res = await send(`/test/items/${outside.id}`, member, 'PATCH', { label: 'hacked' })
      expect(res.status).toBe(404)
      expect(await labels()).toEqual(['out'])
    })

    it('[rule-foundation-scope-row-filter] moving a row to a scope not reached is 403 scopes.access_denied and nothing changes', async () => {
      const inside = await seedItem('in', 's1')
      const moved = await send(`/test/items/${inside.id}`, member, 'PATCH', { scopeCode: 's3' })
      expect(moved.status).toBe(403)
      expect((await moved.json()).code).toBe('scopes.access_denied')
      expect((await sql('select scope_code from base.test_items'))[0].scope_code).toBe('s1')
      expect((await send(`/test/items/${inside.id}`, member, 'PATCH', { scopeCode: 's2', label: 'moved' })).status).toBe(200)
    })

    it('[rule-foundation-scope-row-filter] deletion is limited to the rows reached: unit is 404, mass deletion ignores the others', async () => {
      const inside = await seedItem('in', 's1')
      const outside = await seedItem('out', 's3')
      expect((await send(`/test/items/${outside.id}`, member, 'DELETE')).status).toBe(404)
      expect((await send(`/test/items/${inside.id}`, member, 'DELETE')).status).toBe(200)
      await seedItem('in2', 's2')
      expect((await (await send('/test/items/purge', member, 'POST')).json()).deleted).toBe(1)
      expect(await labels()).toEqual(['out'])
    })

    it('[rule-foundation-scope-row-filter] an upsert never modifies a conflicting row of a scope not reached, nor changes the scope code', async () => {
      const outside = await seedItem('out', 's3')
      const inside = await seedItem('in', 's1')
      const onOutside = await send('/test/items', member, 'PUT', { id: outside.id, label: 'taken', scopeCode: 's1' })
      expect((await onOutside.json()).written).toBe(0)
      expect(await sql('select label, scope_code from base.test_items where id = $1', [outside.id])).toEqual([{ label: 'out', scope_code: 's3' }])
      // the scope code of a row reached is not changed by the update branch either
      const onInside = await send('/test/items', member, 'PUT', { id: inside.id, label: 'renamed', scopeCode: 's2' })
      expect((await onInside.json()).written).toBe(1)
      expect(await sql('select label, scope_code from base.test_items where id = $1', [inside.id])).toEqual([{ label: 'renamed', scope_code: 's1' }])
    })

    it('[rule-foundation-user-no-group-no-data] a user without group: creation 403 scopes.access_denied, update of an existing row 404', async () => {
      const row = await seedItem('r', 's1')
      const created = await send('/test/items', lonely, 'POST', { label: 'x', scopeCode: 's1' })
      expect(created.status).toBe(403)
      expect((await created.json()).code).toBe('scopes.access_denied')
      expect((await send(`/test/items/${row.id}`, lonely, 'PATCH', { label: 'x' })).status).toBe(404)
      expect(await labels()).toEqual(['r'])
    })
  })

  describe('administrator', () => {
    it('[rule-foundation-admin-scope-access] writes in any scope by default; an unknown scope code is 400, never a foreign key error', async () => {
      expect((await send('/test/items', admin, 'POST', { label: 'x', scopeCode: 's3' })).status).toBe(201)
      const unknown = await send('/test/items', admin, 'POST', { label: 'y', scopeCode: 'nowhere' })
      expect(unknown.status).toBe(400)
      expect((await unknown.json()).code).toBe('api.validation.incoming_failed')
      const row = await seedItem('r', 's1')
      expect((await send(`/test/items/${row.id}`, admin, 'PATCH', { scopeCode: 'nowhere' })).status).toBe(400)
    })

    it('[rule-foundation-admin-scope-access] read-only: reads every row, every write is 403 scopes.read_only', async () => {
      await seedItem('a', 's1')
      await seedItem('c', 's3')
      expect((await (await send('/test/readonly-items', admin)).json()).total).toBe(2)
      const refused = await send('/test/readonly-items', admin, 'POST', { label: 'x', scopeCode: 's1' })
      expect(refused.status).toBe(403)
      expect((await refused.json()).code).toBe('scopes.read_only')
      expect(await labels()).toEqual(['a', 'c'])
    })

    it('[rule-foundation-admin-scope-access] no access: empty reads, writes 403 scopes.access_denied', async () => {
      await seedItem('a', 's1')
      expect((await (await send('/test/closed-items', admin)).json()).total).toBe(0)
      const refused = await send('/test/closed-items', admin, 'POST', { label: 'x', scopeCode: 's1' })
      expect(refused.status).toBe(403)
      expect((await refused.json()).code).toBe('scopes.access_denied')
    })

    it('[rule-foundation-admin-scope-access] the setting has no effect on ordinary users, who always follow their groups', async () => {
      await seedItem('a', 's1')
      await seedItem('c', 's3')
      expect((await (await send('/test/readonly-items', member)).json()).total).toBe(1)
      expect((await send('/test/readonly-items', member, 'POST', { label: 'x', scopeCode: 's2' })).status).toBe(201)
      expect((await (await send('/test/closed-items', member)).json()).total).toBe(2)
      expect((await send('/test/closed-items', member, 'POST', { label: 'y', scopeCode: 's1' })).status).toBe(201)
    })
  })

  describe('without identity', () => {
    it('[rule-foundation-scope-fail-closed] outside any request, reads are empty and writes are refused', async () => {
      await seedItem('a', 's1')
      expect(await repository.find(testItems)).toEqual([])
      expect(await repository.count(testItems)).toBe(0)
      await expect(repository.insert(testItems, { label: 'x', scopeCode: 's1' })).rejects.toMatchObject({ status: 403, code: 'scopes.access_denied' })
    })

    it('[rule-foundation-scope-fail-closed] a processing outside a request declares explicitly the access it runs under', async () => {
      await seedItem('a', 's1')
      await seedItem('c', 's3')
      expect(await runWithScopeAccess('full', () => repository.count(testItems))).toBe(2)
      expect(await runWithScopeAccess('read', () => repository.count(testItems))).toBe(2)
      await expect(runWithScopeAccess('read', () => repository.insert(testItems, { label: 'x', scopeCode: 's1' }))).rejects.toMatchObject({
        code: 'scopes.read_only',
      })
      expect(await runWithScopeAccess('none', () => repository.count(testItems))).toBe(0)
    })
  })

  it('[rule-foundation-scope-code-immutable] the database refuses to change or delete a scope code referenced by a row', async () => {
    await seedItem('a', 's1')
    await expect(sql("update base.scopes set code = 'renamed' where code = 's1'")).rejects.toThrow()
    await expect(sql("delete from base.scopes where code = 's1'")).rejects.toThrow()
  })
})
