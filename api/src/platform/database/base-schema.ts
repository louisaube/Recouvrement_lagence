import { pgSchema } from 'drizzle-orm/pg-core'

/** Schéma PostgreSQL `base` : fixé par `specifications/socle/data-contract.md`. */
export const base = pgSchema('base')
