import { Outlet } from 'react-router-dom'
import { useSession } from '../hooks/useSession'
import { AccessDenied } from './AccessDenied'

/**
 * rule-foundation-admin-screens-guard: an ordinary user sees « Accès refusé » in the common layout,
 * at the same address, and no administration route is called. A convenience: security rests on the API.
 */
export function RequireAdmin() {
  const { state } = useSession()
  if (state.status !== 'authenticated') return null
  if (state.user.role === 'admin') return <Outlet />
  return <AccessDenied />
}
