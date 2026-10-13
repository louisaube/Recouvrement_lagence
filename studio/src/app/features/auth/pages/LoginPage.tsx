import { useState, type FormEvent } from 'react'
import { Alert, Box, Button, Card, CardContent, TextField, Typography } from '@mui/material'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../../../shared/api'
import { FullScreenLoading } from '../../../shared/FullScreenLoading'
import { safeRedirect } from '../../../shared/safeRedirect'
import { useSession } from '../hooks/useSession'

const LOGIN_ERROR = 'Identifiants incorrects.'

/** rule-foundation-login-screen, -single-error, -submit-guard, -redirect-home, -already-connected */
export function LoginPage() {
  const { state, refresh } = useSession()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const destination = safeRedirect(params.get('redirection'))

  if (state.status === 'loading') return <FullScreenLoading />
  if (state.status === 'authenticated') return <Navigate to={destination} replace />

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (submitting) return
    const trimmed = email.trim()
    if (!trimmed || !password) {
      setError(true)
      return
    }
    setSubmitting(true)
    setError(false)
    try {
      const { response } = await api.POST('/auth/login', { body: { email: trimmed, password, returnToken: false } })
      if (!response.ok) throw new Error('login')
      // refresh() switches the session to "authenticated": the redirect above then applies.
      if (!(await refresh())) throw new Error('session')
    } catch {
      setError(true)
      setSubmitting(false)
    }
  }

  return (
    <Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'grey.100', p: 2 }}>
      <Card sx={{ width: '100%', maxWidth: 400 }}>
        <CardContent component="form" onSubmit={onSubmit} noValidate sx={{ display: 'flex', flexDirection: 'column', gap: 2, p: 3 }}>
          <Typography variant="overline" color="primary">
            Monappli
          </Typography>
          <Typography variant="h5" component="h1">
            Connexion
          </Typography>
          <TextField
            label="Adresse e-mail"
            type="text"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoFocus
            slotProps={{ htmlInput: { autoComplete: 'username' } }}
          />
          <TextField
            label="Mot de passe"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            slotProps={{ htmlInput: { autoComplete: 'current-password' } }}
          />
          {error && <Alert severity="error">{LOGIN_ERROR}</Alert>}
          <Button type="submit" variant="contained" disabled={submitting}>
            {submitting ? 'Connexion en cours…' : 'Se connecter'}
          </Button>
        </CardContent>
      </Card>
    </Box>
  )
}
