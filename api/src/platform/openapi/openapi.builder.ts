import { z } from 'zod'
import { getConfig } from '../config/config'
import { CatalogRoute } from '../access/route-catalog.service'
import { CONTRACT_KEY, RouteContract, TAG_KEY } from './route-contract'

type Json = Record<string, any>

/** `/users/:id` -> `/users/{id}` */
export const toOpenApiPath = (path: string): string => path.replace(/:([A-Za-z0-9_]+)/g, '{$1}')

function convert(schema: z.ZodType, components: Json): Json {
  const converted = z.toJSONSchema(schema, {
    target: 'openapi-3.0',
    io: 'input',
    unrepresentable: 'any',
  }) as Json
  const { definitions, $schema: _ignored, ...root } = converted
  const retarget = (value: Json): Json =>
    JSON.parse(JSON.stringify(value).replaceAll('#/definitions/', '#/components/schemas/'))
  Object.assign(components, retarget(definitions ?? {}))
  return retarget(root)
}

function parametersOf(location: 'path' | 'query', schema: z.ZodObject, components: Json): Json[] {
  const object = convert(schema, components)
  const required = new Set<string>(object.required ?? [])
  return Object.entries<Json>(object.properties ?? {}).map(([name, property]) => {
    const { description, ...rest } = property
    return {
      name,
      required: location === 'path' ? true : required.has(name),
      in: location,
      ...(description ? { description } : {}),
      schema: rest,
    }
  })
}

/**
 * Builds the OpenAPI 3 document from the routes actually declared by the controllers and from their Zod schemas
 * (EXI-PLAT-15). Identical for `GET /api-json` and for `pnpm cuisine:openapi`.
 */
export function buildOpenApiDocument(routes: CatalogRoute[]): Json {
  const components: Json = {}
  const paths: Json = {}

  for (const route of routes) {
    const contract = Reflect.getMetadata(CONTRACT_KEY, route.handler) as RouteContract | undefined
    if (!contract || contract.hidden) continue
    const tag = Reflect.getMetadata(TAG_KEY, route.controllerType) as string | undefined

    const operation: Json = {
      description: contract.description ?? '',
      operationId: `${route.controller}_${route.handlerName}`,
      parameters: [
        ...(contract.params ? parametersOf('path', contract.params, components) : []),
        ...(contract.query ? parametersOf('query', contract.query, components) : []),
      ],
      responses: {},
      summary: '',
      tags: tag ? [tag] : [],
    }
    if (contract.body) {
      operation.requestBody = {
        required: true,
        content: { 'application/json': { schema: convert(contract.body, components) } },
      }
    }
    if (contract.rawBody) {
      operation.requestBody = {
        required: true,
        content: { [contract.rawBody.contentType]: { schema: contract.rawBody.schema } },
      }
    }
    for (const [status, response] of Object.entries(contract.responses)) {
      operation.responses[status] = {
        description: response.description,
        ...(response.schema
          ? // rule-foundation-response-content-type, rule-foundation-response-content-type-default
            { content: { [response.contentType ?? 'application/json']: { schema: convert(response.schema, components) } } }
          : {}),
      }
    }
    if (route.access || contract.readsSession) operation.security = [{ bearer: [] }, { cookie: [] }]

    const path = toOpenApiPath(route.path)
    paths[path] ??= {}
    paths[path][route.method.toLowerCase()] = operation
  }

  return {
    openapi: '3.0.0',
    paths,
    info: { title: `${getConfig().slug} API`, description: '', version: '1.0.0', contact: {} },
    tags: [],
    servers: [],
    components: {
      securitySchemes: {
        bearer: { scheme: 'bearer', bearerFormat: 'JWT', type: 'http' },
        cookie: { type: 'apiKey', in: 'cookie', name: `${getConfig().slug}-jwt-<host>` },
      },
      schemas: components,
    },
  }
}
