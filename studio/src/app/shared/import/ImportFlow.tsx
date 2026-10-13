import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Alert, Box, Button, Card, LinearProgress, Stack, Step, StepLabel, Stepper, Typography, useMediaQuery, useTheme } from '@mui/material'
import { formatCount, analysisMessage, confirmMessage, isAlreadyImported, isExpired, precheck, DEFAULT_EXTENSIONS, MESSAGE_EXPIRED } from './importMessages'
import { ImportConfirmDialog } from './ImportConfirmDialog'
import { ImportDropZone } from './ImportDropZone'
import { ImportPreview } from './ImportPreview'
import { ImportSpecPanel, type SpecState } from './ImportSpecPanel'
import type { ImportApi, ImportConfirmation, ImportPreviewSummary, ImportRowError } from './importTypes'
import type { Failure } from '../useCall'
import type { PageLoader } from '../usePagedList'

interface Props {
  api: ImportApi
  /** Singular name of the created objects (« compte »). */
  noun: string
  exit: { label: string; to: string }
}

type Phase = { name: 'deposit' } | { name: 'analyzing' } | { name: 'preview'; preview: ImportPreviewSummary } | { name: 'done'; result: ImportConfirmation }

/**
 * Generic three-step import (dépôt, aperçu, confirmation), reusable by any feature: only the API
 * calls, the noun of the objects and the exit link change.
 */
export function ImportFlow({ api, noun, exit }: Props) {
  const theme = useTheme()
  const narrow = useMediaQuery(theme.breakpoints.down('sm'))
  const [spec, setSpec] = useState<SpecState>({ status: 'loading' })
  const [phase, setPhase] = useState<Phase>({ name: 'deposit' })
  const [notice, setNotice] = useState<string>()
  const [oneFileNote, setOneFileNote] = useState<string>()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [confirmFailure, setConfirmFailure] = useState<Failure>()

  const run = useRef(0)
  const abort = useRef<AbortController>()
  const sending = useRef(false)

  const loadSpec = useCallback(() => {
    setSpec({ status: 'loading' })
    void api.loadSpecification().then((outcome) => setSpec(outcome.ok ? { status: 'ready', spec: outcome.data } : { status: 'error' }))
  }, [api])
  useEffect(loadSpec, [loadSpec])

  const specification = spec.status === 'ready' ? spec.spec : undefined

  const backToDeposit = (message?: string) => {
    run.current++
    abort.current?.abort()
    setPhase({ name: 'deposit' })
    setNotice(message)
    setOneFileNote(undefined)
    setConfirmFailure(undefined)
    setDialogOpen(false)
  }

  const analyse = async (file: File, extra: boolean) => {
    const message = precheck(file, specification)
    setOneFileNote(extra ? `Un seul fichier à la fois : seul « ${file.name} » a été retenu.` : undefined)
    if (message) {
      setNotice(message)
      return
    }
    const id = ++run.current
    const controller = new AbortController()
    abort.current = controller
    setNotice(undefined)
    setPhase({ name: 'analyzing' })
    const outcome = await api.preview(file, controller.signal)
    if (id !== run.current) return // cancelled: a late answer is ignored
    if (outcome.ok) setPhase({ name: 'preview', preview: outcome.data })
    else {
      setPhase({ name: 'deposit' })
      setNotice(analysisMessage(outcome.failure, specification))
    }
  }

  const confirm = async (preview: ImportPreviewSummary) => {
    if (sending.current) return
    sending.current = true
    setSubmitting(true)
    setConfirmFailure(undefined)
    const outcome = await api.confirm(preview.importId)
    sending.current = false
    setSubmitting(false)
    setDialogOpen(false)
    if (outcome.ok) setPhase({ name: 'done', result: outcome.data })
    else setConfirmFailure(outcome.failure)
  }

  const loadErrors: PageLoader<ImportRowError> = useCallback(
    async (from, size) => {
      if (phase.name !== 'preview') return { ok: false, failure: { status: 0 } }
      return api.errors(phase.preview.importId, from, size)
    },
    [api, phase],
  )
  const expire = useCallback(() => backToDeposit(MESSAGE_EXPIRED), []) // eslint-disable-line react-hooks/exhaustive-deps

  const step = phase.name === 'done' || submitting ? 2 : phase.name === 'preview' ? 1 : 0
  const depositing = phase.name === 'deposit' || phase.name === 'analyzing'

  return (
    <Card sx={{ p: { xs: 2, sm: 3 } }}>
      <Stepper activeStep={step} orientation={narrow ? 'vertical' : 'horizontal'} sx={{ mb: 3 }}>
        {['Dépôt du fichier', 'Aperçu', 'Confirmation'].map((label) => (
          <Step key={label}>
            <StepLabel>{label}</StepLabel>
          </Step>
        ))}
      </Stepper>

      {oneFileNote && phase.name !== 'done' && (
        <Alert severity="info" sx={{ mb: 2 }}>
          {oneFileNote}
        </Alert>
      )}

      {depositing && (
        <>
          {notice && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {notice}
            </Alert>
          )}
          <ImportDropZone
            disabled={phase.name === 'analyzing'}
            accept={(specification?.acceptedExtensions ?? DEFAULT_EXTENSIONS).join(',')}
            onFile={(file, extra) => void analyse(file, extra)}
          />
          {phase.name === 'analyzing' && (
            <Stack spacing={1.5} sx={{ mt: 2, alignItems: 'flex-start' }}>
              <LinearProgress sx={{ alignSelf: 'stretch' }} />
              <Typography>Analyse du fichier en cours…</Typography>
              <Typography color="text.secondary">Pour un très gros fichier, cela peut prendre plusieurs minutes. Ne fermez pas cette page.</Typography>
              <Button variant="outlined" onClick={() => backToDeposit()}>
                Annuler
              </Button>
            </Stack>
          )}
          <ImportSpecPanel state={spec} onRetry={loadSpec} />
        </>
      )}

      {phase.name === 'preview' && (
        <Stack spacing={2}>
          {confirmFailure && (
            <Alert
              severity="error"
              action={
                isExpired(confirmFailure) || isAlreadyImported(confirmFailure) ? (
                  <Button color="inherit" size="small" onClick={() => backToDeposit()}>
                    Déposer un fichier
                  </Button>
                ) : (
                  <Button color="inherit" size="small" onClick={() => void confirm(phase.preview)}>
                    Réessayer
                  </Button>
                )
              }
            >
              {confirmMessage(confirmFailure)}
            </Alert>
          )}
          <ImportPreview preview={phase.preview} loadErrors={loadErrors} onExpired={expire} />
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
            <Button variant="contained" disabled={phase.preview.validRows === 0} onClick={() => setDialogOpen(true)}>
              {phase.preview.validRows === 0 ? 'Aucune ligne valide : rien à importer.' : `Importer ${formatCount(phase.preview.validRows)} ${noun}(s)`}
            </Button>
            <Button variant="outlined" onClick={() => backToDeposit()}>
              Choisir un autre fichier
            </Button>
          </Stack>
          {dialogOpen && (
            <ImportConfirmDialog
              noun={noun}
              validRows={phase.preview.validRows}
              errorRows={phase.preview.errorRows}
              submitting={submitting}
              onCancel={() => setDialogOpen(false)}
              onConfirm={() => void confirm(phase.preview)}
            />
          )}
        </Stack>
      )}

      {phase.name === 'done' && (
        <Stack spacing={2}>
          <Alert severity="success">{`${formatCount(phase.result.createdCount)} ${noun}(s) créé(s).`}</Alert>
          {phase.result.skippedCount > 0 && (
            <Alert severity="warning">
              {`${formatCount(phase.result.skippedCount)} ligne(s) valide(s) à l'aperçu n'ont pas pu être enregistrées (par exemple parce qu'un compte a été créé entre-temps).`}
            </Alert>
          )}
          <Box>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
              <Button variant="contained" onClick={() => backToDeposit()}>
                Importer un autre fichier
              </Button>
              <Button component={Link} to={exit.to} variant="outlined">
                {exit.label}
              </Button>
            </Stack>
          </Box>
        </Stack>
      )}
    </Card>
  )
}
