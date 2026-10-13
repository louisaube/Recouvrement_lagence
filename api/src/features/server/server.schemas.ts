import { z } from 'zod'

/** rule-platform: Q-PLAT-08 - only the database is monitored. */
const serviceStatusSchema = z.object({
  status: z.enum(['healthy', 'unhealthy']).meta({ description: 'Status of the service' }),
  latency: z.number().min(0).optional().meta({ description: 'Round-trip time of the probe, in milliseconds' }),
})

export const healthCheckResponseSchema = z
  .object({
    status: z.enum(['healthy', 'unhealthy']).meta({ description: 'The overall status of the system' }),
    services: z
      .object({ postgres: serviceStatusSchema })
      .meta({ description: 'Status of individual services' }),
  })
  .meta({ id: 'HealthCheckResponseDto' })

export type HealthCheckResponse = z.infer<typeof healthCheckResponseSchema>
