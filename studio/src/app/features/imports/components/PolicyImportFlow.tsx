import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Alert,
  Box,
  Button,
  Card,
  LinearProgress,
  List,
  ListItem,
  ListItemText,
  Stack,
  Step,
  StepLabel,
  Stepper,
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
import { formatDate } from '../../../shared/format'
import { ImportConfirmDialog } from '../../../shared/import/ImportConfirmDialog'
import { ImportDropZone } from '../../../shared/import/ImportDropZone'
import { fileBody } from '../../../shared/import/multipart'
import { checkLabel, dailyActionLabel } from '../../../shared/recouvrementLabels'
import { failureMessage, useCall, type Failure } from '../../../shared/useCall'

type Preview = components['schemas']['PolicyPreviewDto']
type Version = components['schemas']['PolicyVersionDto']

const MAX_BYTES = 2 * 1024 * 1024

const MESSAGES: Record<string, string> = {
  'policies.invalid_file_type': "Ce fichier n'est pas un fichier JSON valide.",
  'policies.file_too_large': 'Le fichier est trop volumineux (maximum 2 Mo).',
  'policies.already_imported': 'Cette version de politique a déjà été importée.',
  'policies.invalid_file': 'Ce fichier de politique est invalide : corrigez les erreurs et déposez-le à nouveau.',
  'policies.preview_not_found': "L'aperçu a expiré ou n'existe plus. Déposez à nouveau le fichier.",
}

function refusal(failure: Failure): string {
  if (failure.status === 413) return MESSAGES['policies.file_too_large']
  return (failure.code ? MESSAGES[failure.code] : undefined) ?? failureMessage(failure)
}

type Phase = { name: 'deposit' } | { name: 'analyzing' } | { name: 'preview'; preview: Preview } | { name: 'done'; version: Version }

/**
 * Policy tab of the Imports screen: the three steps of the foundation flow with the policy routes
 * (rule-recouvrement-import-policy-flow). The errors of the file are not paginated (100 at most).
 */
export function PolicyImportFlow() {
  const call = useCall()
  const [phase, setPhase] = useState<Phase>({ name: 'deposit' })
  const [notice, setNotice] = useState<string>()
  const [dialog, setDialog] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [confirmFailure, setConfirmFailure] = useState<Failure>()
  const run = useRef(0)
  const abort = useRef<AbortController>()
  const sending = useRef(false)

  const back = (message?: string) => {
    run.current++
    abort.current?.abort()
    setPhase({ name: 'deposit' })
    setNotice(message)
    setConfirmFailure(undefined)
    setDialog(false)
  }

  const analyse = async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.json')) return setNotice("Format non pris en charge. Déposez un fichier .json.")
    if (file.size === 0) return setNotice('Le fichier est vide.')
    if (file.size > MAX_BYTES) return setNotice(MESSAGES['policies.file_too_large'])
    const id = ++run.current
    const controller = new AbortController()
    abort.current = controller
    setNotice(undefined)
    setPhase({ name: 'analyzing' })
    const { bodySerializer, headers } = await fileBody(file)
    const outcome = await call(() => api.POST('/policy-versions/previews', { body: { file: '' }, bodySerializer, headers, signal: controller.signal }))
    if (id !== run.current) return
    if (outcome.ok) setPhase({ name: 'preview', preview: outcome.data })
    else {
      setPhase({ name: 'deposit' })
      setNotice(refusal(outcome.failure))
    }
  }

  const confirm = async (preview: Preview) => {
    if (sending.current) return
    sending.current = true
    setSubmitting(true)
    setConfirmFailure(undefined)
    const outcome = await call(() => api.POST('/policy-versions/previews/{previewId}/confirm', { params: { path: { previewId: preview.previewId } } }))
    sending.current = false
    setSubmitting(false)
    setDialog(false)
    if (outcome.ok) setPhase({ name: 'done', version: outcome.data.version })
    else setConfirmFailure(outcome.failure)
  }

  const step = phase.name === 'done' || submitting ? 2 : phase.name === 'preview' ? 1 : 0
  const depositing = phase.name === 'deposit' || phase.name === 'analyzing'

  return (
    <Card sx={{ p: { xs: 2, sm: 3 } }}>
      <Stepper activeStep={step} sx={{ mb: 3 }}>
        {['Dépôt du fichier', 'Aperçu', 'Confirmation'].map((label) => (
          <Step key={label}>
            <StepLabel>{label}</StepLabel>
          </Step>
        ))}
      </Stepper>

      {depositing && (
        <>
          {notice && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {notice}
            </Alert>
          )}
          <ImportDropZone disabled={phase.name === 'analyzing'} label="Glissez un fichier .json ici" accept=".json" onFile={(file) => void analyse(file)} />
          {phase.name === 'analyzing' && (
            <Stack spacing={1.5} sx={{ mt: 2, alignItems: 'flex-start' }}>
              <LinearProgress sx={{ alignSelf: 'stretch' }} />
              <Typography>Analyse du fichier en cours…</Typography>
              <Button variant="outlined" onClick={() => back()}>
                Annuler
              </Button>
            </Stack>
          )}
          <Typography color="text.secondary" sx={{ mt: 3 }}>
            Fichier JSON : décision JDM, paramètres et dossiers témoins (2 Mo au maximum).
          </Typography>
        </>
      )}

      {phase.name === 'preview' && (
        <Stack spacing={2}>
          {confirmFailure && (
            <Alert
              severity="error"
              action={
                confirmFailure.status === 409 || confirmFailure.status === 404 ? (
                  <Button color="inherit" size="small" onClick={() => back()}>
                    Déposer un fichier
                  </Button>
                ) : (
                  <Button color="inherit" size="small" onClick={() => void confirm(phase.preview)}>
                    Réessayer
                  </Button>
                )
              }
            >
              {refusal(confirmFailure)}
            </Alert>
          )}
          <PolicyPreview preview={phase.preview} />
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
            <Button variant="contained" disabled={!phase.preview.valid} onClick={() => setDialog(true)}>
              {phase.preview.valid ? 'Donner le feu vert' : 'Fichier invalide : rien à importer.'}
            </Button>
            <Button variant="outlined" onClick={() => back()}>
              Choisir un autre fichier
            </Button>
          </Stack>
          {dialog && (
            <ImportConfirmDialog
              noun="version"
              validRows={1}
              errorRows={0}
              title="Donner le feu vert"
              text={`La version « ${phase.preview.label ?? ''} » sera importée. Elle ne sera pas active. Cette action est tracée au journal d'audit.`}
              confirmLabel="Confirmer le feu vert"
              submitting={submitting}
              onCancel={() => setDialog(false)}
              onConfirm={() => void confirm(phase.preview)}
            />
          )}
        </Stack>
      )}

      {phase.name === 'done' && (
        <Stack spacing={2}>
          <Alert severity="success">{`Version « ${phase.version.label} » importée. Elle n'est pas encore active.`}</Alert>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
            <Button component={Link} to={`/politique?version=${phase.version.id}`} variant="contained">
              Ouvrir la version
            </Button>
            <Button variant="outlined" onClick={() => back()}>
              Importer un autre fichier
            </Button>
          </Stack>
        </Stack>
      )}
    </Card>
  )
}

function PolicyPreview({ preview }: { preview: Preview }) {
  const failing = preview.checks.some((c) => !c.passed)
  return (
    <Stack spacing={2}>
      {preview.valid && preview.label && (
        <Box>
          <Typography variant="subtitle1" sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>
            {`Version « ${preview.label} »${preview.versionDate ? ` du ${formatDate(preview.versionDate)}` : ''}`}
          </Typography>
          <Typography color="text.secondary">{`Empreinte : ${preview.fileHash.slice(0, 12)}`}</Typography>
        </Box>
      )}
      <Typography color="text.secondary">Rien n'a encore été enregistré.</Typography>

      {!preview.valid && (
        <Box component="section" aria-labelledby="policy-errors-title">
          <Typography id="policy-errors-title" variant="h6" component="h2" gutterBottom>
            Erreurs du fichier
          </Typography>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 600 }}>Chemin</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Raison</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {preview.errors.map((e, i) => (
                  <TableRow key={`${e.path}-${i}`}>
                    <TableCell sx={{ overflowWrap: 'anywhere' }}>{e.path}</TableCell>
                    <TableCell>{e.reason}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Box>
      )}

      {failing && (
        <Alert severity="warning">
          Des contrôles d'activation échouent : la version pourra être importée mais ne pourra pas être activée tant qu'ils échouent.
        </Alert>
      )}

      {preview.checks.length > 0 && (
        <Box component="section" aria-labelledby="policy-checks-title">
          <Typography id="policy-checks-title" variant="h6" component="h2">
            Contrôles d'activation
          </Typography>
          <List dense>
            {preview.checks.map((c) => (
              <ListItem key={c.code} sx={{ display: 'block' }}>
                <ListItemText primary={`${checkLabel(c.code)} : ${c.passed ? 'Réussi' : 'Échec'}`} slotProps={{ primary: { color: c.passed ? undefined : 'error' } }} />
                {!c.passed &&
                  c.problems.map((problem, i) => (
                    <Typography key={i} variant="body2" color="text.secondary" sx={{ pl: 2 }}>
                      {problem}
                    </Typography>
                  ))}
              </ListItem>
            ))}
          </List>
        </Box>
      )}

      {preview.witnesses.length > 0 && (
        <Box component="section" aria-labelledby="policy-witnesses-title">
          <Typography id="policy-witnesses-title" variant="h6" component="h2" gutterBottom>
            Dossiers témoins
          </Typography>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 600 }}>Identifiant</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Attendu</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Obtenu</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Résultat</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {preview.witnesses.map((w) => (
                  <TableRow key={w.id}>
                    <TableCell sx={{ overflowWrap: 'anywhere' }}>{w.id}</TableCell>
                    <TableCell>{`${dailyActionLabel(w.expected.action)} — ${w.expected.rule}`}</TableCell>
                    <TableCell>{w.obtained ? `${dailyActionLabel(w.obtained.action)} — ${w.obtained.rule}` : '—'}</TableCell>
                    <TableCell>{w.passed ? 'Conforme' : 'Écart'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Box>
      )}
    </Stack>
  )
}
