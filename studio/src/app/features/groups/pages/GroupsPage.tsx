import { useState } from 'react'
import { Box, Button, Chip, IconButton, Stack, TableCell, TableRow, Tooltip } from '@mui/material'
import EditIcon from '@mui/icons-material/Edit'
import { AdminList } from '../../../shared/components/AdminList'
import { PageHeader } from '../../../shared/components/PageHeader'
import { useNotify } from '../../../shared/notify'
import { usePagedList } from '../../../shared/usePagedList'
import { GroupDialog } from '../components/GroupDialog'
import { useGroupLoader, type Group } from '../hooks/useGroupLoader'

function membersLabel(count: number): string {
  if (count === 0) return 'Aucun membre'
  return count === 1 ? '1 membre' : `${count} membres`
}

/** rule-foundation-groups-admin-screen */
export function GroupsPage() {
  const notify = useNotify()
  const list = usePagedList<Group>(useGroupLoader())
  const [dialog, setDialog] = useState<{ group?: Group } | null>(null)

  return (
    <>
      <PageHeader title="Groupes">
        <Button variant="contained" onClick={() => setDialog({})}>
          Nouveau groupe
        </Button>
      </PageHeader>
      <AdminList
        list={list}
        columns={[{ label: 'Nom' }, { label: 'Membres' }, { label: 'Périmètres' }, { label: 'Actions' }]}
        emptyText="Aucun groupe pour le moment. Créez le premier groupe."
        renderRow={(group) => (
          <TableRow key={group.id}>
            <TableCell>{group.name}</TableCell>
            <TableCell>{membersLabel(group.members.length)}</TableCell>
            <TableCell>
              <Box component={Stack} direction="row" useFlexGap spacing={0.5} sx={{ flexWrap: 'wrap' }}>
                {group.scopes.map((s) => (
                  <Tooltip key={s.id} title={s.name}>
                    <Chip label={s.code} size="small" />
                  </Tooltip>
                ))}
              </Box>
            </TableCell>
            <TableCell>
              <IconButton aria-label={`Modifier le groupe ${group.name}`} onClick={() => setDialog({ group })}>
                <EditIcon />
              </IconButton>
            </TableCell>
          </TableRow>
        )}
      />
      {dialog && (
        <GroupDialog
          group={dialog.group}
          onClose={() => setDialog(null)}
          onSaved={() => {
            const created = dialog.group === undefined
            setDialog(null)
            notify(created ? 'Groupe créé.' : 'Groupe modifié.')
            if (created) list.reloadFirst()
            else list.reload()
          }}
        />
      )}
    </>
  )
}
