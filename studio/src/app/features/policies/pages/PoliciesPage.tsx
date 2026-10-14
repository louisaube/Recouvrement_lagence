import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  FormControl,
  InputLabel,
  List,
  ListItem,
  ListItemText,
  MenuItem,
  Select,
  Stack,
  TableCell,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material'
import type { components } from '@recouvrement/api-client'
import { api } from '../../../shared/api'
import { AdminList } from '../../../shared/components/AdminList'
import { PageHeader } from '../../../shared/components/PageHeader'
import { formatDate, formatDateTime } from '../../../shared/format'
import { checkLabel, policyStatusLabel } from '../../../shared/recouvrementLabels'
import { useNotify } from '../../../shared/notify'
import { failureMessage, MESSAGE_GENERIC, useCall, type Failure } from '../../../shared/useCall'
import { usePagedList } from '../../../shared/usePagedList'
import { PolicyDetail, type PolicyDetailData } from '../components/PolicyDetail'

type Version = components['schemas']['PolicyVersionDto']
type Status = components['schemas']['PolicyStatusDto']

const STATUS_COLORS: Record<string, 'default' | 'success' | 'info'> = { imported: 'info', active: 'success', superseded: 'default' }

function checksLabel(passed: boolean | null): string {
  return passed === null ? '—' : passed ? 'Tous réussis' : 'Au moins un échec'
}

/**
 * Politique (supervisor): versions, activation checks, witnesses, parameters, activation. No editor: a version is
 * imported from the Imports screen and never modified (rule-recouvrement-screen-policy-read-only).
 * rule-recouvrement-screen-policy, rule-recouvrement-screen-policy-activation-gate, rule-recouvrement-screen-policy-version-url
 */
export function PoliciesPage() {
  const call = useCall()
  const notify = useNotify()
  const [params, setParams] = useSearchParams()
  const requested = params.get('version')
  const [filter, setFilter] = useState<Status | 'all'>('all')
  const [reloadKey, setReloadKey] = useState(0)

  const list = usePagedList<Version>(
    useCallback(
      async (from, size) => {
        const outcome = await call(() => api.GET('/policy-versions', { params: { query: { from, size, ...(filter === 'all' ? {} : { status: filter }) } } }))
        return outcome.ok ? { ok: true, data: { items: outcome.data.items, total: outcome.data.total } } : outcome
      },
      [call, filter],
    ),
  )
  const { reload } = list

  // Banner: the active version; fallback of the detail: the most recent one.
  const [banner, setBanner] = useState<{ status: 'loading' } | { status: 'error' } | { status: 'ready'; active: Version | null; latest: Version | null }>({ status: 'loading' })
  useEffect(() => {
    let current = true
    void (async () => {
      const active = await call(() => api.GET('/policy-versions', { params: { query: { status: 'active', from: 0, size: 1 } } }))
      if (!active.ok) return current && setBanner({ status: 'error' })
      const activeVersion = active.data.items[0] ?? null
      let latest = activeVersion
      if (!activeVersion) {
        const any = await call(() => api.GET('/policy-versions', { params: { query: { from: 0, size: 1 } } }))
        if (!any.ok) return current && setBanner({ status: 'error' })
        latest = any.data.items[0] ?? null
      }
      if (current) setBanner({ status: 'ready', active: activeVersion, latest })
    })()
    return () => {
      current = false
    }
  }, [call, reloadKey])

  const displayedId = requested ?? (banner.status === 'ready' ? (banner.latest?.id ?? null) : null)

  const refresh = () => {
    reload()
    setReloadKey((n) => n + 1)
  }

  return (
    <>
      <PageHeader title="Politique">
        <Button component={Link} to="/imports?fichier=politique" variant="outlined">
          Importer une version
        </Button>
      </PageHeader>

      {banner.status === 'error' ? (
        <Alert
          severity="error"
          sx={{ mb: 2 }}
          action={
            <Button color="inherit" size="small" onClick={() => setReloadKey((n) => n + 1)}>
              Réessayer
            </Button>
          }
        >
          {MESSAGE_GENERIC}
        </Alert>
      ) : (
        banner.status === 'ready' &&
        (banner.active ? (
          <Alert severity="success" sx={{ mb: 2 }}>
            {`Version active : ${banner.active.label} (${formatDate(banner.active.versionDate)}), activée par ${banner.active.activatedBy?.email ?? '—'} le ${banner.active.activatedAt ? formatDate(banner.active.activatedAt) : '—'}.`}
          </Alert>
        ) : (
          <Alert severity="warning" sx={{ mb: 2 }}>
            Aucune version active : le cerveau ne peut décider aucun dossier.
          </Alert>
        ))
      )}

      <FormControl size="small" sx={{ mb: 2, minWidth: 200 }}>
        <InputLabel id="policy-status-label">Statut</InputLabel>
        <Select
          labelId="policy-status-label"
          label="Statut"
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value as Status | 'all')
            list.reloadFirst()
          }}
        >
          <MenuItem value="all">Tous</MenuItem>
          {(['imported', 'active', 'superseded'] as const).map((s) => (
            <MenuItem key={s} value={s}>
              {policyStatusLabel(s)}
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      <Box component="section" aria-label="Versions">
        <AdminList
          list={list}
          columns={[
            { label: 'Libellé' },
            { label: 'Date de version' },
            { label: 'Statut' },
            { label: 'Importée par' },
            { label: 'Importée le' },
            { label: 'Activée le' },
            { label: 'Contrôles' },
            { label: 'Actions' },
          ]}
          emptyText={filter === 'all' ? 'Aucune version de politique pour le moment. Importez-en une depuis l\'écran Imports.' : 'Aucune version pour ce statut.'}
          renderRow={(v) => (
            <TableRow key={v.id} selected={v.id === displayedId}>
              <TableCell sx={{ overflowWrap: 'anywhere' }}>{v.label}</TableCell>
              <TableCell>{formatDate(v.versionDate)}</TableCell>
              <TableCell>
                <Chip label={policyStatusLabel(v.status)} size="small" color={STATUS_COLORS[v.status] ?? 'default'} />
              </TableCell>
              <TableCell sx={{ overflowWrap: 'anywhere' }}>{v.importedBy.email}</TableCell>
              <TableCell>{formatDateTime(v.importedAt)}</TableCell>
              <TableCell>{v.activatedAt ? formatDateTime(v.activatedAt) : '—'}</TableCell>
              <TableCell>{checksLabel(v.checksPassed)}</TableCell>
              <TableCell>
                <Button size="small" aria-label={`Ouvrir la version ${v.label}`} onClick={() => setParams({ version: v.id }, { replace: true })}>
                  Ouvrir
                </Button>
              </TableCell>
            </TableRow>
          )}
        />
      </Box>
      {list.state.status === 'ready' && list.state.total === 0 && filter === 'all' && (
        <Button component={Link} to="/imports?fichier=politique" sx={{ mt: 2 }}>
          Importer une version
        </Button>
      )}

      {displayedId && (
        <Box sx={{ mt: 4 }}>
          <VersionPanel
            key={displayedId}
            id={displayedId}
            reloadKey={reloadKey}
            hasActive={banner.status === 'ready' && banner.active !== null}
            onMissing={() => setParams({}, { replace: true })}
            onActivated={() => {
              notify('Version activée.')
              refresh()
            }}
            onChanged={refresh}
          />
        </Box>
      )}
    </>
  )
}

function VersionPanel({
  id,
  reloadKey,
  hasActive,
  onMissing,
  onActivated,
  onChanged,
}: {
  id: string
  reloadKey: number
  hasActive: boolean
  onMissing: () => void
  onActivated: () => void
  onChanged: () => void
}) {
  const call = useCall()
  const [state, setState] = useState<{ status: 'loading' } | { status: 'error' } | { status: 'missing' } | { status: 'ready'; version: PolicyDetailData }>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [dialog, setDialog] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [refusal, setRefusal] = useState<Failure | null>(null)

  useEffect(() => {
    let current = true
    void call(() => api.GET('/policy-versions/{id}', { params: { path: { id } } })).then((outcome) => {
      if (!current) return
      if (outcome.ok) setState({ status: 'ready', version: outcome.data.version })
      // an identifier that is not even a uuid (400) is as unknown as one that matches no version (404)
      else setState(outcome.failure.status === 404 || outcome.failure.status === 400 ? { status: 'missing' } : { status: 'error' })
    })
    return () => {
      current = false
    }
  }, [call, id, attempt, reloadKey])

  // rule-recouvrement-screen-policy-version-url: an unknown identifier removes the parameter.
  useEffect(() => {
    if (state.status === 'missing') onMissing()
  }, [state.status, onMissing])

  const activate = async () => {
    setSubmitting(true)
    setRefusal(null)
    const outcome = await call(() => api.POST('/policy-versions/{id}/activate', { params: { path: { id } } }))
    setSubmitting(false)
    setDialog(false)
    if (outcome.ok) return onActivated()
    setRefusal(outcome.failure)
    if (outcome.failure.status === 409) onChanged()
  }

  if (state.status === 'loading') return <CircularProgress aria-label="Chargement…" />
  if (state.status === 'missing') return <Alert severity="warning">Cette version n'existe pas.</Alert>
  if (state.status === 'error') {
    return (
      <Alert
        severity="error"
        action={
          <Button color="inherit" size="small" onClick={() => setAttempt((n) => n + 1)}>
            Réessayer
          </Button>
        }
      >
        {MESSAGE_GENERIC}
      </Alert>
    )
  }

  const { version } = state
  const blocked = version.checks.some((c) => !c.passed)
  const message = refusal && refusalText(refusal)

  return (
    <Stack spacing={2}>
      {refusal && refusal.code === 'policies.activation_blocked' ? (
        <Alert severity="error">
          Activation refusée :
          <List dense disablePadding>
            {(refusal.details ?? []).map((d, i) => (
              <ListItem key={i} disableGutters>
                <ListItemText primary={`${checkLabel(d.path)} — ${d.reason}`} />
              </ListItem>
            ))}
          </List>
        </Alert>
      ) : (
        message && <Alert severity="error">{message}</Alert>
      )}
      <PolicyDetail
        version={version}
        actions={
          version.status === 'imported' ? (
            <Box>
              <Tooltip title={blocked ? "Un contrôle d'activation échoue." : ''}>
                <span>
                  <Button variant="contained" disabled={blocked} onClick={() => setDialog(true)}>
                    Activer cette version
                  </Button>
                </span>
              </Tooltip>
            </Box>
          ) : undefined
        }
      />
      {dialog && (
        <Dialog open onClose={submitting ? undefined : () => setDialog(false)} aria-labelledby="activate-title">
          <DialogTitle id="activate-title">{`Activer la version « ${version.label} » ?`}</DialogTitle>
          <DialogContent>
            <DialogContentText>
              {(hasActive ? 'Elle remplacera la version active actuelle.' : 'Elle deviendra la version active.') + " Cette action est tracée au journal d'audit."}
            </DialogContentText>
            {submitting && (
              <Typography color="text.secondary" sx={{ mt: 2 }}>
                Activation…
              </Typography>
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setDialog(false)} disabled={submitting}>
              Annuler
            </Button>
            <Button variant="contained" onClick={() => void activate()} disabled={submitting}>
              Activer
            </Button>
          </DialogActions>
        </Dialog>
      )}
    </Stack>
  )
}

function refusalText(failure: Failure): string {
  if (failure.code === 'policies.not_activatable') return 'Cette version ne peut plus être activée.'
  return failureMessage(failure)
}
