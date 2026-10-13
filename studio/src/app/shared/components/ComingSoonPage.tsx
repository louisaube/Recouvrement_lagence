import { Typography } from '@mui/material'
import { PageHeader } from './PageHeader'

/**
 * Extension point: screens of later lots (journal d'audit, import) are registered behind the
 * administrator guard now, and replaced by their real page in their lot.
 */
export function ComingSoonPage({ title }: { title: string }) {
  return (
    <>
      <PageHeader title={title} />
      <Typography color="text.secondary">Cet écran n'est pas encore disponible.</Typography>
    </>
  )
}
