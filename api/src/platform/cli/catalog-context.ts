import 'reflect-metadata'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { NestFactory } from '@nestjs/core'
import { loadEnvironmentFile } from '../config/config'
import type { CatalogRoute, RouteCatalog } from '../access/route-catalog.service'

/**
 * Builds the application without listening and without reaching the database, to read its routes.
 * Variables missing from the environment get inert placeholders: nothing here opens a connection.
 */
export async function withRouteCatalog<T>(use: (routes: CatalogRoute[], catalog: RouteCatalog) => T): Promise<T> {
  loadEnvironmentFile()
  process.env.DATABASE_URL ??= 'postgres://database:database@localhost:5432/unused'
  process.env.JWT_SECRET ??= 'placeholder-secret'
  process.env.COOKIE_SECRET ??= 'placeholder-secret'
  const { AppModule } = await import('../../app.module')
  const { AccessBootCheck } = await import('../access/access-boot-check')
  const { RouteCatalog: Catalog } = await import('../access/route-catalog.service')
  // the CLIs REPORT an undeclared route (regime `undecorated`) instead of failing on it
  AccessBootCheck.enabled = false
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false })
  try {
    const catalog = app.get(Catalog)
    return use(catalog.list(), catalog)
  } finally {
    await app.close()
  }
}

/** Output path given as argument; a relative path is resolved from the directory `pnpm` was started in. */
export function outputPath(): string {
  const target = process.argv[2]
  if (!target) {
    console.error('Usage: <command> <out.json>')
    process.exit(2)
  }
  return resolve(process.env.INIT_CWD ?? process.cwd(), target)
}

export function writeJson(file: string, value: unknown): void {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`)
}
