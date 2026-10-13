/**
 * Proof of `rule-foundation-import-respects-scopes` with a fictitious feature: an import whose rows are attached to
 * scopes (`scoped: true`) is refused before any analysis when the caller cannot write to scopes. The test builds its own
 * table (outside the data contract, dropped at the end) and test-only routes, hidden from the contract.
 */
import 'reflect-metadata'
import { Controller, HttpCode, Injectable, Module, Post, Req } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { sql as dsql } from 'drizzle-orm'
import { readdir } from 'node:fs/promises'
import { Access } from '../../../platform/access/access.decorators'
import { AuditExempt } from '../../../platform/audit/audit.decorators'
import { configureApp } from '../../../platform/http/configure-app'
import type { ApiRequest } from '../../../platform/http/request-context'
import { ApiRoute } from '../../../platform/openapi/route-contract'
import { PlatformModule } from '../../../platform/platform.module'
import { ValidParams } from '../../../platform/validation/zod-validation.interceptor'
import { ApiResponse, closePool, createUser, login, resetData, sql } from '../../../platform/testing/helpers'
import { ImportParams, importParamsSchema, MULTIPART_FILE_BODY } from '../imports.schemas'
import { ImportsModule } from '../imports.module'
import { ImportsService } from '../imports.service'
import type { ImportDefinition } from '../imports.types'
import { IMPORT_TEMP_DIR } from '../receive'
import { csv } from './files'

const hidden = { hidden: true } as const
const ok = { 200: { description: 'ok' } }

@Injectable()
class ItemsImportDefinition implements ImportDefinition {
  feature = 'test-items'
  scoped = true
  columns: ImportDefinition['columns'] = [
    {
      name: 'label',
      required: true,
      description: 'Libellé',
      parse: (cell) => (cell === null ? { ok: false, reason: 'Libellé obligatoire.' } : { ok: true, value: cell }),
    },
  ]
  async saveBatch(rows: Parameters<ImportDefinition['saveBatch']>[0], tx: Parameters<ImportDefinition['saveBatch']>[1]) {
    for (const row of rows) await tx.execute(sqlText(String(row.data.label)))
    return { created: rows.length, skipped: 0 }
  }
}
// one statement per row, the label being passed as a parameter
const sqlText = (label: string) => dsql`insert into base.test_import_items (label) values (${label})`

/** The same import on three routes: writable by the caller's scopes, read-only for an administrator, closed to one. */
const makeController = (path: string, extra: { adminScopes?: 'read' | 'none' }, prefix: string) => {
  @Controller(path)
  class TestImportController {
    constructor(
      private readonly imports: ImportsService,
      private readonly definition: ItemsImportDefinition,
    ) {}

    @Post('preview')
    @HttpCode(200)
    @Access({ action: `${prefix}:preview`, roles: ['user'], ...extra })
    @AuditExempt('test route')
    @ApiRoute({ ...hidden, rawBody: { contentType: 'multipart/form-data', schema: MULTIPART_FILE_BODY }, responses: ok })
    preview(@Req() req: ApiRequest) {
      return this.imports.preview(this.definition, req)
    }

    @Post(':importId/confirm')
    @HttpCode(200)
    @Access({ action: `${prefix}:confirm`, roles: ['user'], ...extra })
    @AuditExempt('test route')
    @ApiRoute({ ...hidden, params: importParamsSchema, responses: ok })
    confirm(@ValidParams() params: ImportParams, @Req() req: ApiRequest) {
      return this.imports.confirm(this.definition, params.importId, req.user!)
    }
  }
  return TestImportController
}

const Open = makeController('test/items-import', {}, 'items-import')
const ReadOnly = makeController('test/readonly-import', { adminScopes: 'read' }, 'readonly-import')
const Closed = makeController('test/closed-import', { adminScopes: 'none' }, 'closed-import')

@Module({ imports: [PlatformModule, ImportsModule], controllers: [Open, ReadOnly, Closed], providers: [ItemsImportDefinition] })
class ItemsImportTestModule {}

describe('import of rows attached to scopes', () => {
  let app: NestExpressApplication
  let url: string
  let admin: string
  let member: string

  const upload = (path: string, token: string, content: Buffer = csv([['label'], ['un'], ['deux']])) => {
    const form = new FormData()
    form.append('file', new Blob([new Uint8Array(content)]), 'items.csv')
    return fetch(`${url}${path}/preview`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form }) as Promise<ApiResponse>
  }
  const confirm = (path: string, token: string, id: string) =>
    fetch(`${url}${path}/${id}/confirm`, { method: 'POST', headers: { authorization: `Bearer ${token}` } })
  const previews = async () => (await sql('select 1 from base.import_previews')).length
  const temp = () => readdir(IMPORT_TEMP_DIR).catch(() => [] as string[])

  beforeAll(async () => {
    await sql('drop table if exists base.test_import_items')
    await sql('create table base.test_import_items (id serial primary key, label text not null)')
    app = await NestFactory.create<NestExpressApplication>(ItemsImportTestModule, { bodyParser: false, logger: false })
    configureApp(app)
    await app.listen(0)
    url = (await app.getUrl()).replace('[::1]', 'localhost')
  })
  afterAll(async () => {
    await app.close()
    await sql('drop table if exists base.test_import_items')
    await closePool()
  })
  beforeEach(async () => {
    await resetData()
    await sql('truncate base.test_import_items')
    await createUser({ email: 'admin@example.com', role: 'admin' })
    await createUser({ email: 'member@example.com' })
    admin = await login('admin@example.com')
    member = await login('member@example.com')
  })

  it('[rule-foundation-import-respects-scopes] a caller who can write to scopes previews and confirms', async () => {
    for (const token of [admin, member]) {
      await sql('truncate base.import_previews cascade')
      const res = await upload('/test/items-import', token, csv([['label'], [`un-${token.slice(-6)}`]]))
      expect(res.status).toBe(200)
      const { importId } = await res.json()
      expect((await confirm('/test/items-import', token, importId)).status).toBe(200)
    }
    expect((await sql('select 1 from base.test_import_items')).length).toBe(2)
  })

  it('[rule-foundation-import-respects-scopes] an administrator with read-only access to scopes is refused before any analysis', async () => {
    const res = await upload('/test/readonly-import', admin)
    expect(res.status).toBe(403)
    expect(await previews()).toBe(0)
    expect(await temp()).toEqual([])
    // a user is not an administrator: the restriction does not apply to them
    expect((await upload('/test/readonly-import', member)).status).toBe(200)
  })

  it('[rule-foundation-import-respects-scopes] an administrator with no access to scopes is refused, on the preview and on the confirmation', async () => {
    expect((await upload('/test/closed-import', admin)).status).toBe(403)
    expect(await previews()).toBe(0)
    const { importId } = await (await upload('/test/closed-import', member)).json()
    expect((await confirm('/test/closed-import', admin, importId)).status).toBe(403)
    expect((await sql('select 1 from base.test_import_items')).length).toBe(0)
  })
})
