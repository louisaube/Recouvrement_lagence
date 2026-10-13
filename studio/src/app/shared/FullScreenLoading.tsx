import { Box, CircularProgress, Typography } from '@mui/material'

/** rule-foundation-no-protected-flash */
export function FullScreenLoading() {
  return (
    <Box sx={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2 }}>
      <CircularProgress aria-hidden />
      <Typography>Chargement…</Typography>
    </Box>
  )
}
