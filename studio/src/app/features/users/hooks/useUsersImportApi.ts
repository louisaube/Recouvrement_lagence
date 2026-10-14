import { useMemo } from 'react'
import { api } from '../../../shared/api'
import { fileBody } from '../../../shared/import/multipart'
import type { ImportApi } from '../../../shared/import/importTypes'
import { useCall } from '../../../shared/useCall'

/** The accounts import calls (`/users/imports/*`) for the generic import flow. */
export function useUsersImportApi(): ImportApi {
  const call = useCall()
  return useMemo<ImportApi>(
    () => ({
      loadSpecification: () => call(() => api.GET('/users/imports/specification')),
      preview: async (file, signal) => {
        const { bodySerializer, headers } = await fileBody(file)
        return call(() => api.POST('/users/imports/preview', { body: { file: '' }, bodySerializer, headers, signal }))
      },
      errors: async (importId, from, size) => {
        const outcome = await call(() => api.GET('/users/imports/{importId}/errors', { params: { path: { importId }, query: { from, size } } }))
        return outcome.ok ? { ok: true, data: { items: outcome.data.errors, total: outcome.data.total } } : outcome
      },
      confirm: (importId) => call(() => api.POST('/users/imports/{importId}/confirm', { params: { path: { importId } } })),
    }),
    [call],
  )
}
