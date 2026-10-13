import { Alert, Box, Button, CircularProgress, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from '@mui/material'
import type { ImportSpecification } from './importTypes'
import { formatCount, formatMegabytes } from './importMessages'

export type SpecState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; spec: ImportSpecification }

/** « Colonnes attendues »: shown once the specification has settled, so the size limit is known before any drop. */
export function ImportSpecPanel({ state, onRetry }: { state: SpecState; onRetry: () => void }) {
  if (state.status === 'loading') {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 2 }}>
        <CircularProgress size={24} aria-label="Chargement…" />
      </Box>
    )
  }
  return (
    <Box sx={{ mt: 3 }}>
      <Typography variant="h6" component="h2" gutterBottom>
        Colonnes attendues
      </Typography>
      {state.status === 'error' ? (
        <Stack spacing={1.5} sx={{ alignItems: 'flex-start' }}>
          <Alert severity="error" sx={{ alignSelf: 'stretch' }}>
            Impossible de charger les colonnes attendues.
          </Alert>
          <Button variant="outlined" onClick={onRetry}>
            Réessayer
          </Button>
        </Stack>
      ) : (
        <>
          <Typography color="text.secondary" sx={{ mb: 1.5 }}>
            La première ligne du fichier doit contenir les noms de colonnes ci-dessous. Formats acceptés : {state.spec.acceptedExtensions.join(' et ')}, maximum{' '}
            {formatMegabytes(state.spec.maxFileSizeBytes)} Mo et {formatCount(state.spec.maxRows)} lignes.
          </Typography>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 600 }}>Colonne</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Obligatoire</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Description</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {state.spec.columns.map((c) => (
                  <TableRow key={c.name}>
                    <TableCell>{c.name}</TableCell>
                    <TableCell>{c.required ? 'Oui' : 'Non'}</TableCell>
                    <TableCell>{c.description}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </>
      )}
    </Box>
  )
}
