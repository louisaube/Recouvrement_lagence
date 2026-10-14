import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import type { components } from '@recouvrement/api-client'
import { api } from '../../../shared/api'
import { AdminList } from '../../../shared/components/AdminList'
import { PageHeader } from '../../../shared/components/PageHeader'
import { formatBp, formatDate, formatDateTime, todayInParis } from '../../../shared/format'
import { useNotify } from '../../../shared/notify'
import { batchCheckLabel, batchStatusLabel, dailyActionLabel, exclusionReasonLabel } from '../../../shared/recouvrementLabels'
import { failureMessage, MESSAGE_GENERIC, useCall, type Failure } from '../../../shared/useCall'
import { usePagedList } from '../../../shared/usePagedList'
import { BatchOrders } from '../components/BatchOrders'
import { ReleaseDialog } from '../components/ReleaseDialog'

type Summary = components['schemas']['DailyBatchSummaryDto']
type Detail = components['schemas']['DailyBatchDetailDto']
type Share = components['schemas']['DecisionShareDto']

const STATUS_COLORS: Record<string, 'default' | 'success' | 'error'> = { ready: 'success', blocked: 'error', replaced: 'default' }
const SHARE_TYPES: Share['type'][] = ['none', 'reminder', 'proposal', 'transfer_proposed']

/** Mean, standard deviation and threshold are shown with one decimal (basis points → « 12,3 % »). */
function formatBpOneDecimal(bp: number | null): string {
  if (bp === null) return '—'
  const tenths = Math.round(Math.abs(bp) / 10)
  return `${bp < 0 ? '-' : ''}${Math.trunc(tenths / 10)},${tenths % 10} %`
}

function refusalText(failure: Failure): string {
  if (failure.code === 'batches.not_releasable') return 'Ce lot ne peut plus être libéré.'
  if (failure.code === 'batches.already_released') return 'Le lot du jour est déjà préparé.'
  return failureMessage(failure)
}

/**
 * Lot du jour (supervisor): preparation, checks, blocks, orders and reasoned release. A released batch is only marked
 * ready: nothing is ever sent (rule-recouvrement-screen-batch-no-send).
 * rule-recouvrement-screen-batch, rule-recouvrement-screen-batch-states (statuses come from the API, nothing is recomputed)
 */
export function DailyBatchPage() {
  const call = useCall()
  const notify = useNotify()
  const [params, setParams] = useSearchParams()
  const requested = params.get('lot')
  const [reloadKey, setReloadKey] = useState(0)
  const [preparing, setPreparing] = useState(false)
  const [prepareError, setPrepareError] = useState<Failure | null>(null)
  const [releaseDialog, setReleaseDialog] = useState(false)
  const [releasing, setReleasing] = useState(false)
  const [releaseError, setReleaseError] = useState<string | null>(null)

  // The batch of the day is the most recent one when its date is today's.
  const [latest, setLatest] = useState<{ status: 'loading' } | { status: 'error' } | { status: 'ready'; batch: Summary | null }>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let current = true
    void call(() => api.GET('/daily-batches', { params: { query: { from: 0, size: 1 } } })).then((outcome) => {
      if (!current) return
      setLatest(outcome.ok ? { status: 'ready', batch: outcome.data.items[0] ?? null } : { status: 'error' })
    })
    return () => {
      current = false
    }
  }, [call, reloadKey, attempt])

  const today = todayInParis()
  const todayBatch = latest.status === 'ready' && latest.batch?.date === today ? latest.batch : null
  const displayedId = requested ?? todayBatch?.id ?? null
  const viewingPast = requested !== null && requested !== todayBatch?.id

  const [detail, setDetail] = useState<{ status: 'idle' } | { status: 'loading' } | { status: 'error' } | { status: 'missing' } | { status: 'ready'; batch: Detail }>({ status: 'idle' })
  useEffect(() => {
    if (latest.status !== 'ready') return
    if (!displayedId) return setDetail({ status: 'idle' })
    let current = true
    setDetail({ status: 'loading' })
    void call(() => api.GET('/daily-batches/{id}', { params: { path: { id: displayedId } } })).then((outcome) => {
      if (!current) return
      if (outcome.ok) setDetail({ status: 'ready', batch: outcome.data.batch })
      else setDetail(outcome.failure.status === 404 || outcome.failure.status === 400 ? { status: 'missing' } : { status: 'error' })
    })
    return () => {
      current = false
    }
  }, [call, displayedId, latest.status, reloadKey])

  // An unknown batch identifier removes the parameter.
  useEffect(() => {
    if (detail.status === 'missing' && requested) setParams({}, { replace: true })
  }, [detail.status, requested, setParams])

  const history = usePagedList<Summary>(
    useCallback(
      async (from, size) => {
        const outcome = await call(() => api.GET('/daily-batches', { params: { query: { from, size } } }))
        return outcome.ok ? { ok: true, data: { items: outcome.data.items, total: outcome.data.total } } : outcome
      },
      [call],
    ),
  )
  const { reload: reloadHistory } = history

  const refresh = () => {
    setReloadKey((n) => n + 1)
    reloadHistory()
  }

  const prepare = async () => {
    setPreparing(true)
    setPrepareError(null)
    const outcome = await call(() => api.POST('/daily-batches'))
    setPreparing(false)
    if (outcome.ok) {
      const batch = outcome.data.batch
      if (batch.status === 'ready') notify('Lot du jour prêt.')
      else {
        const failed = batch.failedChecks
        const shareFailed = batch.checks.some((c) => c.code === 'decision_share' && c.status === 'failed')
        notify(`Le lot du jour est bloqué : ${failed} contrôle(s) en échec.${shareFailed ? ' Une alerte a été ajoutée à la file de décisions.' : ''}`, 'warning')
      }
      setParams({}, { replace: true })
      return refresh()
    }
    setPrepareError(outcome.failure)
    if (outcome.failure.code === 'batches.already_released') refresh()
  }

  const release = async (reason: string) => {
    if (detail.status !== 'ready') return
    setReleasing(true)
    setReleaseError(null)
    const outcome = await call(() => api.POST('/daily-batches/{id}/release', { params: { path: { id: detail.batch.id } }, body: { reason } }))
    setReleasing(false)
    if (outcome.ok) {
      setReleaseDialog(false)
      setPrepareError(null)
      notify('Lot libéré.')
      return refresh()
    }
    setReleaseError(refusalText(outcome.failure))
    if (outcome.failure.code === 'batches.not_releasable') {
      setReleaseDialog(false)
      setPrepareError(outcome.failure)
      refresh()
    }
  }

  const batch = detail.status === 'ready' ? detail.batch : null
  const prepareDisabled = preparing || (batch !== null && !viewingPast && batch.status === 'ready')

  return (
    <>
      <PageHeader title="Lot du jour">
        {viewingPast && (
          <Button variant="outlined" onClick={() => setParams({}, { replace: true })}>
            Revenir au lot du jour
          </Button>
        )}
        {!viewingPast && (
          <Button variant="contained" disabled={prepareDisabled} onClick={() => void prepare()}>
            {preparing ? 'Préparation en cours…' : 'Préparer le lot du jour'}
          </Button>
        )}
      </PageHeader>

      {prepareError &&
        (prepareError.code === 'batches.no_active_policy' ? (
          <Alert severity="error" sx={{ mb: 2 }}>
            Aucune version de politique n'est active. Activez-en une depuis l'écran <Link to="/politique">Politique</Link>.
          </Alert>
        ) : (
          <Alert severity="error" sx={{ mb: 2 }}>
            {refusalText(prepareError)}
          </Alert>
        ))}

      {latest.status === 'loading' && <CircularProgress aria-label="Chargement…" />}
      {latest.status === 'error' && (
        <Alert
          severity="error"
          sx={{ mb: 2 }}
          action={
            <Button color="inherit" size="small" onClick={() => setAttempt((n) => n + 1)}>
              Réessayer
            </Button>
          }
        >
          {MESSAGE_GENERIC}
        </Alert>
      )}

      {latest.status === 'ready' && (
        <Stack spacing={3}>
          {!batch && (detail.status === 'missing' || (detail.status === 'idle' && !displayedId)) && (
            <DayCard date={today} status={null} preparedBy={null} />
          )}
          {detail.status === 'loading' && <CircularProgress aria-label="Chargement…" />}
          {detail.status === 'error' && (
            <Alert
              severity="error"
              action={
                <Button color="inherit" size="small" onClick={() => setReloadKey((n) => n + 1)}>
                  Réessayer
                </Button>
              }
            >
              {MESSAGE_GENERIC}
            </Alert>
          )}
          {batch && (
            <>
              <DayCard date={batch.date} status={batch.status} preparedBy={batch.preparedBy.email} />
              {batch.status === 'blocked' && !viewingPast && (
                <Typography color="text.secondary">Une nouvelle préparation remplace le lot bloqué.</Typography>
              )}
              <ChecksSection batch={batch} />
              <SharesSection shares={batch.shares} />
              <ExcludedSection excluded={batch.excluded} />
              <BatchOrders key={batch.id} batchId={batch.id} />
              <ReleaseSection batch={batch} canRelease={!viewingPast} onRelease={() => { setReleaseError(null); setReleaseDialog(true) }} />
            </>
          )}

          <Box component="section" aria-labelledby="history-title">
            <Typography id="history-title" variant="h6" component="h2" sx={{ mb: 1 }}>
              Historique des lots
            </Typography>
            <AdminList
              list={history}
              columns={[{ label: 'Date' }, { label: 'Statut' }, { label: 'Dossiers' }, { label: 'Ordres' }, { label: 'Contrôles en échec' }, { label: 'Préparé par' }, { label: 'Actions' }]}
              emptyText="Aucun lot pour le moment."
              renderRow={(b) => (
                <TableRow key={b.id} selected={b.id === displayedId} sx={b.status === 'replaced' ? { color: 'text.disabled', '& td': { color: 'text.disabled' } } : undefined}>
                  <TableCell>{formatDate(b.date)}</TableCell>
                  <TableCell>
                    <Chip label={batchStatusLabel(b.status)} size="small" color={STATUS_COLORS[b.status] ?? 'default'} />
                  </TableCell>
                  <TableCell>{b.caseCount}</TableCell>
                  <TableCell>{b.orderCount}</TableCell>
                  <TableCell>{b.failedChecks}</TableCell>
                  <TableCell sx={{ overflowWrap: 'anywhere' }}>{b.preparedBy.email}</TableCell>
                  <TableCell>
                    <Button size="small" aria-label={`Ouvrir le lot du ${formatDate(b.date)}`} onClick={() => setParams({ lot: b.id }, { replace: true })}>
                      Ouvrir
                    </Button>
                  </TableCell>
                </TableRow>
              )}
            />
          </Box>
        </Stack>
      )}

      {releaseDialog && <ReleaseDialog submitting={releasing} error={releaseError} onClose={() => setReleaseDialog(false)} onSubmit={(reason) => void release(reason)} />}
    </>
  )
}

function DayCard({ date, status, preparedBy }: { date: string; status: Detail['status'] | null; preparedBy: string | null }) {
  return (
    <Card component="section" aria-labelledby="day-card-title">
      <CardContent>
        <Stack direction="row" spacing={2} sx={{ alignItems: 'center', flexWrap: 'wrap', mb: 1 }}>
          <Typography id="day-card-title" variant="h6" component="h2">
            {`Lot du ${formatDate(date)}`}
          </Typography>
          <Chip label={status ? batchStatusLabel(status) : 'Pas encore préparé'} size="small" color={status ? (STATUS_COLORS[status] ?? 'default') : 'default'} />
        </Stack>
        {preparedBy && <Typography>{`Préparé par ${preparedBy}`}</Typography>}
        <Typography color="text.secondary" variant="body2" sx={{ mt: 1 }}>
          Libéré, le lot est seulement marqué prêt : aucun envoi n'existe dans cette version.
        </Typography>
      </CardContent>
    </Card>
  )
}

function ChecksSection({ batch }: { batch: Detail }) {
  return (
    <Box component="section" aria-labelledby="checks-title">
      <Typography id="checks-title" variant="h6" component="h2" sx={{ mb: 1 }}>
        Contrôles
      </Typography>
      <Card>
        <Stack component="ul" divider={<Box sx={{ borderTop: 1, borderColor: 'divider' }} />} sx={{ listStyle: 'none', m: 0, p: 0 }}>
          {batch.checks.map((c) => {
            const failed = c.status === 'failed'
            return (
              <Box component="li" key={c.code} sx={{ p: 2 }}>
                <Stack direction="row" spacing={2} sx={{ justifyContent: 'space-between' }}>
                  <Typography color={failed ? 'error' : 'text.primary'} sx={{ fontWeight: failed ? 600 : 400 }}>
                    {batchCheckLabel(c.code)}
                  </Typography>
                  <Typography color={failed ? 'error' : 'success.main'}>{failed ? 'Échec' : 'Réussi'}</Typography>
                </Stack>
                {c.problems.length > 0 && (
                  <Box component="ul" sx={{ m: 0, mt: 1, pl: 2 }}>
                    {c.problems.map((p, i) => (
                      <Typography component="li" key={i} variant="body2" color={failed ? 'error' : 'text.secondary'} sx={{ overflowWrap: 'anywhere' }}>
                        {p}
                      </Typography>
                    ))}
                  </Box>
                )}
              </Box>
            )
          })}
        </Stack>
      </Card>
    </Box>
  )
}

function SharesSection({ shares }: { shares: Share[] }) {
  const ordered = SHARE_TYPES.map((t) => shares.find((s) => s.type === t)).filter((s): s is Share => s !== undefined)
  return (
    <Box component="section" aria-labelledby="shares-title">
      <Typography id="shares-title" variant="h6" component="h2" sx={{ mb: 1 }}>
        Parts par type de décision
      </Typography>
      <Card>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                {['Type', 'Dossiers', 'Part', 'Mode', 'Moyenne', 'Écart-type', 'Limite', 'État'].map((l) => (
                  <TableCell key={l} sx={{ fontWeight: 600 }}>
                    {l}
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {ordered.map((s) => {
                const fixed = s.mode === 'fixed_cap'
                return (
                  <TableRow key={s.type}>
                    <TableCell>{dailyActionLabel(s.type)}</TableCell>
                    <TableCell>{s.count}</TableCell>
                    <TableCell>{formatBp(s.shareBp)}</TableCell>
                    <TableCell>{fixed ? 'Plafond fixe' : 'Statistique'}</TableCell>
                    <TableCell>{fixed ? '—' : formatBpOneDecimal(s.meanBp)}</TableCell>
                    <TableCell>{fixed ? '—' : formatBpOneDecimal(s.sigmaBp)}</TableCell>
                    <TableCell>{fixed ? (s.capBp === null ? '—' : formatBp(s.capBp)) : formatBpOneDecimal(s.thresholdBp)}</TableCell>
                    <TableCell sx={s.exceeded ? { color: 'error.main', fontWeight: 600 } : undefined}>{s.exceeded ? 'Hors limite' : 'Dans la limite'}</TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>
    </Box>
  )
}

function ExcludedSection({ excluded }: { excluded: Detail['excluded'] }) {
  return (
    <Box component="section" aria-labelledby="excluded-title">
      <Typography id="excluded-title" variant="h6" component="h2" sx={{ mb: 1 }}>
        Dossiers exclus
      </Typography>
      <Card>
        {excluded.length === 0 ? (
          <Typography color="text.secondary" sx={{ p: 3 }}>
            Aucun dossier exclu.
          </Typography>
        ) : (
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 600 }}>Raison</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Nombre</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {excluded.map((e) => (
                  <TableRow key={e.reason}>
                    <TableCell>{exclusionReasonLabel(e.reason)}</TableCell>
                    <TableCell>{e.count}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Card>
    </Box>
  )
}

function ReleaseSection({ batch, canRelease, onRelease }: { batch: Detail; canRelease: boolean; onRelease: () => void }) {
  const released = batch.releasedBy && batch.releasedAt
  if (batch.status !== 'blocked' && !released) return null
  return (
    <Box component="section" aria-labelledby="release-title">
      <Typography id="release-title" variant="h6" component="h2" sx={{ mb: 1 }}>
        Libération
      </Typography>
      {released && (
        <Typography sx={{ overflowWrap: 'anywhere' }}>{`Libéré par ${batch.releasedBy?.email} le ${formatDateTime(batch.releasedAt ?? '')}. Motif : ${batch.releaseReason ?? '—'}`}</Typography>
      )}
      {batch.status === 'blocked' && canRelease && (
        <Button variant="outlined" color="warning" onClick={onRelease}>
          Libérer le lot malgré le blocage
        </Button>
      )}
    </Box>
  )
}
