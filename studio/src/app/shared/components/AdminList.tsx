import type { ReactNode } from 'react'
import { Alert, Box, Button, Card, CircularProgress, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TablePagination, TableRow, Typography } from '@mui/material'
import { failureMessage } from '../useCall'
import type { usePagedList } from '../usePagedList'

export interface Column {
  label: string
}

interface Props<T> {
  list: ReturnType<typeof usePagedList<T>>
  columns: Column[]
  emptyText: string
  /** One table row per item. */
  renderRow: (item: T) => ReactNode
}

/** Table card with the common list states: loading, error with « Réessayer », empty, pagination. */
export function AdminList<T>({ list, columns, emptyText, renderRow }: Props<T>) {
  const { state } = list
  return (
    <Card>
      {state.status === 'loading' && (
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
          <CircularProgress aria-label="Chargement…" />
        </Box>
      )}
      {state.status === 'error' && (
        <Stack spacing={2} sx={{ p: 2, alignItems: 'flex-start' }}>
          <Alert severity="error" sx={{ alignSelf: 'stretch' }}>
            {failureMessage(state.failure, false)}
          </Alert>
          <Button variant="outlined" onClick={list.reload}>
            Réessayer
          </Button>
        </Stack>
      )}
      {state.status === 'ready' && state.total === 0 && (
        <Typography color="text.secondary" sx={{ p: 3 }}>
          {emptyText}
        </Typography>
      )}
      {state.status === 'ready' && state.total > 0 && (
        <>
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  {columns.map((c) => (
                    <TableCell key={c.label} sx={{ fontWeight: 600 }}>
                      {c.label}
                    </TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>{state.items.map(renderRow)}</TableBody>
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
  )
}
