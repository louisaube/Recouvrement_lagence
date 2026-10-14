import { Outlet } from 'react-router-dom'
import { AccessDenied } from '../../auth/components/AccessDenied'
import { useSession } from '../../auth/hooks/useSession'
import { useProfile, type Profile } from '../hooks/useProfile'

interface Props {
  profiles: Profile[]
  /** The administrator is admitted too (the Journal screen). */
  admin?: boolean
}

/**
 * rule-recouvrement-screen-guard: a recovery screen opened by a profile that has no right to it shows « Accès refusé »
 * at the same address and calls no route. A convenience: the server refuses every route (rule-recouvrement-profile-server-enforced).
 */
export function RequireProfile({ profiles, admin = false }: Props) {
  const { state } = useSession()
  const { profile } = useProfile()
  if (state.status !== 'authenticated') return null
  if ((admin && state.user.role === 'admin') || (profile !== null && profiles.includes(profile))) return <Outlet />
  return <AccessDenied />
}
