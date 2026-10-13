import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Alert, Autocomplete, Box, Button, Card, Chip, CircularProgress, FormControl, InputLabel, MenuItem, Select, Stack, TableCell, TableRow, TextField, Tooltip, Typography } from '@mui/material'
import { AdminList } from '../../../shared/components/AdminList'
import { PageHeader } from '../../../shared/components/PageHeader'
import { useNotify } from '../../../shared/notify'
import { actionOptionLabel, actionVerb, FILTER_KEYS, formatDateTime, hasActiveFilter, periodInverted, readFilters, validFilterValue, type FilterKey } from '../hooks/auditFilters'
import { useAuditFilterValues, useAuditList, type AuditEntry } from '../hooks/useAuditData'

const MESSAGE_PERIOD = 'La date de début doit précéder la date de fin.'

/** rule-foundation-audit-french-screen: read-only journal, filters carried by the address. */
export function JournalPage() {
  const notify = useNotify()
  const [params, setParams] = useSearchParams()
  const filters = useMemo(() => readFilters(params), [params])
  const values = useAuditFilterValues()
  const list = useAuditList(filters)
  const inverted = periodInverted(filters)
  const active = hasActiveFilter(filters)
  const loadingValues = values.state.status === 'loading'

  // The screen appears once the first page of entries is known, so that the title is never shown over an empty table.
  const [firstLoadDone, setFirstLoadDone] = useState(false)
  useEffect(() => {
    if (list.state.status !== 'loading' || inverted) setFirstLoadDone(true)
  }, [list.state.status, inverted])

  // rule-foundation-audit-url-sanitized: invalid address values are dropped from the address.
  useEffect(() => {
    const dirty = FILTER_KEYS.filter((k) => params.has(k) && !validFilterValue(k, params.get(k) ?? ''))
    if (dirty.length === 0) return
    const next = new URLSearchParams(params)
    dirty.forEach((k) => next.delete(k))
    setParams(next, { replace: true })
  }, [params, setParams])

  const change = (key: FilterKey, value: string, replace = false) => {
    const next = new URLSearchParams(params)
    if (value === '') next.delete(key)
    else next.set(key, value)
    setParams(next, { replace })
  }

  const reset = () => {
    const next = new URLSearchParams(params)
    FILTER_KEYS.forEach((k) => next.delete(k))
    setParams(next)
  }

  const copyLink = async () => {
    try {
      if (!navigator.clipboard) throw new Error('no clipboard')
      await navigator.clipboard.writeText(window.location.href)
      notify('Lien copié.')
    } catch {
      notify("Copie impossible. Copiez l'adresse depuis la barre du navigateur.", 'error')
    }
  }

  const known = values.state.status === 'ready' ? values.state.values : { actors: [], actions: [], objectTypes: [], scopes: [] }
  const actors = [...known.actors]
  if (filters.auteur && !actors.some((a) => a.id === filters.auteur)) actors.push({ id: filters.auteur, email: filters.auteur })
  const selectedActor = actors.find((a) => a.id === filters.auteur) ?? null

  // A valid value unknown to the lists stays applied and displayed.
  const choices = (current: string, items: string[]) => (current && !items.includes(current) ? [...items, current] : items)

  const select = (key: 'action' | 'type' | 'perimetre', label: string, all: string, items: string[], text: (v: string) => string) => (
    <FormControl fullWidth disabled={loadingValues}>
      <InputLabel id={`journal-${key}-label`} shrink>
        {label}
      </InputLabel>
      <Select labelId={`journal-${key}-label`} label={label} displayEmpty notched value={filters[key]} onChange={(e) => change(key, e.target.value)}>
        <MenuItem value="">{all}</MenuItem>
        {choices(filters[key], items).map((item) => (
          <MenuItem key={item} value={item}>
            {text(item)}
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  )

  const date = (key: 'du' | 'au', label: string) => (
    <TextField
      label={label}
      type="date"
      value={filters[key]}
      onChange={(e) => change(key, e.target.value, true)}
      disabled={loadingValues}
      error={inverted}
      helperText={inverted ? MESSAGE_PERIOD : undefined}
      slotProps={{ inputLabel: { shrink: true } }}
    />
  )

  if (!firstLoadDone) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 6 }}>
        <CircularProgress aria-label="Chargement…" />
      </Box>
    )
  }

  return (
    <>
      <PageHeader title="Journal d'audit">
        <Button variant="outlined" onClick={copyLink}>
          Copier le lien
        </Button>
      </PageHeader>

      <Card sx={{ p: 2, mb: 3 }}>
        {values.state.status === 'error' && (
          <Alert
            severity="warning"
            sx={{ mb: 2 }}
            action={
              <Button color="inherit" size="small" onClick={values.retry}>
                Réessayer
              </Button>
            }
          >
            Impossible de charger les valeurs des filtres.
          </Alert>
        )}
        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(3, 1fr)' } }}>
          <Autocomplete
            options={actors}
            value={selectedActor}
            disabled={loadingValues}
            getOptionLabel={(a) => a.email}
            getOptionKey={(a) => a.id}
            isOptionEqualToValue={(a, b) => a.id === b.id}
            noOptionsText="Aucun auteur"
            onChange={(_, a) => change('auteur', a?.id ?? '')}
            renderInput={(p) => <TextField {...p} label="Auteur" />}
          />
          {select('action', 'Action', 'Toutes', known.actions, actionOptionLabel)}
          {select('type', "Type d'objet", 'Tous', known.objectTypes, (v) => v)}
          {select('perimetre', 'Périmètre', 'Tous', known.scopes, (v) => v)}
          {date('du', 'Du')}
          {date('au', 'Au')}
        </Box>
        <Stack direction="row" sx={{ mt: 2 }}>
          <Button onClick={reset} disabled={!active}>
            Réinitialiser les filtres
          </Button>
        </Stack>
      </Card>

      {inverted ? (
        <Card>
          <Alert severity="error">{MESSAGE_PERIOD}</Alert>
        </Card>
      ) : (
        <AdminList
          list={list}
          columns={[{ label: 'Date' }, { label: 'Auteur' }, { label: 'Action' }, { label: 'Objet' }, { label: 'Périmètre' }, { label: 'Résumé' }]}
          emptyText={active ? 'Aucune entrée ne correspond à ces filtres.' : "Aucune action n'a encore été tracée."}
          renderRow={(entry) => <JournalRow key={entry.id} entry={entry} />}
        />
      )}
    </>
  )
}

function JournalRow({ entry }: { entry: AuditEntry }) {
  return (
    <TableRow>
      <TableCell sx={{ whiteSpace: 'nowrap' }}>
        <time dateTime={entry.occurredAt}>{formatDateTime(entry.occurredAt)}</time>
      </TableCell>
      <TableCell>{entry.actor.email}</TableCell>
      <TableCell>
        <Stack spacing={0.5} sx={{ alignItems: 'flex-start' }}>
          <Chip size="small" label={actionVerb(entry.action)} />
          <Typography variant="caption" color="text.secondary">
            {entry.action}
          </Typography>
        </Stack>
      </TableCell>
      <TableCell>
        <Typography variant="body2">{entry.objectType}</Typography>
        <Tooltip title={entry.objectId}>
          <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block', maxWidth: 180, fontFamily: 'monospace' }}>
            {entry.objectId}
          </Typography>
        </Tooltip>
      </TableCell>
      <TableCell>{entry.scope ?? '—'}</TableCell>
      <TableCell sx={{ minWidth: 240, overflowWrap: 'anywhere' }}>{entry.summary}</TableCell>
    </TableRow>
  )
}
