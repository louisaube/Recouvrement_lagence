import type { FormEvent, ReactNode } from 'react'
import { Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, useMediaQuery, useTheme } from '@mui/material'

interface Props {
  title: string
  submitting: boolean
  /** Disables « Enregistrer » (for instance while the choice lists are not loaded). */
  saveDisabled?: boolean
  onClose: () => void
  /** Lets a field swallow an Échap that only dismissed one of its own popups. */
  ignoreEscape?: () => boolean
  onSubmit: () => void
  children: ReactNode
}

/** Common shell of the create / edit dialogs: full screen under 600 px, « Annuler » / « Enregistrer ». */
export function FormDialog({ title, submitting, saveDisabled, onClose, ignoreEscape, onSubmit, children }: Props) {
  const theme = useTheme()
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'))
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!submitting) onSubmit()
  }
  return (
    <Dialog open fullScreen={fullScreen} fullWidth maxWidth="sm" onClose={(_, reason) => {
        if (submitting || (reason === 'escapeKeyDown' && ignoreEscape?.())) return
        onClose()
      }} aria-labelledby="form-dialog-title">
      <form onSubmit={submit} noValidate style={{ display: 'contents' }}>
        <DialogTitle id="form-dialog-title">{title}</DialogTitle>
        <DialogContent>
          <Stack spacing={2.5} sx={{ pt: 1 }}>
            {children}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={onClose} disabled={submitting}>
            Annuler
          </Button>
          <Button type="submit" variant="contained" disabled={submitting || saveDisabled}>
            {submitting ? 'Enregistrement…' : 'Enregistrer'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}
