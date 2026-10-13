import createClient, { type ClientOptions } from 'openapi-fetch'
import type { components, paths } from './schema'

export type { components, paths }

/** Typed client of the API; the types come from `src/schema.d.ts`, generated from the running API. */
export function createApiClient(options: ClientOptions = {}) {
  return createClient<paths>({ baseUrl: 'http://localhost:4000', ...options })
}

export type ApiClient = ReturnType<typeof createApiClient>
