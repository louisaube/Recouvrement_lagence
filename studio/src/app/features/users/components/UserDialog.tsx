import { useRef, useState, type SyntheticEvent } from 'react'
import { Alert, Box, Button, Checkbox, Chip, FormControl, FormHelperText, InputLabel, ListItemText, MenuItem, Select, TextField } from '@mui/material'
import { api } from '../../../shared/api'
import { FormDialog } from '../../../shared/components/FormDialog'
import { roleLabel } from '../../../shared/labels'
import { channelLabel, profileLabel } from '../../../shared/recouvrementLabels'
import { failureMessage, useCall } from '../../../shared/useCall'
import { useAllItems } from '../../../shared/usePagedList'
import { useSession } from '../../auth/hooks/useSession'
import { useGroupLoader } from '../../groups/hooks/useGroupLoader'
import type { Channel, Profile } from '../../profiles/hooks/useProfile'
import type { UserProfile } from '../../profiles/hooks/useUserProfiles'
import type { User } from '../hooks/useUserLoader'

type Role = 'user' | 'admin'

const OWN_ROLE_MESSAGE = 'Vous ne pouvez pas modifier votre propre rôle.'
const AGENT_ROLE_MESSAGE = 'Un compte agent doit avoir le rôle Utilisateur.'
const OWN_PROFILE_MESSAGE = 'Vous ne pouvez pas modifier votre propre profil.'
const CHANNEL_REQUIRED_MESSAGE = 'Choisissez un canal pour un compte agent.'
const PROFILES: Profile[] = ['supervisor', 'agent', 'litigation', 'indicators']
const CHANNELS: Channel[] = ['voice', 'email_sms', 'mail']

interface Props {
  /** The account being edited; absent for a creation. */
  user?: User
  /** Profile and channel of the account, as read from `GET /user-profiles`. */
  currentProfile?: UserProfile
  /** The profiles are loaded: « Enregistrer » waits for them. */
  profilesReady: boolean
  onClose: () => void
  /** The account list changed behind the open dialog (account saved, profile refused). */
  onReload: () => void
  /** `profileFailed`: the account is saved but its profile could not be attributed. */
  onSaved: (profileFailed: boolean) => void
}

/**
 * rule-foundation-users-admin-screen, rule-foundation-user-own-role-locked, rule-foundation-user-no-group-no-data,
 * rule-recouvrement-users-profile-screen, rule-recouvrement-users-single-profile
 */
export function UserDialog({ user, currentProfile, profilesReady, onClose, onReload, onSaved }: Props) {
  const call = useCall()
  const { state: session } = useSession()
  const editing = user !== undefined
  const isSelf = session.status === 'authenticated' && user !== undefined && session.user.id === user.id
  const groups = useAllItems(useGroupLoader())

  const [email, setEmail] = useState(user?.email ?? '')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<Role>(user?.role ?? 'user')
  const [groupIds, setGroupIds] = useState<string[]>(user?.groups.map((g) => g.id) ?? [])
  const [profile, setProfile] = useState<Profile | 'none'>(currentProfile?.profile ?? 'none')
  const [channel, setChannel] = useState<Channel | ''>(currentProfile?.channel ?? '')
  const [channelTaken, setChannelTaken] = useState(false)
  const [profileRefused, setProfileRefused] = useState(false)
  // rule-recouvrement-users-profile-two-calls: once the account is saved, a retry only repeats the profile call.
  const savedUserId = useRef<string | null>(user?.id ?? null)
  const accountDone = useRef(false)
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

  const agent = profile === 'agent'
  // rule-recouvrement-users-profile-local-validation: no call when the profile choice is incoherent.
  const channelError = agent && channel === '' ? CHANNEL_REQUIRED_MESSAGE : channelTaken ? 'Ce canal a déjà un compte agent.' : null
  const agentRoleError = agent && role === 'admin'

  const submit = async () => {
    setAttempted(true)
    setFormError(null)
    setRoleRefused(false)
    setProfileRefused(false)
    if (!editing && !accountDone.current && (emailError || passwordError)) return
    if (agent && (channel === '' || agentRoleError)) return
    setSubmitting(true)
    if (!accountDone.current) {
      const outcome = user
        ? await call(() => api.PATCH('/users/{id}', { params: { path: { id: user.id } }, body: { role, groupIds } }))
        : await call(() => api.POST('/users', { body: { email: trimmedEmail, password, role, groupIds } }))
      if (!outcome.ok) {
        setSubmitting(false)
        const { status, code } = outcome.failure
        if (status === 409 && code === 'users.email_already_exists') return setEmailTaken(true)
        if (status === 409 && code === 'users.cannot_change_own_role') return setRoleRefused(true)
        if (status === 401) return
        return setFormError(failureMessage(outcome.failure))
      }
      accountDone.current = true
      savedUserId.current = 'user' in outcome.data ? outcome.data.user.id : (user?.id ?? null)
      onReload()
    }
    const userId = savedUserId.current
    const wanted = profile === 'none' ? null : profile
    const wantedChannel = wanted === 'agent' && channel !== '' ? channel : null
    const changed = isSelf ? false : wanted !== (currentProfile?.profile ?? null) || wantedChannel !== (currentProfile?.channel ?? null)
    if (!changed || userId === null) {
      setSubmitting(false)
      return onSaved(false)
    }
    const result = await call(() => api.PUT('/user-profiles/{userId}', { params: { path: { userId } }, body: { profile: wanted, channel: wantedChannel } }))
    setSubmitting(false)
    if (result.ok) return onSaved(false)
    const { status, code } = result.failure
    if (status === 401) return
    // The account exists: a refusal the administrator can fix stays in the dialog, anything else is a warning.
    if (status === 409 && code === 'profiles.channel_taken') return setChannelTaken(true)
    if (status === 409 && code === 'profiles.agent_requires_user_role') return setRoleRefused(true)
    if (status === 409 && code === 'profiles.channel_required') return setFormError(CHANNEL_REQUIRED_MESSAGE)
    if (status === 409 && code === 'profiles.cannot_change_own_profile') return setProfileRefused(true)
    if (status === 400) return setFormError(failureMessage(result.failure))
    onSaved(true)
  }

  return (
    <FormDialog
      title={editing ? "Modifier l'utilisateur" : 'Nouvel utilisateur'}
      submitting={submitting}
      saveDisabled={groups.state.status !== 'ready' || !profilesReady}
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
          helperText={attempted && passwordError ? passwordError : agent ? '8 caractères minimum. Le compte agent se connecte avec ce mot de passe pour obtenir son jeton.' : '8 caractères minimum.'}
          slotProps={{ htmlInput: { autoComplete: 'new-password' } }}
        />
      )}
      <FormControl disabled={isSelf} error={roleRefused || agentRoleError}>
        <InputLabel id="user-role-label">Rôle</InputLabel>
        <Select labelId="user-role-label" label="Rôle" value={role} onChange={(e) => setRole(e.target.value as Role)} onClose={menuClosed}>
          <MenuItem value="user">{roleLabel('user')}</MenuItem>
          <MenuItem value="admin">{roleLabel('admin')}</MenuItem>
        </Select>
        {(isSelf || (roleRefused && !agent)) && <FormHelperText>{OWN_ROLE_MESSAGE}</FormHelperText>}
        {agent && !isSelf && <FormHelperText>{AGENT_ROLE_MESSAGE}</FormHelperText>}
      </FormControl>
      <FormControl disabled={isSelf || !profilesReady} error={profileRefused}>
        <InputLabel id="user-profile-label">Profil</InputLabel>
        <Select
          labelId="user-profile-label"
          label="Profil"
          value={profile}
          onChange={(e) => {
            setProfile(e.target.value as Profile | 'none')
            setChannelTaken(false)
          }}
          onClose={menuClosed}
        >
          <MenuItem value="none">Aucun profil</MenuItem>
          {PROFILES.map((p) => (
            <MenuItem key={p} value={p}>
              {profileLabel(p)}
            </MenuItem>
          ))}
        </Select>
        <FormHelperText>
          {isSelf || profileRefused ? OWN_PROFILE_MESSAGE : "Le profil donne accès aux écrans de recouvrement. Sans profil, un compte n'a aucun droit de recouvrement."}
        </FormHelperText>
      </FormControl>
      {agent && (
        <FormControl disabled={isSelf} required error={(attempted || channelTaken) && channelError !== null}>
          <InputLabel id="user-channel-label">Canal</InputLabel>
          <Select
            labelId="user-channel-label"
            label="Canal"
            value={channel}
            onChange={(e) => {
              setChannel(e.target.value as Channel | '')
              setChannelTaken(false)
            }}
            onClose={menuClosed}
          >
            {CHANNELS.map((c) => (
              <MenuItem key={c} value={c}>
                {channelLabel(c)}
              </MenuItem>
            ))}
          </Select>
          <FormHelperText>{(attempted || channelTaken) && channelError ? channelError : 'Un seul compte agent par canal.'}</FormHelperText>
        </FormControl>
      )}
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
