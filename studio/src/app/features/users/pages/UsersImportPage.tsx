import { Link } from 'react-router-dom'
import { Button, Stack, Typography } from '@mui/material'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import { ImportFlow } from '../../../shared/import/ImportFlow'
import { useUsersImportApi } from '../hooks/useUsersImportApi'

/** Importer des utilisateurs (rule-foundation-import-users-admin-only: behind the administrator guard). */
export function UsersImportPage() {
  const importApi = useUsersImportApi()
  return (
    <>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={{ xs: 1, sm: 2 }} sx={{ mb: 3, alignItems: { xs: 'flex-start', sm: 'center' } }}>
        <Button component={Link} to="/utilisateurs" startIcon={<ArrowBackIcon />}>
          Utilisateurs
        </Button>
        <Typography variant="h4" component="h1">
          Importer des utilisateurs
        </Typography>
      </Stack>
      <ImportFlow api={importApi} noun="compte" exit={{ label: 'Retour aux utilisateurs', to: '/utilisateurs' }} />
    </>
  )
}
