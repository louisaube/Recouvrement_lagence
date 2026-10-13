/** `pnpm --dir api cuisine:openapi <out.json>`: the OpenAPI document, identical to `GET /api-json`, without a server. */
import { buildOpenApiDocument } from '../openapi/openapi.builder'
import { outputPath, withRouteCatalog, writeJson } from './catalog-context'

withRouteCatalog((routes) => buildOpenApiDocument(routes))
  .then((document) => writeJson(outputPath(), document))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
