import { useState } from 'react'
import { Alert, TextField, Typography } from '@mui/material'
import { FormDialog } from '../../../shared/components/FormDialog'

const MAX = 1000

interface Props {
  submitting: boolean
  error: string | null
  onClose: () => void
  onSubmit: (reason: string) => void
}

/** rule-recouvrement-screen-batch-blocked-needs-reason: without a reason, no call is sent. */
export function ReleaseDialog({ submitting, error, onClose, onSubmit }: Props) {
  const [reason, setReason] = useState('')
  const [touched, setTouched] = useState(false)
  const trimmed = reason.trim()
  const invalid = trimmed.length === 0 || trimmed.length > MAX
  return (
    <FormDialog
      title="Libérer le lot"
      submitting={submitting}
      onClose={onClose}
      onSubmit={() => {
        setTouched(true)
        if (!invalid) onSubmit(trimmed)
      }}
    >
      <Typography>Les contrôles en échec resteront affichés. Cette action est tracée au journal d'audit.</Typography>
      {error && <Alert severity="error">{error}</Alert>}
      <TextField
        label="Motif de la libération"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        onBlur={() => setTouched(true)}
        required
        multiline
        minRows={3}
        error={touched && invalid}
        helperText={touched && trimmed.length === 0 ? 'Le motif est obligatoire.' : touched && trimmed.length > MAX ? `Le motif ne peut pas dépasser ${MAX} caractères.` : `${reason.length} / ${MAX}`}
        slotProps={{ htmlInput: { maxLength: MAX } }}
      />
    </FormDialog>
  )
}
