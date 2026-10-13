import { Box, Button, Typography } from '@mui/material'
import { Outlet, useNavigate } from 'react-router-dom'
import { useSession } from '../hooks/useSession'

/**
 * rule-foundation-admin-screens-guard: an ordinary user sees « Accès refusé » in the common layout,
 * at the same address, and no administration route is called. A convenience: security rests on the API.
 */
export function RequireAdmin() {
  const { state } = useSession()
  const navigate = useNavigate()
  if (state.status !== 'authenticated') return null
  if (state.user.role === 'admin') return <Outlet />
  return (
    <Box sx={{ textAlign: 'center', py: 8 }}>
      <Typography variant="h4" component="h1" gutterBottom>
        Accès refusé
      </Typography>
      <Typography color="text.secondary" sx={{ mb: 3 }}>
        Vous n'avez pas les droits nécessaires pour consulter cette page.
      </Typography>
      <Button onClick={() => navigate('/')} variant="contained">
        Retour à l'accueil
      </Button>
    </Box>
  )
}
