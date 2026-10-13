import { createApiClient } from '@recouvrement/api-client'

/** Typed API client; the session cookie is sent with every request. */
export const api = createApiClient({
  baseUrl: import.meta.env.VITE_API_URL ?? 'http://localhost:4000',
  credentials: 'include',
})
