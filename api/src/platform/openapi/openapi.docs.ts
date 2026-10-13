import type { INestApplication } from '@nestjs/common'
import type { Request, Response } from 'express'
import { RouteCatalog } from '../access/route-catalog.service'
import { buildOpenApiDocument } from './openapi.builder'

const VIEWER_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>API</title>
    <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5.17.14/swagger-ui.css" />
  </head>
  <body>
    <div id="ui"></div>
    <script src="https://unpkg.com/swagger-ui-dist@5.17.14/swagger-ui-bundle.js"></script>
    <script>
      window.ui = SwaggerUIBundle({ url: '/api-json', dom_id: '#ui' })
    </script>
  </body>
</html>
`

/**
 * Q-PLAT-03: the OpenAPI document on `GET /api-json` and its viewer on `GET /api`, in development and test only
 * (in production nothing is mounted: both paths answer `404 api.route_not_found`). They are documentation endpoints
 * mounted on the HTTP adapter, outside the controllers: they are not business routes and not part of the contract.
 */
export function mountOpenApiDocs(app: INestApplication): void {
  const catalog = app.get(RouteCatalog)
  let document: object | undefined
  const http = app.getHttpAdapter()
  http.get('/api-json', (_req: Request, res: Response) => {
    document ??= buildOpenApiDocument(catalog.list())
    res.json(document)
  })
  http.get('/api', (_req: Request, res: Response) => {
    res.type('text/html; charset=utf-8').send(VIEWER_HTML)
  })
}
