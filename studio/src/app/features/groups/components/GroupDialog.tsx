import { useState } from 'react'
import { Alert, Autocomplete, Button, Chip, Link as MuiLink, TextField } from '@mui/material'
import { Link } from 'react-router-dom'
import { api } from '../../../shared/api'
import { FormDialog } from '../../../shared/components/FormDialog'
import { failureMessage, useCall } from '../../../shared/useCall'
import { useAllItems } from '../../../shared/usePagedList'
import { useScopeLoader, type Scope } from '../../scopes/hooks/useScopeLoader'
import { useUserLoader, type User } from '../../users/hooks/useUserLoader'
import type { Group } from '../hooks/useGroupLoader'

interface Props {
  /** The group being edited; absent for a creation. */
  group?: Group
  onClose: () => void
  onSaved: () => void
}

/** rule-foundation-group-definition, rule-foundation-group-needs-scope */
export function GroupDialog({ group, onClose, onSaved }: Props) {
  const call = useCall()
  const users = useAllItems(useUserLoader())
  const scopes = useAllItems(useScopeLoader())

  const [name, setName] = useState(group?.name ?? '')
  const [memberIds, setMemberIds] = useState<string[]>(group?.members.map((m) => m.id) ?? [])
  const [scopeIds, setScopeIds] = useState<string[]>(group?.scopes.map((s) => s.id) ?? [])
  const [attempted, setAttempted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [nameTaken, setNameTaken] = useState(false)

  const loaded = users.state.status === 'ready' && scopes.state.status === 'ready'
  const failed = users.state.status === 'error' || scopes.state.status === 'error'
  const userOptions: Pick<User, 'id' | 'email'>[] = users.state.status === 'ready' ? users.state.items : []
  const scopeOptions: Scope[] = scopes.state.status === 'ready' ? scopes.state.items : []

  const trimmedName = name.trim()
  const nameError = trimmedName === '' ? 'Le nom est obligatoire.' : trimmedName.length > 100 ? 'Le nom ne doit pas dépasser 100 caractères.' : nameTaken ? 'Ce nom de groupe est déjà utilisé.' : null
  const scopeError = scopeIds.length === 0

  const retry = () => {
    users.retry()
    scopes.retry()
  }

  const submit = async () => {
    setAttempted(true)
    setFormError(null)
    if (nameError || scopeError) return
    setSubmitting(true)
    // On edition only the fields that changed are sent: the audit summary cites the names of the fields sent.
    const sameIds = (a: string[], b: string[]) => a.length === b.length && a.every((id) => b.includes(id))
    const outcome = group
      ? await call(() =>
          api.PATCH('/groups/{id}', {
            params: { path: { id: group.id } },
            body: {
              name: trimmedName,
              ...(!sameIds(memberIds, group.members.map((m) => m.id)) && { userIds: memberIds }),
              ...(!sameIds(scopeIds, group.scopes.map((s) => s.id)) && { scopeIds }),
            },
          }),
        )
      : await call(() => api.POST('/groups', { body: { name: trimmedName, userIds: memberIds, scopeIds } }))
    setSubmitting(false)
    if (outcome.ok) return onSaved()
    if (outcome.failure.status === 409 && outcome.failure.code === 'groups.name_already_exists') return setNameTaken(true)
    if (outcome.failure.status === 401) return
    setFormError(failureMessage(outcome.failure))
  }

  return (
    <FormDialog title={group ? 'Modifier le groupe' : 'Nouveau groupe'} submitting={submitting} saveDisabled={!loaded} onClose={onClose} onSubmit={submit}>
      {formError && <Alert severity="error">{formError}</Alert>}
      {failed && (
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" onClick={retry}>
              Réessayer
            </Button>
          }
        >
          Impossible de charger les utilisateurs et les périmètres.
        </Alert>
      )}
      {scopes.state.status === 'ready' && scopeOptions.length === 0 && (
        <Alert severity="info">
          Aucun périmètre n'existe encore. Créez-en depuis l'écran{' '}
          <MuiLink component={Link} to="/perimetres">
            Périmètres
          </MuiLink>
          .
        </Alert>
      )}
      <TextField
        label="Nom"
        value={name}
        onChange={(e) => {
          setName(e.target.value)
          setNameTaken(false)
        }}
        autoFocus
        error={(attempted || nameTaken) && nameError !== null}
        helperText={attempted || nameTaken ? nameError : undefined}
        autoComplete="off"
      />
      <Autocomplete
        multiple
        disableCloseOnSelect
        disabled={!loaded}
        options={userOptions}
        value={userOptions.filter((u) => memberIds.includes(u.id))}
        getOptionLabel={(u) => u.email}
        isOptionEqualToValue={(a, b) => a.id === b.id}
        onChange={(_, selected) => setMemberIds(selected.map((u) => u.id))}
        noOptionsText="Aucun utilisateur"
        renderInput={(params) => <TextField {...params} label="Membres" />}
      />
      <Autocomplete
        multiple
        disableCloseOnSelect
        disabled={!loaded}
        options={scopeOptions}
        value={scopeOptions.filter((s) => scopeIds.includes(s.id))}
        getOptionLabel={(s) => `${s.code} — ${s.name}`}
        isOptionEqualToValue={(a, b) => a.id === b.id}
        onChange={(_, selected) => setScopeIds(selected.map((s) => s.id))}
        noOptionsText="Aucun périmètre"
        renderTags={(selected, getTagProps) =>
          selected.map((s, index) => {
            const { key, ...tagProps } = getTagProps({ index })
            return <Chip key={key} label={s.code} size="small" {...tagProps} />
          })
        }
        renderInput={(params) => <TextField {...params} label="Périmètres" error={attempted && scopeError} helperText="Au moins un périmètre." />}
      />
    </FormDialog>
  )
}
