import { AppBar, Box, Chip, Container, IconButton, Link as MuiLink, Tab, Tabs, Toolbar, Typography } from '@mui/material'
import LogoutIcon from '@mui/icons-material/Logout'
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { roleLabel } from '../../../shared/labels'
import { profileWithChannelLabel } from '../../../shared/recouvrementLabels'
import { useProfile, type Profile } from '../../profiles/hooks/useProfile'
import { useSession } from '../hooks/useSession'

const ADMIN_TABS = [
  { label: 'Utilisateurs', to: '/utilisateurs' },
  { label: 'Groupes', to: '/groupes' },
  { label: 'Périmètres', to: '/perimetres' },
  { label: 'Journal', to: '/journal' },
]

type Tab = { label: string; to: string }

const SUPERVISOR_TABS: Tab[] = [
  { label: 'Imports', to: '/imports' },
  { label: 'Politique', to: '/politique' },
  { label: 'Lot du jour', to: '/lot-du-jour' },
  { label: 'Sorties comptables', to: '/sorties-comptables' },
  { label: 'File de décisions', to: '/file-de-decisions' },
  { label: 'Dossiers', to: '/dossiers' },
  { label: 'Relecture', to: '/relecture' },
  { label: 'Indicateurs', to: '/indicateurs' },
  { label: 'Journal', to: '/journal' },
]

/** rule-recouvrement-nav-by-profile: only the screens of the profile; an agent or a profile-less account has none. */
function tabsOf(profile: Profile | null): Tab[] {
  if (profile === 'supervisor') return SUPERVISOR_TABS
  if (profile === 'litigation') return [{ label: 'Litiges', to: '/litiges' }]
  if (profile === 'indicators') return [{ label: 'Indicateurs', to: '/indicateurs' }]
  return []
}

/** rule-foundation-layout-header, rule-foundation-admin-nav, rule-foundation-logout */
export function AppLayout() {
  const { state, logout } = useSession()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const { profile, channel } = useProfile()
  if (state.status !== 'authenticated') return null
  const { user } = state

  const active = ADMIN_TABS.find((t) => pathname === t.to || pathname.startsWith(`${t.to}/`))?.to ?? false

  const recoveryTabs = tabsOf(profile)
  const recoveryActive = recoveryTabs.find((t) => pathname === t.to || pathname.startsWith(`${t.to}/`))?.to ?? false

  const onLogout = async () => {
    // state reset and navigation happen in the same batch: no detour through ?redirection=
    await logout(() => navigate('/connexion', { replace: true }))
  }

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'grey.100' }}>
      <AppBar position="static" component="header">
        <Toolbar sx={{ gap: 1.5 }}>
          <MuiLink component={Link} to="/" color="inherit" underline="none" variant="h6" sx={{ flexShrink: 0, flexGrow: 1 }}>
            Recouvrement
          </MuiLink>
          <Typography noWrap sx={{ minWidth: 0, flexShrink: 1 }} title={user.email}>
            {user.email}
          </Typography>
          <Chip label={roleLabel(user.role)} size="small" sx={{ flexShrink: 0, bgcolor: 'rgba(255,255,255,0.2)', color: 'inherit' }} />
          {profile && <Chip label={profileWithChannelLabel(profile, channel)} size="small" sx={{ flexShrink: 0, bgcolor: 'rgba(255,255,255,0.2)', color: 'inherit' }} />}
          <IconButton color="inherit" aria-label="Se déconnecter" onClick={onLogout} sx={{ flexShrink: 0 }}>
            <LogoutIcon />
          </IconButton>
        </Toolbar>
        {recoveryTabs.length > 0 && (
          <Box component="nav" aria-label="Recouvrement" sx={{ bgcolor: 'primary.main', borderTop: '1px solid rgba(255,255,255,0.2)' }}>
            <Tabs value={recoveryActive} variant="scrollable" scrollButtons={false} textColor="inherit" indicatorColor="secondary">
              {recoveryTabs.map((t) => (
                <Tab key={t.to} label={t.label} value={t.to} component={Link} to={t.to} role="link" aria-current={recoveryActive === t.to ? 'page' : undefined} />
              ))}
            </Tabs>
          </Box>
        )}
        {user.role === 'admin' && (
          <Box component="nav" aria-label="Administration" sx={{ bgcolor: 'primary.dark' }}>
            <Tabs value={active} variant="scrollable" scrollButtons={false} textColor="inherit" indicatorColor="secondary">
              {ADMIN_TABS.map((t) => (
                <Tab key={t.to} label={t.label} value={t.to} component={Link} to={t.to} role="link" aria-current={active === t.to ? 'page' : undefined} />
              ))}
            </Tabs>
          </Box>
        )}
      </AppBar>
      <Container component="main" maxWidth={false} sx={{ maxWidth: 1200, py: 3 }}>
        <Outlet />
      </Container>
    </Box>
  )
}
