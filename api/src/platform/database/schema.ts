/**
 * Every Drizzle table of the schema `base` (data contract). The migration generator reads this file;
 * a business feature never adds tables here: it declares its own `*.tables.ts` and lists it in
 * `drizzle.config.ts`.
 */
export * from '../../features/users/users.tables'
export * from '../../features/scopes/scopes.tables'
export * from '../../features/groups/groups.tables'
export * from '../../features/audit/audit.tables'
export * from '../../features/imports/imports.tables'
