import { z } from 'zod'
import { emailSchema } from '../../platform/validation/email'

/**
 * Contract of record: the three fields of the login body are plain strings / boolean without bounds (adding a bound
 * to an existing input would be a breaking change). The e-mail validity (Q-COMPTES-02) is a refinement, which adds no
 * bound to the OpenAPI document.
 */
export const loginParamsSchema = z
  .object({
    email: emailSchema.meta({ description: 'Email of the user', example: 'john.doe@example.com' }),
    password: z.string().meta({ description: 'Password of the user', example: 'securePassword123' }),
    returnToken: z.boolean().optional().meta({
      description:
        'Whether to return the token in the response. An error will be thrown if no origin header is provided and returnToken is false',
      example: true,
    }),
  })
  .meta({ id: 'LoginWithPasswordParamsDto' })

export const loginResponseSchema = z
  .object({
    // optional: cookie mode answers `{}` (contract-changes.yaml, response-property-became-optional)
    token: z
      .string()
      .optional()
      .meta({
        description: 'JWT token for authentication. Only returned if returnToken is true',
        example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
      }),
  })
  .meta({ id: 'LoginWithPasswordResponseDto' })

export const authUserSchema = z
  .object({
    id: z.string().meta({ description: 'User ID', example: '123' }),
    email: z.string().meta({ description: 'Email of the user', example: 'john.doe@example.com' }),
    role: z.enum(['admin', 'user']).meta({ description: 'Role name the user has' }),
  })
  .meta({ id: 'AuthUserDto' })

export const currentUserResponseSchema = z
  // optional: without session the body is `{}` (contract-changes.yaml, response-property-became-optional)
  .object({ user: authUserSchema.optional().meta({ description: 'User information' }) })
  .meta({ id: 'CurrentUserResponseDTO' })

export type LoginParams = z.infer<typeof loginParamsSchema>
export type AuthUser = z.infer<typeof authUserSchema>
/** Without session the body is `{}` (`rule-foundation-protected-redirect`): `user` is then absent. */
export type CurrentUserResponse = Partial<z.infer<typeof currentUserResponseSchema>>
/** Cookie mode answers `{}`, token mode `{ token }`. */
export type LoginResponse = Partial<z.infer<typeof loginResponseSchema>>
