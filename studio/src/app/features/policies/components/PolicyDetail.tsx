import { Fragment, useState } from 'react'
import {
  Box,
  Card,
  Collapse,
  IconButton,
  List,
  ListItem,
  ListItemText,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material'
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline'
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline'
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown'
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp'
import type { components } from '@recouvrement/api-client'
import { formatBp, formatDate, formatDateTime, formatEuros } from '../../../shared/format'
import { formatCount } from '../../../shared/import/importMessages'
import { checkLabel, dailyActionLabel, documentLabel, natureLabel, nextStepLabel, policyStatusLabel } from '../../../shared/recouvrementLabels'

export type PolicyDetailData = components['schemas']['PolicyVersionDetailDto']
type Rule = components['schemas']['PolicyRuleDto']
type Rung = components['schemas']['PolicyRungDto']

const head = { fontWeight: 600 } as const

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <Box component="section" aria-labelledby={id}>
      <Typography id={id} variant="h6" component="h2" gutterBottom>
        {title}
      </Typography>
      {children}
    </Box>
  )
}

function counterpart(c: Rung['counterpart']): string {
  if (!c) return 'Aucune'
  if (c.type === 'firm_date') return `Date ferme dans ${c.deadlineDays ?? '—'} jours`
  if (c.type === 'first_payment') return `Premier versement de ${c.firstPaymentBp == null ? '—' : formatBp(c.firstPaymentBp)}`
  return 'Prélèvement'
}

/** rule-recouvrement-screen-policy, rule-recouvrement-screen-policy-identified, rule-recouvrement-screen-policy-percent */
export function PolicyDetail({ version, actions }: { version: PolicyDetailData; actions?: React.ReactNode }) {
  const { global: g } = version
  return (
    <Stack spacing={3}>
      <Card sx={{ p: 2 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ justifyContent: 'space-between' }}>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="h5" component="h2" sx={{ overflowWrap: 'anywhere' }}>{`Version « ${version.label} »`}</Typography>
            <Typography color="text.secondary">{policyStatusLabel(version.status)}</Typography>
            <Box component="dl" sx={{ m: 0, mt: 1, display: 'grid', gridTemplateColumns: 'auto 1fr', columnGap: 2, rowGap: 0.5 }}>
              <dt>Date de version</dt>
              <dd style={{ margin: 0 }}>{formatDate(version.versionDate)}</dd>
              <dt>Empreinte du fichier</dt>
              <dd style={{ margin: 0 }}>
                <Tooltip title={version.fileHash}>
                  <span>{version.fileHash.slice(0, 12)}</span>
                </Tooltip>
              </dd>
              <dt>Importée par</dt>
              <dd style={{ margin: 0, overflowWrap: 'anywhere' }}>{`${version.importedBy.email} le ${formatDateTime(version.importedAt)}`}</dd>
              <dt>Activée par</dt>
              <dd style={{ margin: 0, overflowWrap: 'anywhere' }}>{version.activatedBy && version.activatedAt ? `${version.activatedBy.email} le ${formatDateTime(version.activatedAt)}` : '—'}</dd>
            </Box>
          </Box>
          {actions}
        </Stack>
      </Card>

      <Section id="policy-checks" title="Contrôles d'activation">
        <List dense disablePadding>
          {version.checks.map((c) => (
            <ListItem key={c.code} sx={{ display: 'block' }}>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                {c.passed ? <CheckCircleOutlineIcon color="success" fontSize="small" aria-hidden /> : <ErrorOutlineIcon color="error" fontSize="small" aria-hidden />}
                <ListItemText primary={`${checkLabel(c.code)} : ${c.passed ? 'Réussi' : 'Échec'}`} sx={{ m: 0 }} />
              </Stack>
              {!c.passed && (
                <List dense disablePadding sx={{ pl: 4 }}>
                  {c.problems.map((p, i) => (
                    <ListItem key={i} disableGutters>
                      <ListItemText primary={p} slotProps={{ primary: { color: 'text.secondary', variant: 'body2' } }} />
                    </ListItem>
                  ))}
                </List>
              )}
            </ListItem>
          ))}
        </List>
      </Section>

      <Section id="policy-witnesses" title="Dossiers témoins">
        <TableContainer component={Card} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={head}>Identifiant</TableCell>
                <TableCell sx={head}>Description</TableCell>
                <TableCell sx={head}>Attendu</TableCell>
                <TableCell sx={head}>Obtenu</TableCell>
                <TableCell sx={head}>Résultat</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {version.witnesses.map((w) => (
                <TableRow key={w.id}>
                  <TableCell sx={{ overflowWrap: 'anywhere' }}>{w.id}</TableCell>
                  <TableCell>{w.description}</TableCell>
                  <TableCell>{`${dailyActionLabel(w.expected.action)} — ${w.expected.rule}`}</TableCell>
                  <TableCell>{w.obtained ? `${dailyActionLabel(w.obtained.action)} — ${w.obtained.rule}` : '—'}</TableCell>
                  <TableCell>{w.passed ? 'Conforme' : 'Écart'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Section>

      <Section id="policy-global" title="Paramètres généraux">
        <Card variant="outlined" sx={{ p: 2 }}>
          <Box component="dl" sx={{ m: 0, display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'minmax(220px, auto) 1fr' }, columnGap: 3, rowGap: 1 }}>
            <dt>Fraîcheur maximale du relevé (jours)</dt>
            <dd style={{ margin: 0 }}>{formatCount(g.statementMaxAgeDays)}</dd>
            <dt>Imports avant écart d'une sortie comptable</dt>
            <dd style={{ margin: 0 }}>{formatCount(g.ledgerMaxImports)}</dd>
            <dt>Taille de l'échantillon de relecture</dt>
            <dd style={{ margin: 0 }}>{formatCount(g.reviewSampleSize)}</dd>
            <dt>Moyens de paiement</dt>
            <dd style={{ margin: 0 }}>{g.paymentMethods.join(', ')}</dd>
            <dt>Plafonds de part par type de décision</dt>
            <dd style={{ margin: 0 }}>
              {Object.entries(g.decisionTypeCapsBp)
                .map(([type, bp]) => `${dailyActionLabel(type)} : ${formatBp(bp)}`)
                .join(' · ')}
            </dd>
          </Box>
          <Typography component="h3" variant="subtitle1" sx={{ fontWeight: 600, mt: 2, mb: 1 }}>
            Plafonds d'encours sous échéancier
          </Typography>
          {g.exposureCeilings.length === 0 ? (
            <Typography color="text.secondary">Aucun plafond.</Typography>
          ) : (
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sx={head}>Version d'agent</TableCell>
                    <TableCell sx={head}>Segment</TableCell>
                    <TableCell sx={head}>Plafond</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {g.exposureCeilings.map((c, i) => (
                    <TableRow key={i}>
                      <TableCell>{c.agentVersion}</TableCell>
                      <TableCell>{c.segment}</TableCell>
                      <TableCell>{formatEuros(c.maxCents)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </Card>
      </Section>

      <Section id="policy-rules" title="Règles par segment et nature">
        <TableContainer component={Card} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell />
                <TableCell sx={head}>Segment</TableCell>
                <TableCell sx={head}>Nature</TableCell>
                <TableCell sx={head}>Horizon (jours)</TableCell>
                <TableCell sx={head}>Étape suivante</TableCell>
                <TableCell sx={head}>Plancher</TableCell>
                <TableCell sx={head}>Offres dans l'échelle</TableCell>
                <TableCell sx={head}>Durée maximale d'un échéancier (jours)</TableCell>
                <TableCell sx={head}>Seuil de montant</TableCell>
                <TableCell sx={head}>Pièces exigées</TableCell>
                <TableCell sx={head}>Prescription</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {version.rules.map((rule) => (
                <RuleRow key={`${rule.segment}/${rule.nature}`} rule={rule} />
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Section>
    </Stack>
  )
}

function RuleRow({ rule }: { rule: Rule }) {
  const [open, setOpen] = useState(false)
  const title = `Échelle d'offres : ${rule.segment} · ${natureLabel(rule.nature)}`
  const from = rule.limitation.startsFrom === 'invoice_date' ? 'la date de facture' : "l'échéance"
  return (
    <Fragment>
      <TableRow>
        <TableCell>
          <IconButton size="small" aria-label={title} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            {open ? <KeyboardArrowUpIcon /> : <KeyboardArrowDownIcon />}
          </IconButton>
        </TableCell>
        <TableCell>{rule.segment}</TableCell>
        <TableCell>{natureLabel(rule.nature)}</TableCell>
        <TableCell>{formatCount(rule.horizonDays)}</TableCell>
        <TableCell>{nextStepLabel(rule.nextStep.kind)}</TableCell>
        <TableCell>{formatBp(rule.nextStep.expectedValueBp)}</TableCell>
        <TableCell>{formatCount(rule.ladder.length)}</TableCell>
        <TableCell>{formatCount(rule.maxScheduleDays)}</TableCell>
        <TableCell>{formatEuros(rule.thresholdCents)}</TableCell>
        <TableCell>{rule.requiredDocuments.length === 0 ? '—' : rule.requiredDocuments.map(documentLabel).join(', ')}</TableCell>
        <TableCell>{`${formatCount(rule.limitation.delayDays)} jours depuis ${from}, alerte ${formatCount(rule.limitation.alertDays)} jours avant`}</TableCell>
      </TableRow>
      <TableRow>
        <TableCell colSpan={11} sx={{ py: 0, borderBottom: open ? undefined : 'none' }}>
          <Collapse in={open} unmountOnExit>
            <Box sx={{ py: 1.5 }}>
              <Typography component="h3" variant="subtitle1" sx={{ fontWeight: 600 }} gutterBottom>
                {title}
              </Typography>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sx={head}>Rang</TableCell>
                    <TableCell sx={head}>Type</TableCell>
                    <TableCell sx={head}>Valeur</TableCell>
                    <TableCell sx={head}>Premier paiement (jours)</TableCell>
                    <TableCell sx={head}>Échéances</TableCell>
                    <TableCell sx={head}>Frais sur délai</TableCell>
                    <TableCell sx={head}>Contrepartie</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rule.ladder.map((rung) => (
                    <TableRow key={rung.rank}>
                      <TableCell>{rung.rank}</TableCell>
                      <TableCell>{rung.offerKind === 'lump_sum' ? 'Paiement unique' : 'Échéancier'}</TableCell>
                      <TableCell>{formatBp(rung.valueBp)}</TableCell>
                      <TableCell>{formatCount(rung.payByDays)}</TableCell>
                      <TableCell>{rung.installments ? `${rung.installments.count} × ${rung.installments.intervalDays} jours` : '—'}</TableCell>
                      <TableCell>{formatBp(rung.delayFeeBp)}</TableCell>
                      <TableCell>{counterpart(rung.counterpart)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
          </Collapse>
        </TableCell>
      </TableRow>
    </Fragment>
  )
}
