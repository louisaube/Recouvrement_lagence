import { useEffect, useState } from 'react'
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  FormLabel,
  Radio,
  RadioGroup,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableRow,
  TextField,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material'
import type { components } from '@recouvrement/api-client'
import { api } from '../../../shared/api'
import { formatDateTime, formatEuros } from '../../../shared/format'
import { queueDecisionLabel } from '../../../shared/recouvrementLabels'
import { useCall } from '../../../shared/useCall'

export type QueueItem = components['schemas']['QueueItemDto']
type Candidate = components['schemas']['QueueCandidateDto']

const MAX = 1000

interface Props {
  item: QueueItem
  submitting: boolean
  error: string | null
  onClose: () => void
  onSubmit: (decision: string, reason: string, invoiceId?: string) => void
}

function candidateLabel(c: Pick<Candidate, 'number' | 'creditorSiren' | 'balanceCents'>) {
  return `${c.number} · ${c.creditorSiren} · solde ${formatEuros(c.balanceCents)}`
}

/** Plain-text summary and details (rule-recouvrement-screen-queue-summary-plain: React escapes, nothing is rendered as HTML). */
function Header({ item }: { item: QueueItem }) {
  return (
    <>
      <Typography>{item.summary}</Typography>
      {item.details.length > 0 && (
        <Table size="small" aria-label="Détail">
          <TableBody>
            {item.details.map((d, i) => (
              <TableRow key={i}>
                <TableCell component="th" scope="row" sx={{ fontWeight: 600 }}>
                  {d.label}
                </TableCell>
                <TableCell>{d.value}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </>
  )
}

/** Read-only view of a decided item. */
export function DecisionReview({ item, onClose }: { item: QueueItem; onClose: () => void }) {
  const theme = useTheme()
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'))
  const d = item.decision
  return (
    <Dialog open fullScreen={fullScreen} fullWidth maxWidth="sm" onClose={onClose} aria-labelledby="queue-review-title">
      <DialogTitle id="queue-review-title">Décision</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Header item={item} />
          {d && (
            <>
              <Typography>Décision : {queueDecisionLabel(d.code, item.type)}</Typography>
              {d.reason && <Typography sx={{ whiteSpace: 'pre-wrap' }}>Motif : {d.reason}</Typography>}
              <Typography color="text.secondary">
                Décidé par {d.decidedBy ? d.decidedBy.email : 'le système'} le {formatDateTime(d.decidedAt)}
              </Typography>
            </>
          )}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose}>Fermer</Button>
      </DialogActions>
    </Dialog>
  )
}

/**
 * Decision dialog of an open item. rule-recouvrement-screen-queue (reasoned decision), rule-recouvrement-screen-queue-no-local-rules
 * (the options are `allowedDecisions`), rule-recouvrement-screen-queue-assign-needs-invoice, rule-recouvrement-queue-decision-motivated.
 */
export function DecisionDialog({ item, submitting, error, onClose, onSubmit }: Props) {
  const theme = useTheme()
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'))
  const call = useCall()
  const [decision, setDecision] = useState('')
  const [reason, setReason] = useState('')
  const [touched, setTouched] = useState(false)
  const [invoiceId, setInvoiceId] = useState('')
  const [query, setQuery] = useState('')
  const [found, setFound] = useState<Candidate[]>([])
  const [searchFailed, setSearchFailed] = useState(false)

  // The item is reloaded after a refusal: a decision no longer allowed is dropped.
  useEffect(() => {
    if (decision && !item.allowedDecisions.includes(decision)) setDecision('')
  }, [item.allowedDecisions, decision])

  // rule-recouvrement-screen-queue-assign-needs-invoice: an invoice is chosen for « assign » only.
  const needsInvoice = item.type === 'unassigned_payment' && decision === 'assign'

  const term = query.trim()
  useEffect(() => {
    if (!needsInvoice || term.length === 0) {
      setFound([])
      setSearchFailed(false)
      return
    }
    let current = true
    const timer = setTimeout(() => {
      void call(() => api.GET('/invoices', { params: { query: { number: term, from: 0, size: 10 } } })).then((outcome) => {
        if (!current) return
        setSearchFailed(!outcome.ok)
        setFound(
          outcome.ok
            ? outcome.data.items.map((i) => ({
                invoiceId: i.id,
                caseId: i.caseId,
                debtorId: i.debtorId,
                number: i.number,
                creditorSiren: i.creditorSiren,
                balanceCents: i.balanceCents,
              }))
            : [],
        )
      })
    }, 300)
    return () => {
      current = false
      clearTimeout(timer)
    }
  }, [call, needsInvoice, term])

  const options = [...item.candidates, ...found.filter((f) => !item.candidates.some((c) => c.invoiceId === f.invoiceId))]
  const trimmed = reason.trim()
  const reasonInvalid = trimmed.length === 0 || trimmed.length > MAX
  const canSave = decision !== '' && !reasonInvalid && (!needsInvoice || invoiceId !== '')

  return (
    <Dialog
      open
      fullScreen={fullScreen}
      fullWidth
      maxWidth="sm"
      onClose={() => {
        if (!submitting) onClose()
      }}
      aria-labelledby="queue-decision-title"
    >
      <form
        noValidate
        style={{ display: 'contents' }}
        onSubmit={(e) => {
          e.preventDefault()
          setTouched(true)
          if (canSave && !submitting) onSubmit(decision, trimmed, needsInvoice ? invoiceId : undefined)
        }}
      >
        <DialogTitle id="queue-decision-title">Décision</DialogTitle>
        <DialogContent>
          <Stack spacing={2.5} sx={{ pt: 1 }}>
            <Header item={item} />
            {error && <Alert severity="error">{error}</Alert>}
            <FormControl>
              <FormLabel id="queue-decision-label">Décision</FormLabel>
              <RadioGroup
                aria-labelledby="queue-decision-label"
                value={decision}
                onChange={(e) => {
                  setDecision(e.target.value)
                  setInvoiceId('')
                }}
              >
                {item.allowedDecisions.map((code) => (
                  <FormControlLabel key={code} value={code} control={<Radio />} label={queueDecisionLabel(code, item.type)} />
                ))}
              </RadioGroup>
            </FormControl>
            {needsInvoice && (
              <Stack spacing={1.5}>
                <TextField label="Rechercher une facture par numéro" value={query} onChange={(e) => setQuery(e.target.value)} slotProps={{ htmlInput: { maxLength: 50 } }} />
                {searchFailed && <Alert severity="error">La recherche a échoué. Veuillez réessayer.</Alert>}
                <FormControl>
                  <FormLabel id="queue-invoice-label">Facture à créditer</FormLabel>
                  <RadioGroup aria-labelledby="queue-invoice-label" value={invoiceId} onChange={(e) => setInvoiceId(e.target.value)}>
                    {options.map((c) => (
                      <FormControlLabel key={c.invoiceId} value={c.invoiceId} control={<Radio />} label={candidateLabel(c)} />
                    ))}
                  </RadioGroup>
                </FormControl>
              </Stack>
            )}
            <TextField
              label="Motif de la décision"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              onBlur={() => setTouched(true)}
              required
              multiline
              minRows={3}
              error={touched && reasonInvalid}
              helperText={
                touched && trimmed.length === 0
                  ? 'Le motif est obligatoire.'
                  : touched && trimmed.length > MAX
                    ? `Le motif ne peut pas dépasser ${MAX} caractères.`
                    : `${reason.length} / ${MAX}`
              }
              slotProps={{ htmlInput: { maxLength: MAX } }}
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={onClose} disabled={submitting}>
            Annuler
          </Button>
          <Button type="submit" variant="contained" disabled={submitting || !canSave}>
            {submitting ? 'Enregistrement…' : 'Enregistrer la décision'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}
