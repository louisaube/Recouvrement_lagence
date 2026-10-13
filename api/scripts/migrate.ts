/**
 * Applies the Drizzle migrations (folder `api/drizzle`).
 *   pnpm migrate       -> to DATABASE_URL (environment, else api/.env.<NODE_ENV>)
 *   pnpm migrate:all   -> to the development and the test databases (api/.env.development, api/.env.test)
 */
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseEnv } from 'node:util'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Pool } from 'pg'

const apiDir = resolve(__dirname, '..')

function envFile(environment: string): Record<string, string | undefined> {
  const file = join(apiDir, `.env.${environment}`)
  if (!existsSync(file)) throw new Error(`${file} is missing (run: .cuisine/bin/cuisine envs)`)
  return parseEnv(readFileSync(file, 'utf8'))
}

async function applyTo(label: string, databaseUrl: string): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 })
  try {
    await migrate(drizzle(pool), { migrationsFolder: join(apiDir, 'drizzle') })
    console.log(`migrations applied (${label})`)
  } finally {
    await pool.end()
  }
}

async function main(): Promise<void> {
  if (process.argv.includes('--all')) {
    for (const environment of ['development', 'test']) {
      const url = envFile(environment).DATABASE_URL
      if (!url) throw new Error(`DATABASE_URL missing from api/.env.${environment}`)
      await applyTo(environment, url)
    }
    return
  }
  const environment = process.env.NODE_ENV ?? 'development'
  const url = process.env.DATABASE_URL ?? envFile(environment).DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set')
  await applyTo(environment, url)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
