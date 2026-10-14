import { useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Alert, Box, Button, List, ListItem, ListItemText, Stack, TextField, Typography } from '@mui/material'
import { formatEuros } from '../../../shared/format'
import { ImportFlow, type ImportFlowExtension } from '../../../shared/import/ImportFlow'
import { formatCount } from '../../../shared/import/importMessages'
import type { ImportPreviewSummary } from '../../../shared/import/importTypes'
import { importTypeLabel } from '../../../shared/recouvrementLabels'
import { useRecoveryImportApi, type RecoveryImportType } from '../hooks/useRecoveryImportApi'
import { ImportReport } from './ImportReport'

/** Pattern of `controlTotal` in the contract (digits and spaces, optional comma or dot with 1 or 2 decimals). */
const CONTROL_TOTAL = /^-?[0-9 ]{1,15}([.,][0-9]{1,2})?$/

const MESSAGE_CONTROL_TOTAL_MISSING = 'Saisissez le total de contrôle avant de déposer le fichier.'
const MESSAGE_CONTROL_TOTAL_UNREADABLE = 'Le total de contrôle est illisible. Exemple : 1 234 567,89.'

const REFUSAL_MESSAGES: Record<string, string> = {
  'imports.control_total_required': 'Saisissez le total de contrôle.',
  'imports.control_total_invalid': MESSAGE_CONTROL_TOTAL_UNREADABLE,
  'imports.file_refused': 'Ce fichier est refusé en entier : corrigez-le et déposez-le à nouveau.',
  'imports.stale_extraction': 'Un cliché plus récent a été confirmé entre-temps. Déposez à nouveau le fichier.',
}

const WHOLE_FILE: RecoveryImportType[] = ['receivables', 'payments']

interface Props {
  type: RecoveryImportType
  onConfirmed: () => void
}

/**
 * One spreadsheet tab of the Imports screen: the foundation import flow extended with the control total (Créances),
 * the refusal of a whole file, the difference report and the effects of the green light.
 * rule-recouvrement-screen-imports, rule-recouvrement-import-flow-reuse, rule-recouvrement-import-report-before-green-light,
 * rule-recouvrement-import-tab-reset (the parent remounts this component per tab).
 */
export function RecoveryImportTab({ type, onConfirmed }: Props) {
  const [controlTotal, setControlTotal] = useState('')
  const controlTotalRef = useRef('')
  controlTotalRef.current = controlTotal
  const importApi = useRecoveryImportApi(type, controlTotalRef)
  const wholeFile = WHOLE_FILE.includes(type)

  const extension = useMemo<ImportFlowExtension>(
    () => ({
      beforeDeposit:
        type === 'receivables' ? (
          <TextField
            label="Total de contrôle (€)"
            value={controlTotal}
            onChange={(e) => setControlTotal(e.target.value)}
            helperText="Solde du compte clients à la date d'extraction, tel que l'outil comptable le donne."
            slotProps={{ htmlInput: { inputMode: 'decimal', autoComplete: 'off' } }}
            sx={{ mb: 2, display: 'block', maxWidth: 420 }}
          />
        ) : undefined,
      depositGuard:
        type === 'receivables'
          ? () => {
              const value = controlTotal.trim()
              if (value === '') return MESSAGE_CONTROL_TOTAL_MISSING
              return CONTROL_TOTAL.test(value) ? undefined : MESSAGE_CONTROL_TOTAL_UNREADABLE
            }
          : undefined,
      specNote: wholeFile ? 'Ce fichier est refusé en entier dès la première erreur.' : undefined,
      refused: wholeFile ? (p: ImportPreviewSummary) => p.accepted === false : undefined,
      previewAfterCounters: (p: ImportPreviewSummary) =>
        type === 'receivables' && p.computedTotalCents != null ? (
          <Stack spacing={0.5}>
            <Typography>{`Total des soldes du fichier : ${formatEuros(p.computedTotalCents)}`}</Typography>
            <Typography color={p.controlTotalCents !== p.computedTotalCents ? 'error.main' : undefined}>
              {`Total de contrôle saisi : ${p.controlTotalCents == null ? '—' : formatEuros(p.controlTotalCents)}`}
            </Typography>
          </Stack>
        ) : null,
      previewVerdict: (p: ImportPreviewSummary) =>
        wholeFile && p.accepted === false ? (
          <Alert severity="error">Fichier refusé en entier : la première erreur suffit. Corrigez le fichier et déposez-le à nouveau.</Alert>
        ) : undefined,
      previewAfterErrors: (p: ImportPreviewSummary) => <ImportReport type={type} importId={p.importId} />,
      confirmButton: (validRows: number) => `Donner le feu vert (${formatCount(validRows)} lignes)`,
      dialog: {
        title: 'Donner le feu vert',
        text: (validRows: number, errorRows: number, whole: boolean) =>
          whole
            ? `Le fichier sera importé en entier. Cette action est tracée au journal d'audit.`
            : `${formatCount(validRows)} ligne(s) seront importées.${errorRows > 0 ? ` ${formatCount(errorRows)} ligne(s) en erreur seront ignorées et ne seront pas importées.` : ''} Cette action est tracée au journal d'audit.`,
        confirmLabel: 'Confirmer le feu vert',
      },
      failureMessage: (failure: { status: number; code?: string }) => (failure.code ? REFUSAL_MESSAGES[failure.code] : undefined),
      // a refused file or a stale snapshot does not change on retry: the file has to be deposited again
      confirmFailureRestarts: (failure: { status: number; code?: string }) =>
        failure.code === 'imports.file_refused' || failure.code === 'imports.stale_extraction',
      renderResult: (result: { createdCount: number; skippedCount: number; effects?: { label: string; count: number }[] }, restart: () => void) => (
        <Stack spacing={2}>
          <Alert severity="success">{`${formatCount(result.createdCount)} ligne(s) importée(s).`}</Alert>
          {result.effects && result.effects.length > 0 && (
            <Box component="section" aria-labelledby="import-effects">
              <Typography id="import-effects" variant="h6" component="h2">
                Effets
              </Typography>
              <List dense>
                {result.effects.map((effect) => (
                  <ListItem key={effect.label}>
                    <ListItemText primary={`${effect.label} : ${formatCount(effect.count)}`} />
                  </ListItem>
                ))}
              </List>
            </Box>
          )}
          {result.skippedCount > 0 && (
            <Alert severity="warning">{`${formatCount(result.skippedCount)} ligne(s) valide(s) à l'aperçu n'ont pas pu être enregistrées ou existaient déjà.`}</Alert>
          )}
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
            <Button variant="contained" onClick={restart}>
              Importer un autre fichier
            </Button>
            <Button component={Link} to="/file-de-decisions" variant="outlined">
              File de décisions
            </Button>
          </Stack>
        </Stack>
      ),
      // rule-recouvrement-import-reload-after-confirm
      onConfirmed,
    }),
    [type, wholeFile, controlTotal, onConfirmed],
  )

  return <ImportFlow api={importApi} noun={importTypeLabel(type).toLowerCase()} exit={{ label: 'Accueil', to: '/' }} extension={extension} />
}
