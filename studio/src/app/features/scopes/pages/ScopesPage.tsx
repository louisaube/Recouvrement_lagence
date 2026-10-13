import { useState } from 'react'
import { Button, IconButton, TableCell, TableRow } from '@mui/material'
import EditIcon from '@mui/icons-material/Edit'
import { AdminList } from '../../../shared/components/AdminList'
import { PageHeader } from '../../../shared/components/PageHeader'
import { useNotify } from '../../../shared/notify'
import { usePagedList } from '../../../shared/usePagedList'
import { ScopeDialog } from '../components/ScopeDialog'
import { useScopeLoader, type Scope } from '../hooks/useScopeLoader'

/** rule-foundation-scopes-admin-screen */
export function ScopesPage() {
  const notify = useNotify()
  const list = usePagedList<Scope>(useScopeLoader())
  const [dialog, setDialog] = useState<{ scope?: Scope } | null>(null)

  return (
    <>
      <PageHeader title="Périmètres">
        <Button variant="contained" onClick={() => setDialog({})}>
          Nouveau périmètre
        </Button>
      </PageHeader>
      <AdminList
        list={list}
        columns={[{ label: 'Code' }, { label: 'Nom' }, { label: 'Actions' }]}
        emptyText="Aucun périmètre pour le moment. Créez le premier périmètre."
        renderRow={(scope) => (
          <TableRow key={scope.id}>
            <TableCell>{scope.code}</TableCell>
            <TableCell>{scope.name}</TableCell>
            <TableCell>
              <IconButton aria-label={`Modifier le périmètre ${scope.code}`} onClick={() => setDialog({ scope })}>
                <EditIcon />
              </IconButton>
            </TableCell>
          </TableRow>
        )}
      />
      {dialog && (
        <ScopeDialog
          scope={dialog.scope}
          onClose={() => setDialog(null)}
          onSaved={() => {
            const created = dialog.scope === undefined
            setDialog(null)
            notify(created ? 'Périmètre créé.' : 'Périmètre modifié.')
            if (created) list.reloadFirst()
            else list.reload()
          }}
        />
      )}
    </>
  )
}
