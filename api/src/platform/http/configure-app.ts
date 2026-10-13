import type { NestExpressApplication } from '@nestjs/platform-express'
import { currentEnvironment } from '../config/config'
import { mountOpenApiDocs } from '../openapi/openapi.docs'
import { corsMiddleware } from './cors.middleware'
import { ApiExceptionFilter } from './exception.filter'
import { requestIdMiddleware } from './request-id.middleware'

/** Everything the HTTP layer needs besides the modules: request id, CORS, error format, documentation routes. */
export function configureApp(app: NestExpressApplication): void {
  app.disable('x-powered-by')
  app.use(requestIdMiddleware)
  app.use(corsMiddleware)
  app.useGlobalFilters(new ApiExceptionFilter())
  if (currentEnvironment() !== 'production') mountOpenApiDocs(app)
}
