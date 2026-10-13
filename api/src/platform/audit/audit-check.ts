import { CONTRACT_KEY, RouteContract } from '../openapi/route-contract'
import { CatalogRoute } from '../access/route-catalog.service'
import { AUDIT_EXEMPT_KEY, AUDIT_KEY } from './audit.decorators'

const WRITE_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE']

const label = (route: CatalogRoute): string => `${route.method} ${route.path} (${route.controller}.${route.handlerName})`

/**
 * `rule-foundation-audit-declarative-route`: every write route is traced (`@Audited`) or explicitly exempted with a
 * reason (`@AuditExempt`); a traced route is authenticated; a route is never both. Routes hidden from the contract
 * (test routes) are exempt by nature. One message per problem, naming the route.
 */
export function findAuditProblems(routes: CatalogRoute[]): string[] {
  const problems: string[] = []
  for (const route of routes) {
    const contract = Reflect.getMetadata(CONTRACT_KEY, route.handler) as RouteContract | undefined
    const traced = Reflect.getMetadata(AUDIT_KEY, route.handler) !== undefined
    const reason = Reflect.getMetadata(AUDIT_EXEMPT_KEY, route.handler) as string | undefined
    if (traced && reason !== undefined) problems.push(`Route ${label(route)} is both traced and exempted from the audit`)
    if (traced && !route.access) problems.push(`Route ${label(route)} is traced but has no authenticated access regime`)
    if (reason !== undefined && reason.trim() === '') problems.push(`Route ${label(route)} is exempted from the audit without a reason`)
    if (WRITE_METHODS.includes(route.method) && !traced && reason === undefined && !contract?.hidden) {
      problems.push(`Write route ${label(route)} is neither traced (@Audited) nor exempted (@AuditExempt)`)
    }
  }
  return problems
}
