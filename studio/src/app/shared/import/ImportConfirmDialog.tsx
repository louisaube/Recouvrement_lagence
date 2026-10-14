import { Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, Typography } from '@mui/material'
import { formatCount } from './importMessages'

interface Props {
  noun: string
  validRows: number
  errorRows: number
  submitting: boolean
  /** Overrides of the wording (rule-recouvrement-import-flow-reuse). */
  title?: string
  text?: string
  confirmLabel?: string
  onCancel: () => void
  onConfirm: () => void
}

/** « Confirmer l'import »: the only way to write anything (rule-foundation-import-two-steps). */
export function ImportConfirmDialog({ noun, validRows, errorRows, submitting, title = "Confirmer l'import", text, confirmLabel = "Confirmer l'import", onCancel, onConfirm }: Props) {
  return (
    <Dialog open onClose={submitting ? undefined : onCancel} aria-labelledby="import-confirm-title">
      <DialogTitle id="import-confirm-title">{title}</DialogTitle>
      <DialogContent>
        <DialogContentText>
          {text ?? (
            <>
              {formatCount(validRows)} {noun}(s) seront créés.
              {errorRows > 0 ? ` ${formatCount(errorRows)} ligne(s) en erreur seront ignorées et ne seront pas importées.` : ''} Cette action est tracée au journal d'audit.
            </>
          )}
        </DialogContentText>
        {submitting && (
          <Typography color="text.secondary" sx={{ mt: 2 }}>
            Import en cours…
          </Typography>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel} disabled={submitting}>
          Annuler
        </Button>
        <Button variant="contained" onClick={onConfirm} disabled={submitting}>
          {confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
