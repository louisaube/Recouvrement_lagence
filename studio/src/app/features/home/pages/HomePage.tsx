import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Alert, Box, Button, Card, CardActionArea, CardContent, CircularProgress, Typography } from '@mui/material'
import { api } from '../../../shared/api'
import { formatDate, todayInParis } from '../../../shared/format'
import { useCall, type Outcome } from '../../../shared/useCall'
import { useSession } from '../../auth/hooks/useSession'
import { useProfile } from '../../profiles/hooks/useProfile'

const CARD_GRID = { display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' } } as const

type CardState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; text: ReactNode; alert?: boolean }

interface RawResult<T> {
  data?: T
  error?: unknown
  response: Response
}

/** Routes of the next lots are not in the typed client yet; their answer is read defensively (an unavailable card says « Indisponible »). */
const untyped = api as unknown as { GET: (path: string, init?: unknown) => Promise<RawResult<unknown>> }

/** rule-recouvrement-home-by-profile: one counting read per card, reloadable on its own. */
function useCard(read: () => Promise<Outcome<ReactNode | { text: ReactNode; alert?: boolean }>>): [CardState, () => void] {
  const [state, setState] = useState<CardState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let current = true
    setState({ status: 'loading' })
    void read().then((outcome) => {
      if (!current) return
      if (!outcome.ok) return setState({ status: 'error' })
      const value = outcome.data
      const detailed = typeof value === 'object' && value !== null && 'text' in value
      setState({ status: 'ready', ...(detailed ? (value as { text: ReactNode; alert?: boolean }) : { text: value as ReactNode }) })
    })
    return () => {
      current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt])
  return [state, useCallback(() => setAttempt((n) => n + 1), [])]
}

function HomeCard({ title, to, state, retry }: { title: string; to: string; state?: CardState; retry?: () => void }) {
  if (state?.status === 'error') {
    return (
      <Card sx={{ height: '100%' }}>
        <CardContent>
          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
            {title}
          </Typography>
          <Typography color="text.secondary" sx={{ my: 1 }}>
            Indisponible
          </Typography>
          <Button variant="outlined" size="small" onClick={retry}>
            Réessayer
          </Button>
        </CardContent>
      </Card>
    )
  }
  return (
    <Card sx={{ height: '100%', ...(state?.status === 'ready' && state.alert ? { borderColor: 'warning.main', borderWidth: 2, borderStyle: 'solid' } : {}) }}>
      <CardActionArea component={Link} to={to} sx={{ height: '100%' }}>
        <CardContent>
          {state?.status === 'loading' ? (
            <>
              <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                {title}
              </Typography>
              <CircularProgress size={20} aria-label="Chargement…" />
            </>
          ) : (
            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
              {state ? (
                <>
                  {title}
                  {' : '}
                  {state.text}
                </>
              ) : (
                title
              )}
            </Typography>
          )}
        </CardContent>
      </CardActionArea>
    </Card>
  )
}

/** Reads a typed or untyped counting route into an outcome. */
function useRead() {
  const call = useCall()
  return useCallback(
    <T,>(fn: () => Promise<RawResult<T>>): Promise<Outcome<T>> => call(fn),
    [call],
  )
}

function QueueCard() {
  const read = useRead()
  const [state, retry] = useCard(async () => {
    const outcome = await read(() => api.GET('/decision-queue/counts'))
    return outcome.ok ? { ok: true, data: `${outcome.data.total} à traiter` } : outcome
  })
  return <HomeCard title="File de décisions" to="/file-de-decisions" state={state} retry={retry} />
}

function LedgerCard() {
  const read = useRead()
  const [state, retry] = useCard(async () => {
    const outcome = await read(() => untyped.GET('/ledger-outputs/counts') as Promise<RawResult<{ to_approve?: number }>>)
    return outcome.ok && typeof outcome.data.to_approve === 'number' ? { ok: true, data: `${outcome.data.to_approve} à approuver` } : { ok: false, failure: { status: 0 } }
  })
  return <HomeCard title="Sorties comptables" to="/sorties-comptables" state={state} retry={retry} />
}

const BATCH_LABELS: Record<string, string> = { blocked: 'Bloqué', ready: 'Prêt' }

/** The batch of today (Europe/Paris) is the latest one if its date is today; otherwise « Pas encore préparé ». */
function BatchCard() {
  const read = useRead()
  const [state, retry] = useCard(async () => {
    const outcome = await read(() => untyped.GET('/daily-batches', { params: { query: { from: 0, size: 1 } } }) as Promise<RawResult<{ items?: { date: string; status: string }[] }>>)
    if (!outcome.ok || !Array.isArray(outcome.data.items)) return { ok: false, failure: { status: 0 } }
    const latest = outcome.data.items[0]
    const label = latest && latest.date === todayInParis() ? (BATCH_LABELS[latest.status] ?? 'Pas encore préparé') : 'Pas encore préparé'
    return { ok: true, data: label }
  })
  return <HomeCard title="Lot du jour" to="/lot-du-jour" state={state} retry={retry} />
}

const STALE = 'Périmé ou absent : aucune offre ni aucun ordre d\'envoi'

function StatementCard() {
  const read = useRead()
  const [state, retry] = useCard(async () => {
    const outcome = await read(() => api.GET('/recovery-imports/status'))
    if (!outcome.ok) return outcome
    const { fresh, lastStatementDate } = outcome.data.statement
    return fresh && lastStatementDate
      ? { ok: true, data: `Frais (relevé du ${formatDate(lastStatementDate)})` }
      : { ok: true, data: { text: STALE, alert: true } }
  })
  return <HomeCard title="Relevé bancaire" to="/imports?fichier=paiements" state={state} retry={retry} />
}

function DisputesCard() {
  const read = useRead()
  const [state, retry] = useCard(async () => {
    const outcome = await read(() => api.GET('/disputes', { params: { query: { status: 'open', from: 0, size: 1 } } }))
    return outcome.ok ? { ok: true, data: String(outcome.data.total) } : outcome
  })
  return <HomeCard title="Litiges ouverts" to="/litiges" state={state} retry={retry} />
}

/** rule-foundation-home-welcome, rule-recouvrement-home-by-profile, rule-recouvrement-agent-no-screen */
export function HomePage() {
  const { state } = useSession()
  const { profile } = useProfile()
  if (state.status !== 'authenticated') return null
  return (
    <>
      <Typography variant="h4" component="h1" gutterBottom>
        Bienvenue
      </Typography>
      <Typography sx={{ overflowWrap: 'anywhere', mb: 3 }}>{state.user.email}</Typography>

      {profile === null && (
        <Alert severity="info">Aucun profil de recouvrement ne vous a été attribué. Contactez un administrateur.</Alert>
      )}
      {profile === 'agent' && <Alert severity="info">Ce compte est réservé aux agents : il n'a pas d'écran.</Alert>}

      {profile === 'supervisor' && (
        <Box component="section" aria-labelledby="home-todo">
          <Typography id="home-todo" variant="h6" component="h2" gutterBottom>
            À traiter
          </Typography>
          <Box sx={CARD_GRID}>
            <QueueCard />
            <LedgerCard />
            <BatchCard />
            <StatementCard />
          </Box>
        </Box>
      )}

      {profile === 'litigation' && (
        <Box sx={CARD_GRID}>
          <DisputesCard />
        </Box>
      )}

      {profile === 'indicators' && (
        <Box sx={CARD_GRID}>
          <HomeCard title="Indicateurs" to="/indicateurs" />
        </Box>
      )}
    </>
  )
}
