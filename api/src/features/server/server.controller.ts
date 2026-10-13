import { Controller, Get, Res } from '@nestjs/common'
import type { Response } from 'express'
import { Public } from '../../platform/access/access.decorators'
import { ApiRoute, ApiTag } from '../../platform/openapi/route-contract'
import { healthCheckResponseSchema, HealthCheckResponse } from './server.schemas'
import { ServerService } from './server.service'

@Controller('server')
@ApiTag('Server')
export class ServerController {
  constructor(private readonly service: ServerService) {}

  /** EXI-PLAT-14: public, never traced. 200 when the database answers, 503 `unhealthy` otherwise. */
  @Get('health-check')
  @Public()
  @ApiRoute({
    description: 'Health check',
    responses: {
      200: { description: 'All services are healthy', schema: healthCheckResponseSchema },
      503: { description: 'One or more services are unhealthy' },
    },
  })
  async healthCheck(@Res({ passthrough: true }) res: Response): Promise<HealthCheckResponse> {
    const result = await this.service.healthCheck()
    if (result.status === 'unhealthy') res.status(503)
    return result
  }
}
