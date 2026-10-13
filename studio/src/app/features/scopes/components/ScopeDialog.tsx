import { useState } from 'react'
import { Alert, TextField } from '@mui/material'
import { api } from '../../../shared/api'
import { FormDialog } from '../../../shared/components/FormDialog'
import { failureMessage, useCall } from '../../../shared/useCall'
import type { Scope } from '../hooks/useScopeLoader'

// rule-foundation-scope-code-format
const CODE_PATTERN = /^[a-z0-9][a-z0-9_-]{0,49}$/
const CODE_FORMAT_MESSAGE = 'Le code ne doit contenir que des lettres minuscules, chiffres, tirets et tirets bas.'

interface Props {
  /** The scope being edited; absent for a creation. */
  scope?: Scope
  onClose: () => void
  onSaved: () => void
}

/** rule-foundation-scopes-admin-screen, rule-foundation-scope-code-immutable */
export function ScopeDialog({ scope, onClose, onSaved }: Props) {
  const call = useCall()
  const editing = scope !== undefined
  const [code, setCode] = useState(scope?.code ?? '')
  const [name, setName] = useState(scope?.name ?? '')
  const [attempted, setAttempted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [codeTaken, setCodeTaken] = useState(false)

  const trimmedCode = code.trim()
  const trimmedName = name.trim()
  const codeError = editing
    ? null
    : trimmedCode === ''
      ? 'Le code est obligatoire.'
      : !CODE_PATTERN.test(trimmedCode)
        ? CODE_FORMAT_MESSAGE
        : codeTaken
          ? 'Ce code est déjà utilisé.'
          : null
  const nameError = trimmedName === '' ? 'Le nom est obligatoire.' : trimmedName.length > 100 ? 'Le nom ne doit pas dépasser 100 caractères.' : null

  const submit = async () => {
    setAttempted(true)
    setFormError(null)
    if ((!editing && !CODE_PATTERN.test(trimmedCode)) || nameError) return
    setSubmitting(true)
    const outcome = scope
      ? await call(() => api.PATCH('/scopes/{id}', { params: { path: { id: scope.id } }, body: { name: trimmedName } }))
      : await call(() => api.POST('/scopes', { body: { code: trimmedCode, name: trimmedName } }))
    setSubmitting(false)
    if (outcome.ok) return onSaved()
    if (outcome.failure.status === 409 && outcome.failure.code === 'scopes.code_already_exists') return setCodeTaken(true)
    if (outcome.failure.status === 401) return
    setFormError(failureMessage(outcome.failure))
  }

  return (
    <FormDialog title={editing ? 'Modifier le périmètre' : 'Nouveau périmètre'} submitting={submitting} onClose={onClose} onSubmit={submit}>
      {formError && <Alert severity="error">{formError}</Alert>}
      <TextField
        label="Code"
        value={code}
        onChange={(e) => {
          setCode(e.target.value)
          setCodeTaken(false)
        }}
        autoFocus={!editing}
        error={(attempted || codeTaken) && codeError !== null}
        helperText={
          (attempted || codeTaken) && codeError
            ? codeError
            : editing
              ? 'Le code ne peut pas être modifié.'
              : 'Lettres minuscules, chiffres, tirets et tirets bas (50 caractères maximum). Le code ne pourra plus être modifié.'
        }
        slotProps={{ input: { readOnly: editing } }}
        autoComplete="off"
      />
      <TextField
        label="Nom"
        value={name}
        onChange={(e) => setName(e.target.value)}
        autoFocus={editing}
        error={attempted && nameError !== null}
        helperText={attempted ? nameError : undefined}
        autoComplete="off"
      />
    </FormDialog>
  )
}
