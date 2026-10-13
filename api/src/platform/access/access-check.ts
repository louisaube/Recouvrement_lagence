import { admittedRoles } from './access.decorators'
import { CatalogRoute } from './route-catalog.service'

export type Regime = 'public' | 'auth' | 'auth+custom' | 'undecorated' | 'conflict'

const ACTION_PATTERN = /^[a-z][a-z0-9-]*:[a-z][a-z0-9-]*$/

export function regimeOf(route: CatalogRoute): Regime {
  if (route.public && route.access) return 'conflict'
  if (route.public) return 'public'
  if (route.access) return route.customGuards.length > 0 ? 'auth+custom' : 'auth'
  return 'undecorated'
}

/** One entry of the `cuisine:routes` report. */
export function describeRoute(route: CatalogRoute) {
  const regime = regimeOf(route)
  const allow =
    regime === 'public'
      ? ['anonymous', 'user', 'admin']
      : route.access && regime !== 'conflict'
        ? admittedRoles(route.access.roles).filter((role) => !(route.access?.ownerOnly && role === 'user'))
        : []
  return {
    method: route.method,
    path: route.path,
    regime,
    allow,
    action: route.access?.action ?? null,
    customGuards: route.customGuards,
  }
}

const label = (route: CatalogRoute): string =>
  `${route.method} ${route.path} (${route.controller}.${route.handlerName})`

/**
 * Q-PLAT-05 / EXI-PLAT-11: every route declares its access explicitly. Returns one message per problem
 * (route without declaration, both regimes, malformed or duplicated action code, no role and no business guard,
 * `ownerOnly` without role).
 */
export function findAccessProblems(routes: CatalogRoute[]): string[] {
  const problems: string[] = []
  const owners = new Map<string, CatalogRoute>()
  for (const route of routes) {
    const regime = regimeOf(route)
    if (regime === 'undecorated') problems.push(`Route ${label(route)} has no access declaration`)
    if (regime === 'conflict') problems.push(`Route ${label(route)} is declared both public and authenticated`)
    const access = route.access
    if (!access) continue
    if (access.action.length < 1 || access.action.length > 100 || !ACTION_PATTERN.test(access.action)) {
      problems.push(`Route ${label(route)} has an invalid action code "${access.action}" (expected <feature>:<verb>)`)
    }
    if (access.roles.length === 0) {
      // rule-foundation-access-no-role-without-guard-refused: a route reserved to a business guard needs that guard
      if (route.customGuards.length === 0) problems.push(`Route ${label(route)} admits no role and no business guard`)
      // rule-foundation-access-owner-only-needs-role: ownerOnly narrows the user role, which roles: [] does not admit
      if (access.ownerOnly) problems.push(`Route ${label(route)} declares ownerOnly with roles: [] (ownerOnly narrows the user role)`)
    }
    const previous = owners.get(access.action)
    if (previous) {
      problems.push(`Route ${label(route)} reuses the action code "${access.action}" of ${label(previous)}`)
    } else {
      owners.set(access.action, route)
    }
  }
  return problems
}
