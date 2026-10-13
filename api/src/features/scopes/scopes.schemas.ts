import { z } from 'zod'
import { idParamsSchema, paginationQuerySchema, trimmedName, uuidFormat } from '../../platform/validation/common'

/** rule-foundation-scope-code-format: 1 to 50 characters, lowercase letters, digits, `_` and `-`, no leading separator. */
const scopeCodeSchema = z
  .string()
  .min(1)
  .max(50)
  .regex(/^[a-z0-9][a-z0-9_-]{0,49}$/)

export const scopeIdParamsSchema = idParamsSchema
export const scopesListQuerySchema = paginationQuerySchema

/** ScopeDto (40-groupes-perimetres.md §1) */
export const scopeSchema = z
  .object({
    id: uuidFormat().meta({ description: 'Scope ID' }),
    code: scopeCodeSchema.meta({ description: 'Unique, immutable code business tables refer to', example: 'creche-1' }),
    name: z.string().min(1).max(100).meta({ description: 'Display name', example: 'Crèche du Parc' }),
  })
  .meta({ id: 'ScopeDto' })

export const scopesListResponseSchema = z
  .object({
    scopes: z.array(scopeSchema),
    total: z.number().meta({ description: 'Total number of scopes', example: 3 }),
  })
  .meta({ id: 'ScopesListResponseDto' })

/** rule-foundation-scope-definition, rule-foundation-scope-code-format */
export const createScopeBodySchema = z
  .object({
    code: scopeCodeSchema.meta({
      description:
        'Code of the scope (rule-foundation-scope-code-format): lowercase letters, digits, "_" and "-", not starting with a separator',
      example: 'creche-1',
    }),
    name: trimmedName().meta({ description: 'Display name, trimmed, not empty', example: 'Crèche du Parc' }),
  })
  .meta({ id: 'ScopesCreateParamsDto' })

export const createScopeResponseSchema = z.object({ scope: scopeSchema }).meta({ id: 'ScopesCreateResponseDto' })

/** rule-foundation-scope-code-immutable: only the name; any other key is refused (strict object). */
export const updateScopeBodySchema = z
  .strictObject({
    name: trimmedName().meta({ description: 'New display name, trimmed, not empty', example: 'Crèche du Parc' }),
  })
  // the contract of record declares no `additionalProperties` on the body: the refusal of unknown keys is applied, not published
  .meta({ id: 'ScopesUpdateParamsDto', additionalProperties: undefined })

export const updateScopeResponseSchema = z.object({ scope: scopeSchema }).meta({ id: 'ScopesUpdateResponseDto' })

export type ScopeDto = z.infer<typeof scopeSchema>
export type ScopesListQuery = z.infer<typeof scopesListQuerySchema>
export type CreateScopeBody = z.infer<typeof createScopeBodySchema>
export type UpdateScopeBody = z.infer<typeof updateScopeBodySchema>
