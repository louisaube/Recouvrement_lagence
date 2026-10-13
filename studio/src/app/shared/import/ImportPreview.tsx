import { useEffect } from 'react'
import { Alert, Box, Button, Card, CircularProgress, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TablePagination, TableRow, Typography } from '@mui/material'
import { failureMessage } from '../useCall'
import { usePagedList, type PageLoader } from '../usePagedList'
import { formatCount, isExpired } from './importMessages'
import type { ImportPreviewSummary, ImportRowError } from './importTypes'

interface Props {
  preview: ImportPreviewSummary
  loadErrors: PageLoader<ImportRowError>
  /** The preview is gone (404): back to the drop step. */
  onExpired: () => void
}

/** Step 2: counters, verdict and, when needed, the paginated table of faults. */
export function ImportPreview({ preview, loadErrors, onExpired }: Props) {
  const { totalRows, validRows, errorRows } = preview
  const verdict =
    errorRows === 0
      ? { severity: 'success' as const, text: 'Aucune erreur : toutes les lignes seront importées.' }
      : validRows > 0
        ? {
            severity: 'warning' as const,
            text: `Seules les ${formatCount(validRows)} lignes valides seront importées. Les ${formatCount(errorRows)} lignes en erreur seront ignorées : corrigez le fichier et déposez-le à nouveau pour les importer.`,
          }
        : { severity: 'warning' as const, text: 'Aucune ligne valide. Corrigez le fichier et déposez-le à nouveau.' }

  return (
    <Stack spacing={2}>
      <Typography variant="subtitle1" sx={{ fontWeight: 600, wordBreak: 'break-word' }}>
        {preview.fileName}
      </Typography>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={{ xs: 0.5, sm: 4 }}>
        <Typography>Lignes lues : {formatCount(totalRows)}</Typography>
        <Typography color="success.main">Lignes valides : {formatCount(validRows)}</Typography>
        <Typography color={errorRows > 0 ? 'error.main' : undefined}>Lignes en erreur : {formatCount(errorRows)}</Typography>
      </Stack>
      <Typography color="text.secondary">Rien n'a encore été enregistré.</Typography>
      <Alert severity={verdict.severity}>{verdict.text}</Alert>
      {errorRows > 0 && <ErrorsTable loadErrors={loadErrors} onExpired={onExpired} />}
    </Stack>
  )
}

/** rule-foundation-import-errors-paginated */
function ErrorsTable({ loadErrors, onExpired }: { loadErrors: PageLoader<ImportRowError>; onExpired: () => void }) {
  const list = usePagedList<ImportRowError>(loadErrors)
  const { state } = list
  const expired = state.status === 'error' && isExpired(state.failure)
  useEffect(() => {
    if (expired) onExpired()
  }, [expired, onExpired])

  return (
    <Box>
      <Typography variant="h6" component="h2" gutterBottom>
        Lignes en erreur
      </Typography>
      <Card variant="outlined">
        {state.status === 'loading' && (
          <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
            <CircularProgress aria-label="Chargement…" />
          </Box>
        )}
        {state.status === 'error' && !expired && (
          <Stack spacing={2} sx={{ p: 2, alignItems: 'flex-start' }}>
            <Alert severity="error" sx={{ alignSelf: 'stretch' }}>
              {failureMessage(state.failure, false)}
            </Alert>
            <Button variant="outlined" onClick={list.reload}>
              Réessayer
            </Button>
          </Stack>
        )}
        {state.status === 'ready' && (
          <>
            <TableContainer sx={{ maxHeight: 480 }}>
              <Table stickyHeader size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 600 }}>Ligne</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Colonne</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Raison</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {state.items.map((e, i) => (
                    <TableRow key={`${e.row}-${e.column}-${i}`}>
                      <TableCell>{e.row}</TableCell>
                      <TableCell>{e.column}</TableCell>
                      <TableCell>{e.reason}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
            <TablePagination
              component="div"
              count={state.total}
              page={list.page}
              rowsPerPage={list.size}
              rowsPerPageOptions={[10, 25, 50]}
              onPageChange={(_, p) => list.setPage(p)}
              onRowsPerPageChange={(e) => list.setSize(Number(e.target.value))}
            />
          </>
        )}
      </Card>
    </Box>
  )
}
