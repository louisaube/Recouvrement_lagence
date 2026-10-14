import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Box, Tab, Tabs, Typography } from '@mui/material'
import { api } from '../../../shared/api'
import { PageHeader } from '../../../shared/components/PageHeader'
import { formatDateTime } from '../../../shared/format'
import { useCall } from '../../../shared/useCall'
import { ImportHistory } from '../components/ImportHistory'
import { PolicyImportFlow } from '../components/PolicyImportFlow'
import { RecoveryImportTab } from '../components/RecoveryImportTab'
import { StatementBanner, type StatusState } from '../components/StatementBanner'
import type { RecoveryImportType } from '../hooks/useRecoveryImportApi'

type TabKey = 'creances' | 'paiements' | 'litiges' | 'interlocuteurs' | 'pieces' | 'politique'

const TABS: { key: TabKey; label: string; type?: RecoveryImportType }[] = [
  { key: 'creances', label: 'Créances', type: 'receivables' },
  { key: 'paiements', label: 'Paiements', type: 'payments' },
  { key: 'litiges', label: 'Litiges', type: 'disputes' },
  { key: 'interlocuteurs', label: 'Interlocuteurs', type: 'contacts' },
  { key: 'pieces', label: 'Pièces', type: 'documents' },
  { key: 'politique', label: 'Politique' },
]

/**
 * Imports (supervisor): six files, preview, errors, difference report, green light.
 * rule-recouvrement-screen-imports, rule-recouvrement-import-tab-reset, rule-recouvrement-import-reload-after-confirm
 */
export function ImportsPage() {
  const call = useCall()
  const [params, setParams] = useSearchParams()
  const requested = params.get('fichier')
  const active = TABS.find((t) => t.key === requested) ?? TABS[0]
  const [status, setStatus] = useState<StatusState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [confirmations, setConfirmations] = useState(0)

  useEffect(() => {
    let current = true
    void call(() => api.GET('/recovery-imports/status')).then((outcome) => {
      if (current) setStatus(outcome.ok ? { status: 'ready', value: outcome.data } : { status: 'error' })
    })
    return () => {
      current = false
    }
  }, [call, attempt])

  const onConfirmed = useCallback(() => {
    setAttempt((n) => n + 1)
    setConfirmations((n) => n + 1)
  }, [])

  const last = status.status === 'ready' && active.type ? status.value.lastConfirmed.find((l) => l.type === active.type) : undefined

  return (
    <>
      <PageHeader title="Imports" />
      <StatementBanner state={status} onRetry={() => setAttempt((n) => n + 1)} />
      <Tabs
        value={active.key}
        onChange={(_, key: TabKey) => setParams({ fichier: key }, { replace: true })}
        variant="scrollable"
        scrollButtons={false}
        aria-label="Fichiers à importer"
        sx={{ mb: 1 }}
      >
        {TABS.map((t) => (
          <Tab key={t.key} label={t.label} value={t.key} id={`import-tab-${t.key}`} aria-controls="import-panel" />
        ))}
      </Tabs>
      <Box id="import-panel" role="tabpanel" aria-labelledby={`import-tab-${active.key}`}>
        {active.type && status.status === 'ready' && (
          <Typography color="text.secondary" sx={{ mb: 2 }}>
            {last ? `Dernier import : ${formatDateTime(last.confirmedAt)}, ${last.fileName}` : 'Aucun import confirmé.'}
          </Typography>
        )}
        {active.type ? <RecoveryImportTab key={active.key} type={active.type} onConfirmed={onConfirmed} /> : <PolicyImportFlow key={active.key} />}
      </Box>
      <ImportHistory reloadToken={confirmations} />
    </>
  )
}
