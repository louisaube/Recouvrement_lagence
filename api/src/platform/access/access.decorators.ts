import { SetMetadata } from '@nestjs/common'

export type Role = 'user' | 'admin'
export type AdminScopeAccess = 'full' | 'read' | 'none'

export const PUBLIC_KEY = 'platform:access:public'
export const ACCESS_KEY = 'platform:access:authenticated'

export interface AccessDeclaration {
  /** `<feature>:<verb>`, unique, stable, in English, 1 to 100 characters. */
  action: string
  /**
   * Roles admitted. An administrator is admitted wherever `user` is, so `['user']` admits both.
   * `[]` (rule-foundation-access-guard-only-route): the platform admits no role of the foundation, a business guard
   * decides; at least one `@UseGuards` is required (the server refuses to start otherwise).
   */
  roles: Role[]
  /** Access of an administrator to the scopes on this route (default `full`). */
  adminScopes?: AdminScopeAccess
  /**
   * An ordinary user is admitted only on their own resources (a business guard enforces it): `cuisine:routes`
   * then lists only `admin` in `allow`, the access on any identifier.
   */
  ownerOnly?: boolean
}

/**
 * Access regime "public": no token needed (login, logout, current-user, health-check).
 * A route carries exactly one of `@Public()` or `@Access(...)`; a route with none is never served
 * (EXI-PLAT-11) and the server refuses to start (Q-PLAT-05).
 */
export const Public = (): MethodDecorator => SetMetadata(PUBLIC_KEY, true)

/** Access regime "authenticated": token or session cookie, role check before any validation or body reading. */
export const Access = (declaration: AccessDeclaration): MethodDecorator => SetMetadata(ACCESS_KEY, declaration)

/** Roles that may call a route declared with `declared` roles (an admin is admitted wherever a user is). */
export function admittedRoles(declared: Role[]): Role[] {
  return declared.includes('user') ? ['user', 'admin'] : [...declared]
}
