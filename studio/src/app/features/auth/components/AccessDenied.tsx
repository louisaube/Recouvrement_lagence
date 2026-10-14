import { Box, Button, Typography } from '@mui/material'
import { useNavigate } from 'react-router-dom'

/** « Accès refusé » in the common layout (rule-foundation-admin-screens-guard, rule-recouvrement-screen-guard). */
export function AccessDenied() {
  const navigate = useNavigate()
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
