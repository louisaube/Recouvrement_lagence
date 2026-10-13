import type { ReactNode } from 'react'
import { Stack, Typography } from '@mui/material'

/** Page title on the left, actions on the right (below the title under 600 px). */
export function PageHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 3, justifyContent: 'space-between', alignItems: { xs: 'stretch', sm: 'center' } }}>
      <Typography variant="h4" component="h1">
        {title}
      </Typography>
      {children && (
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
          {children}
        </Stack>
      )}
    </Stack>
  )
}
