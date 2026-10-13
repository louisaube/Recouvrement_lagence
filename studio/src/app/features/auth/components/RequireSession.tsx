import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { FullScreenLoading } from '../../../shared/FullScreenLoading'
import { useSession } from '../hooks/useSession'

/** rule-foundation-protected-redirect / rule-foundation-no-protected-flash */
export function RequireSession() {
  const { state } = useSession()
  const location = useLocation()
  if (state.status === 'loading') return <FullScreenLoading />
  if (state.status === 'anonymous') {
    const target = encodeURIComponent(location.pathname + location.search + location.hash)
    return <Navigate to={`/connexion?redirection=${target}`} replace />
  }
  return <Outlet />
}
