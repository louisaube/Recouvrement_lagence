import { useState } from 'react'
import { Alert, Box, Button, Chip, IconButton, Stack, TableCell, TableRow, Tooltip, Typography } from '@mui/material'
import EditIcon from '@mui/icons-material/Edit'
import UploadFileIcon from '@mui/icons-material/UploadFile'
import { Link } from 'react-router-dom'
import { AdminList } from '../../../shared/components/AdminList'
import { PageHeader } from '../../../shared/components/PageHeader'
import { roleLabel } from '../../../shared/labels'
import { useNotify } from '../../../shared/notify'
import { profileWithChannelLabel } from '../../../shared/recouvrementLabels'
import { useAllItems, usePagedList } from '../../../shared/usePagedList'
import { useUserProfileLoader } from '../../profiles/hooks/useUserProfiles'
import { UserDialog } from '../components/UserDialog'
import { useUserLoader, type User } from '../hooks/useUserLoader'

/** rule-foundation-users-admin-screen, rule-recouvrement-users-profile-screen */
export function UsersPage() {
  const notify = useNotify()
  const list = usePagedList<User>(useUserLoader())
  // The profiles are read in full, at the same time as the page of accounts, and joined by account id.
  const profiles = useAllItems(useUserProfileLoader())
  const profileOf = (userId: string) => (profiles.state.status === 'ready' ? profiles.state.items.find((p) => p.userId === userId) : undefined)
  const [dialog, setDialog] = useState<{ user?: User } | null>(null)

  return (
    <>
      <PageHeader title="Utilisateurs">
        <Button component={Link} to="/utilisateurs/import" variant="outlined" startIcon={<UploadFileIcon />}>
          Importer des utilisateurs
        </Button>
        <Button variant="contained" onClick={() => setDialog({})}>
          Nouvel utilisateur
        </Button>
      </PageHeader>
      {profiles.state.status === 'error' && (
        <Alert
          severity="error"
          sx={{ mb: 2 }}
          action={
            <Button color="inherit" size="small" onClick={profiles.retry}>
              Réessayer
            </Button>
          }
        >
          Impossible de charger les profils.
        </Alert>
      )}
      <AdminList
        list={list}
        columns={[{ label: 'Adresse e-mail' }, { label: 'Rôle' }, { label: 'Profil' }, { label: 'Groupes' }, { label: 'Actions' }]}
        emptyText="Aucun utilisateur."
        renderRow={(user) => (
          <TableRow key={user.id}>
            <TableCell>
              <Tooltip title={user.email}>
                <Typography noWrap sx={{ maxWidth: 300 }}>
                  {user.email}
                </Typography>
              </Tooltip>
            </TableCell>
            <TableCell>{roleLabel(user.role)}</TableCell>
            <TableCell>
              {profiles.state.status !== 'ready' ? (
                '—'
              ) : (
                (() => {
                  const entry = profileOf(user.id)
                  return entry?.profile ? <Chip label={profileWithChannelLabel(entry.profile, entry.channel)} size="small" /> : <Typography color="text.secondary">Aucun profil</Typography>
                })()
              )}
            </TableCell>
            <TableCell>
              {user.groups.length === 0 ? (
                <Typography color="text.secondary">Aucun groupe</Typography>
              ) : (
                <Box component={Stack} direction="row" useFlexGap spacing={0.5} sx={{ flexWrap: 'wrap' }}>
                  {user.groups.map((g) => (
                    <Chip key={g.id} label={g.name} size="small" />
                  ))}
                </Box>
              )}
            </TableCell>
            <TableCell>
              <IconButton aria-label={`Modifier l'utilisateur ${user.email}`} onClick={() => setDialog({ user })}>
                <EditIcon />
              </IconButton>
            </TableCell>
          </TableRow>
        )}
      />
      {dialog && (
        <UserDialog
          user={dialog.user}
          currentProfile={dialog.user ? profileOf(dialog.user.id) : undefined}
          profilesReady={profiles.state.status === 'ready'}
          onClose={() => setDialog(null)}
          onReload={() => {
            profiles.retry()
            list.reload()
          }}
          onSaved={(profileFailed) => {
            const created = dialog.user === undefined
            setDialog(null)
            if (profileFailed) notify("Utilisateur enregistré, mais le profil n'a pas pu être attribué. Modifiez l'utilisateur pour réessayer.", 'warning')
            else notify(created ? 'Utilisateur créé.' : 'Utilisateur modifié.')
            profiles.retry()
            if (created) list.reloadFirst()
            else list.reload()
          }}
        />
      )}
    </>
  )
}
