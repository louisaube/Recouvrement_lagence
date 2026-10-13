import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { parseEnv } from 'node:util'
import { z } from 'zod'

/** Environnements connus ; `production` ferme le document OpenAPI et les routes de test. */
export type AppEnvironment = 'development' | 'test' | 'production'

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(8),
  COOKIE_SECRET: z.string().min(8),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  STUDIO_ORIGINS: z.string().default('http://localhost:5173'),
})

export interface AppConfig {
  environment: AppEnvironment
  /** Slug de l'application (nom du paquet racine) : préfixe du cookie de session. */
  slug: string
  databaseUrl: string
  jwtSecret: string
  cookieSecret: string
  port: number
  studioOrigins: string[]
}

export const API_DIR = resolve(__dirname, '..', '..', '..')

export function currentEnvironment(): AppEnvironment {
  const value = process.env.NODE_ENV
  return value === 'production' || value === 'test' ? value : 'development'
}

/** Charge `api/.env.<NODE_ENV>` sans écraser les variables déjà présentes. */
export function loadEnvironmentFile(environment: AppEnvironment = currentEnvironment()): void {
  const file = join(API_DIR, `.env.${environment}`)
  if (!existsSync(file)) return
  for (const [key, value] of Object.entries(parseEnv(readFileSync(file, 'utf8')))) {
    if (process.env[key] === undefined && value !== undefined) process.env[key] = value
  }
}

/** Le slug est le `name` du `package.json` racine du dépôt (lowercase letters and digits). */
export function readSlug(): string {
  let dir = API_DIR
  for (let i = 0; i < 4; i++) {
    const file = join(dir, 'pnpm-workspace.yaml')
    if (existsSync(file)) {
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { name?: string }
      if (pkg.name) return pkg.name
    }
    dir = dirname(dir)
  }
  return 'recouvrement'
}

let cached: AppConfig | undefined

export function getConfig(): AppConfig {
  if (cached) return cached
  const environment = currentEnvironment()
  loadEnvironmentFile(environment)
  const parsed = envSchema.safeParse(process.env)
  if (!parsed.success) {
    const names = [...new Set(parsed.error.issues.map((issue) => issue.path.join('.')))].join(', ')
    throw new Error(`Invalid environment configuration (api/.env.${environment}): ${names}`)
  }
  const env = parsed.data
  cached = {
    environment,
    slug: readSlug(),
    databaseUrl: env.DATABASE_URL,
    jwtSecret: env.JWT_SECRET,
    cookieSecret: env.COOKIE_SECRET,
    port: env.PORT,
    studioOrigins: env.STUDIO_ORIGINS.split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  }
  return cached
}
