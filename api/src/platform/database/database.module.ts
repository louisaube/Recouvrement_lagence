import { Global, Inject, Injectable, Module, OnApplicationShutdown } from '@nestjs/common'
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { getConfig } from '../config/config'
import * as schema from './schema'
import { transactionAware } from './transaction-context'

export const PG_POOL = Symbol('PG_POOL')
export const DB = Symbol('DB')

export type Database = NodePgDatabase<typeof schema>
export const InjectDb = (): ParameterDecorator => Inject(DB)
export const InjectPool = (): ParameterDecorator => Inject(PG_POOL)

@Injectable()
class PoolShutdown implements OnApplicationShutdown {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end()
  }
}

/** One shared connection pool (connects lazily: building the OpenAPI document needs no database). */
@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      useFactory: () => {
        const pool = new Pool({ connectionString: getConfig().databaseUrl, max: 10 })
        // an idle client failing must not crash the process
        pool.on('error', (error) => console.error(JSON.stringify({ level: 'error', error: error.message })))
        return pool
      },
    },
    {
      provide: DB,
      inject: [PG_POOL],
      useFactory: (pool: Pool): Database => transactionAware(drizzle(pool, { schema })),
    },
    PoolShutdown,
  ],
  exports: [PG_POOL, DB],
})
export class DatabaseModule {}
