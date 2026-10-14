import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Button, Chip, MenuItem, Tab, TableCell, TableRow, Tabs, TextField, Tooltip, Typography } from '@mui/material'
import type { components } from '@recouvrement/api-client'
import { api } from '../../../shared/api'
import { AdminList } from '../../../shared/components/AdminList'
import { PageHeader } from '../../../shared/components/PageHeader'
import { formatDateTime } from '../../../shared/format'
import { useNotify } from '../../../shared/notify'
import { QUEUE_TYPES, queueDecisionLabel, queueTypeLabel } from '../../../shared/recouvrementLabels'
import { useCall } from '../../../shared/useCall'
import { usePagedList } from '../../../shared/usePagedList'
import { DecisionDialog, DecisionReview, type QueueItem } from '../components/DecisionDialog'

type Counts = components['schemas']['QueueCountsResponseDto']
type QueueType = (typeof QUEUE_TYPES)[number]

/**
 * File de décisions (supervisor). rule-recouvrement-screen-queue, rule-recouvrement-screen-queue-deep-link
 * (`?statut=` and `?type=`; an invalid value is ignored and removed from the address).
 */
export function DecisionQueuePage() {
  const call = useCall()
  const [params, setParams] = useSearchParams()
  const rawStatus = params.get('statut')
  const rawType = params.get('type')
  const status = rawStatus === 'decides' ? 'decided' : 'open'
  const type = QUEUE_TYPES.find((t) => t === rawType) ?? null

  useEffect(() => {
    const invalidStatus = rawStatus !== null && rawStatus !== 'ouverts' && rawStatus !== 'decides'
    const invalidType = rawType !== null && type === null
    if (!invalidStatus && !invalidType) return
    const next = new URLSearchParams(params)
    if (invalidStatus) next.delete('statut')
    if (invalidType) next.delete('type')
    setParams(next, { replace: true })
  }, [rawStatus, rawType, type, params, setParams])

  const [countsKey, setCountsKey] = useState(0)
  const [counts, setCounts] = useState<Counts | null>(null)
  useEffect(() => {
    let current = true
    void call(() => api.GET('/decision-queue/counts')).then((outcome) => {
      if (current && outcome.ok) setCounts(outcome.data)
    })
    return () => {
      current = false
    }
  }, [call, countsKey])

  const update = (key: string, value: string | null) => {
    const next = new URLSearchParams(params)
    if (value === null) next.delete(key)
    else next.set(key, value)
    setParams(next, { replace: true })
  }

  return (
    <>
      <PageHeader title="File de décisions" />
      <Tabs value={status} onChange={(_, v: string) => update('statut', v === 'decided' ? 'decides' : null)} aria-label="Statut des éléments" sx={{ mb: 2 }}>
        <Tab value="open" label={counts ? `Ouverts (${counts.total})` : 'Ouverts'} />
        <Tab value="decided" label="Décidés" />
      </Tabs>
      <TextField
        select
        label="Type"
        value={type ?? ''}
        onChange={(e) => update('type', e.target.value || null)}
        size="small"
        sx={{ mb: 2, minWidth: 300 }}
        slotProps={{ select: { displayEmpty: true } }}
      >
        <MenuItem value="">Tous</MenuItem>
        {QUEUE_TYPES.map((t) => (
          <MenuItem key={t} value={t}>
            {queueTypeLabel(t)}
            {counts ? ` (${counts.byType[t]})` : ''}
          </MenuItem>
        ))}
      </TextField>
      {/* Changing the status or the type restarts the list at its first page. */}
      <QueueList key={`${status}|${type ?? ''}`} status={status} type={type} onChanged={() => setCountsKey((n) => n + 1)} />
    </>
  )
}

function QueueList({ status, type, onChanged }: { status: 'open' | 'decided'; type: QueueType | null; onChanged: () => void }) {
  const call = useCall()
  const notify = useNotify()
  const list = usePagedList<QueueItem>(
    useCallback(
      async (from, size) => {
        const outcome = await call(() => api.GET('/decision-queue/items', { params: { query: { status, ...(type ? { type } : {}), from, size } } }))
        return outcome.ok ? { ok: true, data: { items: outcome.data.items, total: outcome.data.total } } : outcome
      },
      [call, status, type],
    ),
  )
  const { reload, setPage } = list
  const [selected, setSelected] = useState<QueueItem | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // After a reload the open dialog shows the fresh state of its item (the dialog « se recharge »).
  const listState = list.state
  const lastPage = Math.max(0, Math.ceil((listState.status === 'ready' ? listState.total : 0) / list.size) - 1)
  useEffect(() => {
    if (listState.status !== 'ready') return
    // the last item of the last page was decided: step back to the new last page instead of showing an empty one
    if (listState.items.length === 0 && listState.total > 0 && list.page > lastPage) setPage(lastPage)
    setSelected((s) => (s ? (listState.items.find((i) => i.id === s.id) ?? s) : s))
  }, [listState])

  const decide = async (decision: string, reason: string, invoiceId?: string) => {
    if (!selected) return
    setSubmitting(true)
    setError(null)
    const outcome = await call(() =>
      api.POST('/decision-queue/items/{id}/decision', {
        params: { path: { id: selected.id } },
        body: { decision, reason, ...(invoiceId ? { invoiceId } : {}) },
      }),
    )
    setSubmitting(false)
    if (outcome.ok) {
      setSelected(null)
      notify('Décision enregistrée.')
    } else {
      const { code, status: httpStatus } = outcome.failure
      if (code === 'queue.already_decided') {
        setSelected(null)
        notify('Cet élément a déjà été décidé. La liste a été rechargée.', 'warning')
      } else if (code === 'queue.decision_not_allowed') setError("Cette décision n'est pas permise pour cet élément.")
      else if (code === 'queue.invoice_not_open') setError("Cette facture n'est pas ouverte. Choisissez-en une autre.")
      else if (httpStatus === 400) setError('Données invalides. Vérifiez les champs.')
      else if (httpStatus === 403) setError('Action non autorisée.')
      else setError('Une erreur est survenue. Veuillez réessayer.')
      if (code !== 'queue.already_decided' && code !== 'queue.decision_not_allowed') return
    }
    reload()
    onChanged()
  }

  const open = status === 'open'
  const emptyText = type ? 'Aucun élément de ce type.' : open ? "Rien n'attend de décision." : 'Aucune décision enregistrée pour le moment.'
  const columns = open
    ? [{ label: 'Type' }, { label: 'Dossier' }, { label: 'Résumé' }, { label: 'Ouvert le' }, { label: 'Actions' }]
    : [{ label: 'Type' }, { label: 'Dossier' }, { label: 'Résumé' }, { label: 'Décision' }, { label: 'Décidé par' }, { label: 'Décidé le' }, { label: 'Actions' }]

  return (
    <>
      {list.state.status === 'ready' && list.state.total > 0 && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          {open ? 'Du plus ancien au plus récent.' : 'Du plus récent au plus ancien.'}
        </Typography>
      )}
      <AdminList
        list={list}
        columns={columns}
        emptyText={emptyText}
        renderRow={(item) => (
          <TableRow key={item.id} hover>
            <TableCell>
              <Chip size="small" label={queueTypeLabel(item.type)} />
            </TableCell>
            <TableCell>
              {item.caseId && item.debtorId ? (
                <Link to={`/dossiers/${item.caseId}`} aria-label={`Ouvrir le dossier ${item.debtorId}`}>
                  {item.debtorId}
                </Link>
              ) : (
                '—'
              )}
            </TableCell>
            <TableCell sx={{ maxWidth: 360 }}>
              <Tooltip title={item.summary}>
                <Typography noWrap variant="body2">
                  {item.summary}
                </Typography>
              </Tooltip>
            </TableCell>
            {open ? (
              <TableCell>{formatDateTime(item.createdAt)}</TableCell>
            ) : (
              <>
                <TableCell>{item.decision ? queueDecisionLabel(item.decision.code, item.type) : '—'}</TableCell>
                <TableCell>{item.decision ? (item.decision.decidedBy?.email ?? 'le système') : '—'}</TableCell>
                <TableCell>{item.decision ? formatDateTime(item.decision.decidedAt) : '—'}</TableCell>
              </>
            )}
            <TableCell>
              <Button
                size="small"
                variant="outlined"
                aria-label={`${open ? 'Décider' : 'Voir'} : ${item.summary}`}
                onClick={() => {
                  setError(null)
                  setSelected(item)
                }}
              >
                {open ? 'Décider' : 'Voir'}
              </Button>
            </TableCell>
          </TableRow>
        )}
      />
      {selected && open && (
        <DecisionDialog item={selected} submitting={submitting} error={error} onClose={() => setSelected(null)} onSubmit={(d, r, i) => void decide(d, r, i)} />
      )}
      {selected && !open && <DecisionReview item={selected} onClose={() => setSelected(null)} />}
    </>
  )
}
