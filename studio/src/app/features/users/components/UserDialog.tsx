import { useRef, useState, type SyntheticEvent } from 'react'
import { Alert, Box, Button, Checkbox, Chip, FormControl, FormHelperText, InputLabel, ListItemText, MenuItem, Select, TextField } from '@mui/material'
import { api } from '../../../shared/api'
import { FormDialog } from '../../../shared/components/FormDialog'
import { roleLabel } from '../../../shared/labels'
import { failureMessage, useCall } from '../../../shared/useCall'
import { useAllItems } from '../../../shared/usePagedList'
import { useSession } from '../../auth/hooks/useSession'
import { useGroupLoader } from '../../groups/hooks/useGroupLoader'
import type { User } from '../hooks/useUserLoader'

type Role = 'user' | 'admin'

const OWN_ROLE_MESSAGE = 'Vous ne pouvez pas modifier votre propre rôle.'

interface Props {
  /** The account being edited; absent for a creation. */
  user?: User
  onClose: () => void
  onSaved: () => void
}

/** rule-foundation-users-admin-screen, rule-foundation-user-own-role-locked, rule-foundation-user-no-group-no-data */
export function UserDialog({ user, onClose, onSaved }: Props) {
  const call = useCall()
  const { state: session } = useSession()
  const editing = user !== undefined
  const isSelf = session.status === 'authenticated' && user !== undefined && session.user.id === user.id
  const groups = useAllItems(useGroupLoader())

  const [email, setEmail] = useState(user?.email ?? '')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<Role>(user?.role ?? 'user')
  const [groupIds, setGroupIds] = useState<string[]>(user?.groups.map((g) => g.id) ?? [])
  const [attempted, setAttempted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [emailTaken, setEmailTaken] = useState(false)
  const [roleRefused, setRoleRefused] = useState(false)
  // A choice closes the list and focus returns to the field: the Échap that follows must not also close the dialog.
  const menuClosedAt = useRef(0)
  const menuClosed = (event: SyntheticEvent) => {
    if (event.type !== 'keydown') menuClosedAt.current = Date.now()
  }

  const trimmedEmail = email.trim()
  const emailError = trimmedEmail === '' ? "L'adresse e-mail est obligatoire." : trimmedEmail.length > 254 ? "L'adresse e-mail ne doit pas dépasser 254 caractères." : !/^.+@.+$/.test(trimmedEmail) ? "L'adresse e-mail est invalide." : emailTaken ? 'Cette adresse e-mail est déjà utilisée.' : null
  const passwordError = password.length < 8 || password.length > 72 ? 'Le mot de passe doit contenir de 8 à 72 caractères.' : null

  const groupOptions = groups.state.status === 'ready' ? groups.state.items : []
  const nameOf = (id: string) => groupOptions.find((g) => g.id === id)?.name ?? user?.groups.find((g) => g.id === id)?.name ?? id

  const submit = async () => {
    setAttempted(true)
    setFormError(null)
    setRoleRefused(false)
    if (!editing && (emailError || passwordError)) return
    setSubmitting(true)
    const outcome = user
      ? await call(() => api.PATCH('/users/{id}', { params: { path: { id: user.id } }, body: { role, groupIds } }))
      : await call(() => api.POST('/users', { body: { email: trimmedEmail, password, role, groupIds } }))
    setSubmitting(false)
    if (outcome.ok) return onSaved()
    const { status, code } = outcome.failure
    if (status === 409 && code === 'users.email_already_exists') return setEmailTaken(true)
    if (status === 409 && code === 'users.cannot_change_own_role') return setRoleRefused(true)
    if (status === 401) return
    setFormError(failureMessage(outcome.failure))
  }

  return (
    <FormDialog
      title={editing ? "Modifier l'utilisateur" : 'Nouvel utilisateur'}
      submitting={submitting}
      saveDisabled={groups.state.status !== 'ready'}
      onClose={onClose}
      ignoreEscape={() => Date.now() - menuClosedAt.current < 1000}
      onSubmit={submit}
    >
      {formError && <Alert severity="error">{formError}</Alert>}
      <TextField
        label="Adresse e-mail"
        value={email}
        onChange={(e) => {
          setEmail(e.target.value)
          setEmailTaken(false)
        }}
        autoFocus={!editing}
        error={!editing && (attempted || emailTaken) && emailError !== null}
        helperText={!editing && (attempted || emailTaken) ? emailError : undefined}
        slotProps={{ input: { readOnly: editing } }}
        autoComplete="off"
      />
      {!editing && (
        <TextField
          label="Mot de passe"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={attempted && passwordError !== null}
          helperText={attempted && passwordError ? passwordError : '8 caractères minimum.'}
          slotProps={{ htmlInput: { autoComplete: 'new-password' } }}
        />
      )}
      <FormControl disabled={isSelf} error={roleRefused}>
        <InputLabel id="user-role-label">Rôle</InputLabel>
        <Select labelId="user-role-label" label="Rôle" value={role} onChange={(e) => setRole(e.target.value as Role)} onClose={menuClosed}>
          <MenuItem value="user">{roleLabel('user')}</MenuItem>
          <MenuItem value="admin">{roleLabel('admin')}</MenuItem>
        </Select>
        {(isSelf || roleRefused) && <FormHelperText>{OWN_ROLE_MESSAGE}</FormHelperText>}
      </FormControl>
      {groups.state.status === 'error' && (
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" onClick={groups.retry}>
              Réessayer
            </Button>
          }
        >
          Impossible de charger les groupes.
        </Alert>
      )}
      <FormControl disabled={groups.state.status !== 'ready'}>
        <InputLabel id="user-groups-label">Groupes</InputLabel>
        <Select
          labelId="user-groups-label"
          label="Groupes"
          multiple
          value={groupIds}
          onChange={(e) => setGroupIds(typeof e.target.value === 'string' ? e.target.value.split(',') : e.target.value)}
          renderValue={(selected) => (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
              {selected.map((id) => (
                <Chip key={id} label={nameOf(id)} size="small" />
              ))}
            </Box>
          )}
        >
          {groupOptions.map((g) => (
            <MenuItem key={g.id} value={g.id}>
              <Checkbox checked={groupIds.includes(g.id)} />
              <ListItemText primary={g.name} />
            </MenuItem>
          ))}
        </Select>
        <FormHelperText>Un utilisateur sans groupe ne voit aucune donnée rattachée à un périmètre.</FormHelperText>
      </FormControl>
    </FormDialog>
  )
}
