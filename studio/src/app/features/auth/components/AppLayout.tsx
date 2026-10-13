import { AppBar, Box, Chip, Container, IconButton, Link as MuiLink, Tab, Tabs, Toolbar, Typography } from '@mui/material'
import LogoutIcon from '@mui/icons-material/Logout'
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { roleLabel } from '../../../shared/labels'
import { useSession } from '../hooks/useSession'

const ADMIN_TABS = [
  { label: 'Utilisateurs', to: '/utilisateurs' },
  { label: 'Groupes', to: '/groupes' },
  { label: 'Périmètres', to: '/perimetres' },
  { label: 'Journal', to: '/journal' },
]

/** rule-foundation-layout-header, rule-foundation-admin-nav, rule-foundation-logout */
export function AppLayout() {
  const { state, logout } = useSession()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  if (state.status !== 'authenticated') return null
  const { user } = state

  const active = ADMIN_TABS.find((t) => pathname === t.to || pathname.startsWith(`${t.to}/`))?.to ?? false

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
          <IconButton color="inherit" aria-label="Se déconnecter" onClick={onLogout} sx={{ flexShrink: 0 }}>
            <LogoutIcon />
          </IconButton>
        </Toolbar>
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
