import { Injectable } from '@nestjs/common'
import { Pool } from 'pg'
import { InjectPool } from '../../platform/database/database.module'
import type { HealthCheckResponse } from './server.schemas'

/** The database must answer within 2 seconds (Q-PLAT-08). */
export const DATABASE_TIMEOUT_MS = 2000

@Injectable()
export class ServerService {
  constructor(@InjectPool() private readonly pool: Pool) {}

  async healthCheck(): Promise<HealthCheckResponse> {
    const started = Date.now()
    let timer: NodeJS.Timeout | undefined
    try {
      await Promise.race([
        this.pool.query('select 1'),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('database timeout')), DATABASE_TIMEOUT_MS)
        }),
      ])
      return { status: 'healthy', services: { postgres: { status: 'healthy', latency: Date.now() - started } } }
    } catch {
      return { status: 'unhealthy', services: { postgres: { status: 'unhealthy' } } }
    } finally {
      clearTimeout(timer)
    }
  }
}
