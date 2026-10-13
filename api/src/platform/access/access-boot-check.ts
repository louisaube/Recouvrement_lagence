import { Injectable, OnApplicationBootstrap } from '@nestjs/common'
import { findAuditProblems } from '../audit/audit-check'
import { CONTRACT_KEY, RESPONSE_CONTENT_TYPES, RouteContract } from '../openapi/route-contract'
import { findAccessProblems } from './access-check'
import { CatalogRoute, RouteCatalog } from './route-catalog.service'

/** rule-foundation-response-content-type-closed-list: the list is closed, also for untyped code. */
function unsupportedContentTypes(route: CatalogRoute): string[] {
  const contract = Reflect.getMetadata(CONTRACT_KEY, route.handler) as RouteContract | undefined
  const admitted: readonly string[] = RESPONSE_CONTENT_TYPES
  return Object.values(contract?.responses ?? {})
    .map((response) => response.contentType)
    .filter((type): type is NonNullable<typeof type> => type !== undefined && !admitted.includes(type))
    .map(
      (type) =>
        `Route ${route.method} ${route.path} (${route.controller}.${route.handlerName}) declares an unsupported response content type "${type}"`,
    )
}

/**
 * Q-PLAT-05: a route without access declaration prevents the server from starting; the message names the route.
 * (The routes CLI turns the check off to be able to REPORT undeclared routes instead of failing on them.)
 */
@Injectable()
export class AccessBootCheck implements OnApplicationBootstrap {
  static enabled = true

  constructor(private readonly catalog: RouteCatalog) {}

  onApplicationBootstrap(): void {
    if (!AccessBootCheck.enabled) return
    const routes = this.catalog.list()
    const problems = [
      ...findAccessProblems(routes),
      // rule-foundation-audit-declarative-route: every write route is traced or explicitly exempted
      ...findAuditProblems(routes),
      // every input and response is a Zod schema declared with @ApiRoute: a route without it would escape the
      // validation and the OpenAPI document
      ...routes
        .filter((route) => !Reflect.getMetadata(CONTRACT_KEY, route.handler))
        .map((route) => `Route ${route.method} ${route.path} (${route.controller}.${route.handlerName}) has no @ApiRoute contract`),
      ...routes.flatMap(unsupportedContentTypes),
    ]
    if (problems.length > 0) throw new Error(`Access declaration check failed:\n- ${problems.join('\n- ')}`)
  }
}
