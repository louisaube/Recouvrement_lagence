/**
 * Support of the tests of the recovery module (never part of the build): accounts with a recovery profile, CSV uploads
 * and a minimal policy file. The tests call the RUNNING test API and seed `<slug>_test` with SQL.
 */
import { API_URL, ApiResponse, call, createUser, login, sql } from '../../../platform/testing/helpers'
import { csv, Row } from '../../imports/tests/files'

export const UNKNOWN = '00000000-0000-4000-8000-000000000000'

export const auth = (token?: string): Record<string, string> => (token ? { authorization: `Bearer ${token}` } : {})

export type Profile = 'supervisor' | 'agent' | 'litigation' | 'indicators'

/** An account (role `user`) with its recovery profile, and its token. */
export async function accountWithProfile(email: string, profile: Profile | null, channel?: string): Promise<{ id: string; token: string }> {
  const created = await createUser({ email, role: 'user' })
  if (profile) {
    await sql('insert into base.user_profiles (user_id, profile, channel) values ($1, $2, $3)', [created.id, profile, profile === 'agent' ? (channel ?? 'voice') : null])
  }
  return { id: created.id, token: await login(email) }
}

export const get = (path: string, token?: string) => call(path, { headers: auth(token) })
export const post = (path: string, token?: string, body?: unknown) => call(path, { method: 'POST', headers: auth(token), body })

export function upload(path: string, content: Buffer | string, token?: string, fileName = 'fichier.csv'): Promise<ApiResponse> {
  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(typeof content === 'string' ? Buffer.from(content, 'utf8') : content)]), fileName)
  return fetch(`${API_URL}${path}`, { method: 'POST', headers: auth(token), body: form }) as Promise<ApiResponse>
}

export const today = (): string => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date())

export const RECEIVABLE_HEADER = [
  'type_piece', 'numero', 'entite_siren', 'debiteur_id', 'debiteur_nature', 'debiteur_siren', 'payeur', 'montant', 'solde',
  'date_facture', 'echeance', 'segment', 'canaux', 'date_extraction', 'reference_sortie',
]

export interface ReceivableLine {
  numero: string
  debtor: string
  nature?: 'famille' | 'entreprise'
  siren?: string | null
  montant?: string
  solde?: string
  echeance?: string
  segment?: string
  kind?: 'facture' | 'avoir'
}

/** A receivables file (CSV): the control total is the sum of the balances of the lines. */
export function receivablesCsv(lines: ReceivableLine[], extraction: string = today()): Buffer {
  const rows: Row[] = lines.map((l) => [
    l.kind ?? 'facture', l.numero, '123456789', l.debtor, l.nature ?? 'famille', (l.nature ?? 'famille') === 'entreprise' ? (l.siren ?? '987654321') : null, null,
    l.montant ?? '100,00', l.solde ?? l.montant ?? '100,00', '2026-01-10', l.echeance ?? '2026-02-10', l.segment ?? 'standard', 'voix', extraction, null,
  ])
  return csv([RECEIVABLE_HEADER, ...rows])
}

/** Imports (preview, then confirmation) a receivables file as the supervisor; returns the import identifier. */
export async function importReceivables(token: string, content: Buffer, controlTotal: string): Promise<string> {
  const preview = await upload(`/recovery-imports/receivables/preview?controlTotal=${encodeURIComponent(controlTotal)}`, content, token)
  const body = await preview.json()
  if (preview.status !== 200 || body.accepted === false) throw new Error(`receivables preview: ${preview.status} ${JSON.stringify(body)}`)
  const confirmed = await post(`/recovery-imports/receivables/${body.importId}/confirm`, token)
  if (confirmed.status !== 200) throw new Error(`receivables confirm: ${confirmed.status} ${JSON.stringify(await confirmed.json())}`)
  return body.importId as string
}

const quoted = (v: string) => `"${v}"`

/** A policy file with a single first-match decision table and one witness per branch. */
export function policyFile(options: { label?: string; versionDate?: string; segments?: string[] } = {}): Record<string, unknown> {
  const rule = (segment: string, nature: 'family' | 'company') => ({
    segment,
    nature,
    horizonDays: 90,
    nextStep: { kind: 'external_collector', expectedValueBp: 5000 },
    ladder: [
      { offerKind: 'lump_sum', valueBp: 10000, payByDays: 7, delayFeeBp: 0 },
      { offerKind: 'lump_sum', valueBp: 9000, payByDays: 7, delayFeeBp: 0, counterpart: { type: 'firm_date', deadlineDays: 5 } },
      { offerKind: 'lump_sum', valueBp: 8500, payByDays: 14, delayFeeBp: 0, counterpart: { type: 'first_payment', firstPaymentBp: 3000 } },
      { offerKind: 'schedule', valueBp: 8200, payByDays: 7, installments: { count: 3, intervalDays: 30 }, delayFeeBp: nature === 'company' ? 200 : 0, counterpart: { type: 'direct_debit' } },
    ],
    maxScheduleDays: 90,
    thresholdCents: 100_000_000,
    requiredDocuments: [],
    limitation: { delayDays: 1825, startsFrom: 'invoice_date', alertDays: 90 },
  })
  const table = [
    { states: ['committed', 'frozen', 'supervisor_queue'], action: 'none', rule: 'r-busy' },
    { late: '>= 30', action: 'proposal', rule: 'r-proposal' },
    { late: '>= 1', action: 'reminder', rule: 'r-reminder' },
    { action: 'none', rule: 'r-none' },
  ]
  const witness = (id: string, state: string, late: number, action: string, ruleId: string) => ({
    id,
    description: `Témoin ${id}`,
    input: { segment: 'standard', nature: 'family', state, daysLateMax: late, negotiableCents: 50000 },
    expected: { action, rule: ruleId },
  })
  return {
    label: options.label ?? `Politique ${Math.random().toString(16).slice(2, 8)}`,
    versionDate: options.versionDate ?? '2026-10-01',
    decision: {
      contentType: 'application/vnd.gorules.decision',
      nodes: [
        { id: 'n-in', type: 'inputNode', name: 'request', position: { x: 0, y: 0 } },
        {
          id: 'n-table',
          type: 'decisionTableNode',
          name: 'actions',
          position: { x: 300, y: 0 },
          content: {
            hitPolicy: 'first',
            inputs: [
              { id: 'i_state', name: 'Etat', field: 'state' },
              { id: 'i_late', name: 'Retard', field: 'daysLateMax' },
            ],
            outputs: [
              { id: 'o_action', name: 'Action', field: 'action' },
              { id: 'o_rule', name: 'Regle', field: 'rule' },
            ],
            rules: table.map((r, k) => ({
              _id: `r${k + 1}`,
              i_state: r.states ? r.states.map(quoted).join(', ') : '',
              i_late: r.late ?? '',
              o_action: quoted(r.action),
              o_rule: quoted(r.rule),
            })),
          },
        },
        { id: 'n-out', type: 'outputNode', name: 'response', position: { x: 600, y: 0 } },
      ],
      edges: [
        { id: 'e1', type: 'edge', sourceId: 'n-in', targetId: 'n-table' },
        { id: 'e2', type: 'edge', sourceId: 'n-table', targetId: 'n-out' },
      ],
    },
    parameters: {
      global: {
        statementMaxAgeDays: 30,
        ledgerMaxImports: 2,
        reviewSampleSize: 5,
        paymentMethods: ['transfer', 'direct_debit', 'card'],
        decisionTypeCapsBp: { none: 10000, reminder: 10000, proposal: 10000, transfer_proposed: 10000 },
        exposureCeilings: [],
      },
      rules: (options.segments ?? ['standard']).flatMap((s) => [rule(s, 'family'), rule(s, 'company')]),
    },
    witnesses: [
      witness('w-reminder', 'open', 10, 'reminder', 'r-reminder'),
      witness('w-proposal', 'open', 45, 'proposal', 'r-proposal'),
      witness('w-none', 'open', 0, 'none', 'r-none'),
      witness('w-busy', 'committed', 50, 'none', 'r-busy'),
    ],
  }
}
