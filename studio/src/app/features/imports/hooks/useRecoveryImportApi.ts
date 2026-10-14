import { useMemo, type MutableRefObject } from 'react'
import type { components } from '@recouvrement/api-client'
import { api } from '../../../shared/api'
import { fileBody } from '../../../shared/import/multipart'
import type { ImportApi } from '../../../shared/import/importTypes'
import { useCall } from '../../../shared/useCall'

export type RecoveryImportType = components['schemas']['RecoveryImportTypeDto']

/**
 * The calls of one recovery file type (`/recovery-imports/{type}/*`) for the generic import flow.
 * The control total is read from `controlTotal` at the time of the deposit, so the object stays stable while typing.
 */
export function useRecoveryImportApi(type: RecoveryImportType, controlTotal: MutableRefObject<string>): ImportApi {
  const call = useCall()
  return useMemo<ImportApi>(
    () => ({
      loadSpecification: () => call(() => api.GET('/recovery-imports/{type}/specification', { params: { path: { type } } })),
      preview: async (file, signal) => {
        const { bodySerializer, headers } = await fileBody(file)
        // rule-recouvrement-import-flow-reuse: the control total goes in the query string, trimmed and encoded by the client.
        const query = type === 'receivables' ? { controlTotal: controlTotal.current.trim() } : undefined
        return call(() => api.POST('/recovery-imports/{type}/preview', { params: { path: { type }, query }, body: { file: '' }, bodySerializer, headers, signal }))
      },
      errors: async (importId, from, size) => {
        const outcome = await call(() => api.GET('/recovery-imports/{type}/{importId}/errors', { params: { path: { type, importId }, query: { from, size } } }))
        return outcome.ok ? { ok: true, data: { items: outcome.data.errors, total: outcome.data.total } } : outcome
      },
      confirm: (importId) => call(() => api.POST('/recovery-imports/{type}/{importId}/confirm', { params: { path: { type, importId } } })),
    }),
    [call, type, controlTotal],
  )
}
