import { Alert, Button } from '@mui/material'
import type { components } from '@recouvrement/api-client'
import { formatDate } from '../../../shared/format'

export type ImportStatus = components['schemas']['RecoveryImportStatusDto']

export type StatusState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; value: ImportStatus }

/** rule-recouvrement-import-statement-banner: reflects `fresh`; a stale statement blocks offers and orders. */
export function StatementBanner({ state, onRetry }: { state: StatusState; onRetry: () => void }) {
  if (state.status === 'loading') return null
  if (state.status === 'error') {
    return (
      <Alert
        severity="error"
        sx={{ mb: 2 }}
        action={
          <Button color="inherit" size="small" onClick={onRetry}>
            Réessayer
          </Button>
        }
      >
        Impossible de charger l'état du relevé bancaire.
      </Alert>
    )
  }
  const { fresh, lastStatementDate, maxAgeDays } = state.value.statement
  if (fresh && lastStatementDate) {
    return (
      <Alert severity="success" sx={{ mb: 2 }}>
        {`Relevé bancaire frais : relevé du ${formatDate(lastStatementDate)}`}
      </Alert>
    )
  }
  return (
    <Alert severity="warning" sx={{ mb: 2 }}>
      {"Relevé bancaire périmé ou absent : aucune offre ni aucun ordre d'envoi tant qu'un relevé frais n'est pas confirmé."}
      {lastStatementDate ? ` Dernier relevé : ${formatDate(lastStatementDate)}.` : ''}
      {maxAgeDays != null ? ` Fraîcheur maximale : ${maxAgeDays} jour(s).` : ''}
    </Alert>
  )
}
