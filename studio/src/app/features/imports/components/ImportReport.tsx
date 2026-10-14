import { useCallback, useEffect, useState } from 'react'
import { Alert, Box, Button, Card, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TableCell, TableRow, Typography } from '@mui/material'
import type { components } from '@recouvrement/api-client'
import { api } from '../../../shared/api'
import { AdminList } from '../../../shared/components/AdminList'
import { formatCount } from '../../../shared/import/importMessages'
import { formatDate } from '../../../shared/format'
import { useCall } from '../../../shared/useCall'
import { usePagedList } from '../../../shared/usePagedList'
import type { RecoveryImportType } from '../hooks/useRecoveryImportApi'

type Report = components['schemas']['ImportReportDto']
type Category = components['schemas']['ImportReportCategoryDto']
type ReportItem = components['schemas']['ImportReportItemDto']

interface Props {
  type: RecoveryImportType
  importId: string
}

/**
 * « Rapport d'écarts »: read from the preview, before the green light (rule-recouvrement-import-report-before-green-light).
 * Texts come from the API and are shown as plain text (rule-recouvrement-ui-plain-text).
 */
export function ImportReport({ type, importId }: Props) {
  const call = useCall()
  const [state, setState] = useState<{ status: 'loading' } | { status: 'error' } | { status: 'ready'; report: Report }>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [detail, setDetail] = useState<{ code: Category; label: string } | null>(null)

  useEffect(() => {
    let current = true
    setState({ status: 'loading' })
    void call(() => api.GET('/recovery-imports/{type}/{importId}/report', { params: { path: { type, importId } } })).then((outcome) => {
      if (current) setState(outcome.ok ? { status: 'ready', report: outcome.data } : { status: 'error' })
    })
    return () => {
      current = false
    }
  }, [call, type, importId, attempt])

  return (
    <Box component="section" aria-labelledby="import-report-title">
      <Typography id="import-report-title" variant="h6" component="h2" gutterBottom>
        Rapport d'écarts
      </Typography>
      {state.status === 'loading' && <CircularProgress size={24} aria-label="Chargement…" />}
      {state.status === 'error' && (
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" onClick={() => setAttempt((n) => n + 1)}>
              Réessayer
            </Button>
          }
        >
          Impossible de charger le rapport d'écarts.
        </Alert>
      )}
      {state.status === 'ready' && (
        <Card variant="outlined" sx={{ p: 2 }}>
          <Stack spacing={1.5}>
            <Typography color="text.secondary">
              {state.report.previous
                ? `Comparé à l'import du ${formatDate(state.report.previous.confirmedAt)} (${state.report.previous.fileName})`
                : 'Aucun import précédent : tout est nouveau.'}
            </Typography>
            {state.report.categories.map((c) => (
              <Stack key={c.code} direction={{ xs: 'column', sm: 'row' }} spacing={{ xs: 0.5, sm: 3 }} sx={{ alignItems: { sm: 'center' } }}>
                <Typography sx={{ minWidth: 160, fontWeight: 600 }}>{c.label}</Typography>
                <Typography>{`${formatCount(c.rows)} ligne(s)`}</Typography>
                <Typography>{`${formatCount(c.cases)} dossier(s)`}</Typography>
                <Button size="small" variant="outlined" onClick={() => setDetail({ code: c.code, label: c.label })} sx={{ alignSelf: 'flex-start' }}>
                  {`Voir le détail : ${c.label}`}
                </Button>
              </Stack>
            ))}
            {state.report.notes.map((n) => (
              <Typography key={n.code} color="text.secondary">
                {`${n.label} : ${formatCount(n.count)}`}
              </Typography>
            ))}
          </Stack>
        </Card>
      )}
      {detail && <ReportItemsDialog type={type} importId={importId} category={detail.code} label={detail.label} onClose={() => setDetail(null)} />}
    </Box>
  )
}

function ReportItemsDialog({ type, importId, category, label, onClose }: Props & { category: Category; label: string; onClose: () => void }) {
  const call = useCall()
  const list = usePagedList<ReportItem>(
    useCallback(
      async (from, size) => {
        const outcome = await call(() => api.GET('/recovery-imports/{type}/{importId}/report/items', { params: { path: { type, importId }, query: { category, from, size } } }))
        return outcome.ok ? { ok: true, data: { items: outcome.data.items, total: outcome.data.total } } : outcome
      },
      [call, type, importId, category],
    ),
  )
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="md" aria-labelledby="report-items-title">
      <DialogTitle id="report-items-title">{label}</DialogTitle>
      <DialogContent>
        <AdminList
          list={list}
          columns={[{ label: 'Clé' }, { label: 'Débiteur' }, { label: 'Détail' }]}
          emptyText="Aucun élément."
          renderRow={(item) => (
            <TableRow key={item.key}>
              <TableCell>{item.key}</TableCell>
              <TableCell>{item.debtorId ?? '—'}</TableCell>
              <TableCell>{item.detail}</TableCell>
            </TableRow>
          )}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Fermer</Button>
      </DialogActions>
    </Dialog>
  )
}
