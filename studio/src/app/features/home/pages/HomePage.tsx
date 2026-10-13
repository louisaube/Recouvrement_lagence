import { Typography } from '@mui/material'
import { useSession } from '../../auth/hooks/useSession'

/** rule-foundation-home-welcome / rule-foundation-home-replaceable: provisional page, no API call. */
export function HomePage() {
  const { state } = useSession()
  if (state.status !== 'authenticated') return null
  return (
    <>
      <Typography variant="h4" component="h1" gutterBottom>
        Bienvenue
      </Typography>
      <Typography sx={{ overflowWrap: 'anywhere' }}>{state.user.email}</Typography>
    </>
  )
}
