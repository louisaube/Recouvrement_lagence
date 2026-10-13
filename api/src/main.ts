import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { AppModule } from './app.module'
import { getConfig } from './platform/config/config'
import { configureApp } from './platform/http/configure-app'

async function bootstrap(): Promise<void> {
  const config = getConfig()
  // the JSON body is read by the validation interceptor, after the access guard (EXI-PLAT-11)
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
    logger: ['error', 'warn'],
  })
  configureApp(app)
  app.enableShutdownHooks()
  await app.listen(config.port)
  // an import analysis may last several minutes: no response timeout (EXI-PLAT-16)
  const server = app.getHttpServer()
  server.requestTimeout = 0
  server.timeout = 0
  console.log(JSON.stringify({ level: 'info', message: `API listening on port ${config.port}`, env: config.environment }))
}

bootstrap().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
