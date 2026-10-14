import { useCallback, useEffect, useState } from 'react'
import { Box, FormControl, InputLabel, MenuItem, Select, TableCell, TableRow, Typography } from '@mui/material'
import { api } from '../../../shared/api'
import { AdminList } from '../../../shared/components/AdminList'
import { formatCount } from '../../../shared/import/importMessages'
import { formatDateTime } from '../../../shared/format'
import { importTypeLabel } from '../../../shared/recouvrementLabels'
import { useCall } from '../../../shared/useCall'
import { usePagedList } from '../../../shared/usePagedList'
import type { components } from '@recouvrement/api-client'
import type { RecoveryImportType } from '../hooks/useRecoveryImportApi'

type HistoryItem = components['schemas']['RecoveryImportHistoryItemDto']

const TYPES: RecoveryImportType[] = ['receivables', 'payments', 'disputes', 'contacts', 'documents']

/** « Historique des imports »; `reloadToken` changes after each green light (rule-recouvrement-import-reload-after-confirm). */
export function ImportHistory({ reloadToken }: { reloadToken: number }) {
  const call = useCall()
  const [type, setType] = useState<RecoveryImportType | 'all'>('all')
  const list = usePagedList<HistoryItem>(
    useCallback(
      async (from, size) => {
        const outcome = await call(() => api.GET('/recovery-imports/history', { params: { query: { from, size, ...(type === 'all' ? {} : { type }) } } }))
        return outcome.ok ? { ok: true, data: { items: outcome.data.items, total: outcome.data.total } } : outcome
      },
      [call, type],
    ),
  )
  const { reloadFirst } = list
  useEffect(() => {
    if (reloadToken > 0) reloadFirst()
  }, [reloadToken, reloadFirst])

  return (
    <Box component="section" aria-labelledby="import-history-title" sx={{ mt: 4 }}>
      <Typography id="import-history-title" variant="h5" component="h2" gutterBottom>
        Historique des imports
      </Typography>
      <FormControl size="small" sx={{ mb: 2, minWidth: 240 }}>
        <InputLabel id="history-type-label">Type de fichier</InputLabel>
        <Select
          labelId="history-type-label"
          label="Type de fichier"
          value={type}
          onChange={(e) => {
            setType(e.target.value as RecoveryImportType | 'all')
            reloadFirst()
          }}
        >
          <MenuItem value="all">Tous</MenuItem>
          {TYPES.map((t) => (
            <MenuItem key={t} value={t}>
              {importTypeLabel(t)}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
      <AdminList
        list={list}
        columns={[{ label: 'Date' }, { label: 'Fichier' }, { label: 'Type' }, { label: 'Confirmé par' }, { label: 'Lignes' }, { label: 'Importées' }, { label: 'Ignorées' }]}
        emptyText="Aucun import confirmé pour le moment."
        renderRow={(item) => (
          <TableRow key={item.importId}>
            <TableCell>{formatDateTime(item.confirmedAt)}</TableCell>
            <TableCell sx={{ overflowWrap: 'anywhere' }}>{item.fileName}</TableCell>
            <TableCell>{importTypeLabel(item.type)}</TableCell>
            <TableCell sx={{ overflowWrap: 'anywhere' }}>{item.confirmedBy.email}</TableCell>
            <TableCell>{formatCount(item.totalRows)}</TableCell>
            <TableCell>{formatCount(item.createdCount)}</TableCell>
            <TableCell>{formatCount(item.skippedCount)}</TableCell>
          </TableRow>
        )}
      />
    </Box>
  )
}
