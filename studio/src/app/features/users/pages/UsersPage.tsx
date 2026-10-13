import { useState } from 'react'
import { Box, Button, Chip, IconButton, Stack, TableCell, TableRow, Tooltip, Typography } from '@mui/material'
import EditIcon from '@mui/icons-material/Edit'
import UploadFileIcon from '@mui/icons-material/UploadFile'
import { Link } from 'react-router-dom'
import { AdminList } from '../../../shared/components/AdminList'
import { PageHeader } from '../../../shared/components/PageHeader'
import { roleLabel } from '../../../shared/labels'
import { useNotify } from '../../../shared/notify'
import { usePagedList } from '../../../shared/usePagedList'
import { UserDialog } from '../components/UserDialog'
import { useUserLoader, type User } from '../hooks/useUserLoader'

/** rule-foundation-users-admin-screen */
export function UsersPage() {
  const notify = useNotify()
  const list = usePagedList<User>(useUserLoader())
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
      <AdminList
        list={list}
        columns={[{ label: 'Adresse e-mail' }, { label: 'Rôle' }, { label: 'Groupes' }, { label: 'Actions' }]}
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
          onClose={() => setDialog(null)}
          onSaved={() => {
            const created = dialog.user === undefined
            setDialog(null)
            notify(created ? 'Utilisateur créé.' : 'Utilisateur modifié.')
            if (created) list.reloadFirst()
            else list.reload()
          }}
        />
      )}
    </>
  )
}
