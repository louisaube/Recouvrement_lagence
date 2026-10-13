import { defineConfig } from 'drizzle-kit'

// Migrations are generated from the Drizzle tables (`pnpm migrate:gen`) and applied with `pnpm migrate`.
export default defineConfig({
  dialect: 'postgresql',
  schema: ['./src/features/**/*.tables.ts'],
  out: './drizzle',
  schemaFilter: ['base'],
  dbCredentials: { url: process.env.DATABASE_URL ?? 'postgres://database:database@localhost:5432/monappli' },
})
