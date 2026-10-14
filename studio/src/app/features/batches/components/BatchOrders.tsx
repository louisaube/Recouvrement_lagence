import { useCallback, useState } from 'react'
import { Link } from 'react-router-dom'
import { Box, Chip, FormControl, InputLabel, MenuItem, Select, Stack, TableCell, TableRow, Typography } from '@mui/material'
import type { components } from '@recouvrement/api-client'
import { api } from '../../../shared/api'
import { AdminList } from '../../../shared/components/AdminList'
import { channelLabel, interlocutorRoleLabel, orderStatusLabel, orderTypeLabel } from '../../../shared/recouvrementLabels'
import { useCall } from '../../../shared/useCall'
import { usePagedList } from '../../../shared/usePagedList'

type Order = components['schemas']['OrderDto']
type OrderType = components['schemas']['OrderTypeDto']
type Channel = components['schemas']['OrderChannelDto']

const STATUS_COLORS: Record<string, 'default' | 'success' | 'error'> = { planned: 'success', blocked: 'error', cancelled: 'default' }

/**
 * Orders of a batch as structured data: customer, interlocutor, channel, conditions. No drafted text is ever shown
 * (rule-recouvrement-screen-batch-no-text); each order links to its case (rule-recouvrement-screen-batch-link-case).
 */
export function BatchOrders({ batchId }: { batchId: string }) {
  const call = useCall()
  const [type, setType] = useState<OrderType | 'all'>('all')
  const [channel, setChannel] = useState<Channel | 'all'>('all')

  const list = usePagedList<Order>(
    useCallback(
      async (from, size) => {
        const outcome = await call(() =>
          api.GET('/daily-batches/{id}/orders', {
            params: {
              path: { id: batchId },
              query: { from, size, ...(type === 'all' ? {} : { type }), ...(channel === 'all' ? {} : { channel }) },
            },
          }),
        )
        return outcome.ok ? { ok: true, data: { items: outcome.data.items, total: outcome.data.total } } : outcome
      },
      [call, batchId, type, channel],
    ),
  )

  return (
    <Box component="section" aria-labelledby="orders-title">
      <Typography id="orders-title" variant="h6" component="h2" sx={{ mb: 1 }}>
        Ordres d'envoi
      </Typography>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 2 }}>
        <FormControl size="small" sx={{ minWidth: 220 }}>
          <InputLabel id="orders-type-label">Type</InputLabel>
          <Select
            labelId="orders-type-label"
            label="Type"
            value={type}
            onChange={(e) => {
              setType(e.target.value as OrderType | 'all')
              list.setPage(0)
            }}
          >
            <MenuItem value="all">Tous</MenuItem>
            {(['reminder', 'proposal', 'commitment_confirmation'] as const).map((t) => (
              <MenuItem key={t} value={t}>
                {orderTypeLabel(t)}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 200 }}>
          <InputLabel id="orders-channel-label">Canal</InputLabel>
          <Select
            labelId="orders-channel-label"
            label="Canal"
            value={channel}
            onChange={(e) => {
              setChannel(e.target.value as Channel | 'all')
              list.setPage(0)
            }}
          >
            <MenuItem value="all">Tous</MenuItem>
            {(['voice', 'email_sms', 'mail'] as const).map((c) => (
              <MenuItem key={c} value={c}>
                {channelLabel(c)}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </Stack>
      <AdminList
        list={list}
        columns={[{ label: 'Dossier' }, { label: 'Interlocuteur' }, { label: 'Canal' }, { label: 'Type' }, { label: 'Conditions' }, { label: 'Statut' }]}
        emptyText="Aucun ordre dans ce lot."
        renderRow={(o) => (
          <TableRow key={o.id}>
            <TableCell sx={{ overflowWrap: 'anywhere' }}>
              <Link to={`/dossiers/${o.caseId}`} aria-label={`Ouvrir le dossier ${o.debtorId}`}>
                {o.debtorId}
              </Link>
            </TableCell>
            <TableCell>{interlocutorRoleLabel(o.interlocutorRole)}</TableCell>
            <TableCell>{channelLabel(o.channel)}</TableCell>
            <TableCell>{orderTypeLabel(o.type)}</TableCell>
            <TableCell>
              {o.conditions.length === 0 ? (
                '—'
              ) : (
                <Box component="ul" sx={{ m: 0, pl: 2 }}>
                  {o.conditions.map((c, i) => (
                    <li key={i}>{`${c.name} : ${c.value}`}</li>
                  ))}
                </Box>
              )}
            </TableCell>
            <TableCell>
              <Chip label={orderStatusLabel(o.status)} size="small" color={STATUS_COLORS[o.status] ?? 'default'} />
              {o.blockReason && (
                <Typography variant="caption" display="block" color="error">
                  {o.blockReason}
                </Typography>
              )}
            </TableCell>
          </TableRow>
        )}
      />
    </Box>
  )
}
