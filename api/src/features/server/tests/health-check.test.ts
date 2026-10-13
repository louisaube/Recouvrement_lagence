import type { Pool } from 'pg'
import { call, client } from '../../../platform/testing/helpers'
import { ServerService } from '../server.service'

describe('GET /server/health-check', () => {
  it('[EXI-PLAT-14][Q-PLAT-08] answers 200 healthy with the latency of the database, without any token', async () => {
    const { data, response } = await client().GET('/server/health-check')
    expect(response.status).toBe(200)
    expect(data?.status).toBe('healthy')
    expect(data?.services.postgres.status).toBe('healthy')
    expect(data?.services.postgres.latency).toBeGreaterThanOrEqual(0)
  })

  it('[EXI-PLAT-14] exposes no connection string or secret', async () => {
    const text = await (await call('/server/health-check')).text()
    expect(text).not.toMatch(/postgres:\/\/|password|secret/i)
  })

  it('[EXI-PLAT-14][Q-PLAT-08] a database that fails is reported unhealthy, without the cause', async () => {
    const failing = { query: () => Promise.reject(new Error('connect ECONNREFUSED postgres://database:database@db')) }
    const result = await new ServerService(failing as unknown as Pool).healthCheck()
    expect(result).toEqual({ status: 'unhealthy', services: { postgres: { status: 'unhealthy' } } })
  })

  it('[Q-PLAT-02][EXI-PLAT-05] carries a server generated X-Request-Id, a client supplied one is ignored', async () => {
    const mine = '11111111-1111-4111-8111-111111111111'
    const first = await call('/server/health-check', { headers: { 'x-request-id': mine } })
    const second = await call('/server/health-check')
    const id = first.headers.get('x-request-id')
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(id).not.toBe(mine)
    expect(second.headers.get('x-request-id')).not.toBe(id)
  })
})
