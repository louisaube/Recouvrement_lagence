/**
 * Aides communes de la recette de la version `v1-cerveau-recouvrement` (boîte noire).
 * Tout passe par l'API en marche (HTTP) ; le SQL ne sert qu'à poser les comptes et leurs profils
 * (`base.users`, `base.credentials`, `base.user_profiles`), à lire un identifiant d'interlocuteur
 * (`base.contacts`, le plan R10 : la recette les connaît par SQL) et à déplacer dans le temps ce qu'aucune
 * horloge de test ne permet d'atteindre (dates d'un lot passé, échéances d'un engagement, échéance d'une facture).
 */
import { createHash } from 'node:crypto'
import { sql, createUser, login, API_URL } from './harness'
import { PASSWORD, UNKNOWN_UUID } from './scope-helpers'
import { buildCsv, upload } from './import-helpers'

export { PASSWORD, UNKNOWN_UUID }

export interface Res {
  status: number
  body: any
  headers: Headers
}

// ---------------------------------------------------------------- HTTP

export async function http(
  method: string,
  path: string,
  token?: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<Res> {
  const h: Record<string, string> = { ...headers }
  if (token) h.authorization = `Bearer ${token}`
  if (body !== undefined && !h['content-type']) h['content-type'] = 'application/json'
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: h,
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  })
  const text = await res.text()
  let parsed: any = undefined
  try {
    parsed = text ? JSON.parse(text) : undefined
  } catch {
    parsed = text
  }
  return { status: res.status, body: parsed, headers: res.headers }
}

export const get = (path: string, token?: string) => http('GET', path, token)
export const post = (path: string, token?: string, body?: unknown) => http('POST', path, token, body)
export const put = (path: string, token?: string, body?: unknown) => http('PUT', path, token, body)

/** Échoue avec le détail de la réponse quand le statut ou le code ne sont pas ceux attendus. */
export function expectRes(res: Res, status: number, code?: string): void {
  // Un vrai attendu Jest (et non une exception brute) : l'écart est un rouge de comportement, pas une erreur de mise en place.
  const seen = { status: res.status, code: res.body?.code, body: JSON.stringify(res.body)?.slice(0, 600) }
  if (res.status !== status) expect(seen).toMatchObject({ status, ...(code !== undefined ? { code } : {}) })
  if (code !== undefined && res.body?.code !== code) expect(seen).toMatchObject({ status, code })
}

export const ok = (res: Res): any => {
  if (res.status < 200 || res.status > 299) expect({ status: res.status, body: JSON.stringify(res.body)?.slice(0, 600) }).toEqual({ status: '2xx' })
  return res.body
}

export const isUuid = (v: unknown) => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)

// ---------------------------------------------------------------- dates (fuseau Europe/Paris)

export function parisDate(d: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}
export const today = () => parisDate()

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d + n))
  return t.toISOString().slice(0, 10)
}
export const daysFromToday = (n: number) => addDays(today(), n)

/** Semaine ISO `AAAA-Www` d'une date civile. */
export function isoWeek(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d))
  const day = t.getUTCDay() || 7
  t.setUTCDate(t.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

/** Lundi (AAAA-MM-JJ) de la semaine ISO d'une date. */
export function mondayOf(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay() || 7
  return addDays(date, 1 - dow)
}

export const euros = (cents: number): string => {
  const abs = Math.abs(cents)
  return `${cents < 0 ? '-' : ''}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`
}

// ---------------------------------------------------------------- comptes et profils

export type ProfileName = 'supervisor' | 'agent' | 'litigation' | 'indicators'
export type Channel = 'voice' | 'email_sms' | 'mail'

export interface Acc {
  id: string
  email: string
  token: string
}

export interface AccountDef {
  role: 'user' | 'admin'
  profile?: ProfileName
  channel?: Channel
}

export const ACCOUNTS = {
  sup: { role: 'user', profile: 'supervisor' },
  sup2: { role: 'user', profile: 'supervisor' },
  agent: { role: 'user', profile: 'agent', channel: 'voice' },
  agentMail: { role: 'user', profile: 'agent', channel: 'email_sms' },
  agentPost: { role: 'user', profile: 'agent', channel: 'mail' },
  lit: { role: 'user', profile: 'litigation' },
  ind: { role: 'user', profile: 'indicators' },
  admin: { role: 'admin' },
  adminSup: { role: 'admin', profile: 'supervisor' },
  user: { role: 'user' },
} as const satisfies Record<string, AccountDef>
export type AccountName = keyof typeof ACCOUNTS

export async function makeAccount(email: string, def: AccountDef): Promise<Acc> {
  const user = await createUser({ email, password: PASSWORD, role: def.role })
  if (def.profile) {
    try {
      await sql(
        'insert into base.user_profiles (user_id, profile, channel, created_at, updated_at) values ($1, $2, $3, now(), now())',
        [user.id, def.profile, def.channel ?? null],
      )
    } catch (e: any) {
      // Table du module (recouvrement-module-implementation-plan.md) : tant qu'elle n'existe pas, le test échoue sur un attendu (rouge), non sur une erreur de mise en place.
      if (e?.code === '42P01') expect({ table: 'base.user_profiles', existe: false }).toEqual({ table: 'base.user_profiles', existe: true })
      throw e
    }
  }
  const token = await login(email, PASSWORD)
  return { id: user.id, email, token }
}

// ---------------------------------------------------------------- importation de fichiers pivot

export function strip(rows: (string | number | null | undefined)[][]): Buffer {
  return buildCsv(rows.map((r) => r.map((c) => (c === null || c === undefined ? '' : c))))
}

export type ImportType = 'receivables' | 'payments' | 'disputes' | 'contacts' | 'documents'

export const RECEIVABLES_HEADER = [
  'type_piece', 'numero', 'entite_siren', 'debiteur_id', 'debiteur_nature', 'debiteur_siren', 'payeur', 'montant', 'solde',
  'date_facture', 'echeance', 'segment', 'canaux', 'date_extraction', 'reference_sortie',
]

export const SIREN_A = '552100554'
export const SIREN_B = '732829320'
export const SIREN_DEBTOR = '443061841'

export interface Inv {
  numero: string
  debiteur: string
  montant: number
  solde?: number
  type?: 'facture' | 'avoir'
  entite?: string
  nature?: 'famille' | 'entreprise'
  debiteurSiren?: string | null
  payeur?: string
  dateFacture?: string
  echeance?: string
  /** retard en jours à la date du jour (échéance = aujourd'hui − late) quand `echeance` n'est pas donnée */
  late?: number
  segment?: string
  canaux?: string
  referenceSortie?: string
}

export function receivableRow(i: Inv, extraction: string): (string | number)[] {
  const nature = i.nature ?? 'famille'
  const due = i.echeance ?? daysFromToday(-(i.late ?? 30))
  const invoiceDate = i.dateFacture ?? addDays(due, -30)
  const solde = i.solde ?? i.montant
  return [
    i.type ?? 'facture',
    i.numero,
    i.entite ?? SIREN_A,
    i.debiteur,
    nature,
    nature === 'entreprise' ? (i.debiteurSiren === undefined ? SIREN_DEBTOR : i.debiteurSiren ?? '') : '',
    i.payeur ?? '',
    euros(i.montant),
    euros(solde),
    invoiceDate,
    due,
    i.segment ?? 'standard',
    i.canaux ?? 'voix;courriel_sms;courrier',
    extraction,
    i.referenceSortie ?? '',
  ]
}

export const receivablesTotal = (rows: Inv[]) => rows.reduce((s, r) => s + (r.solde ?? r.montant), 0)

export function receivablesFile(rows: Inv[], extraction: string): Buffer {
  return strip([RECEIVABLES_HEADER, ...rows.map((r) => receivableRow(r, extraction))])
}

export interface ImportRun {
  pre: Res
  conf?: Res
}

/** Aperçu puis (si `confirm`) confirmation d'un fichier. Ne lève pas : rend les deux réponses. */
export async function runImport(
  token: string,
  type: ImportType,
  file: Buffer,
  opts: { controlTotal?: string; confirm?: boolean; fileName?: string } = {},
): Promise<ImportRun> {
  const q = opts.controlTotal !== undefined ? `?controlTotal=${encodeURIComponent(opts.controlTotal)}` : ''
  const up = await upload(token, file, opts.fileName ?? `${type}.csv`, { path: `/recovery-imports/${type}/preview${q}` })
  const pre: Res = { status: up.status, body: up.body, headers: new Headers() }
  if (opts.confirm === false || pre.status !== 200 || !pre.body?.importId) return { pre }
  const conf = await post(`/recovery-imports/${type}/${pre.body.importId}/confirm`, token)
  return { pre, conf }
}

/** Importe un fichier et exige l'aperçu accepté et la confirmation 200 ; rend le corps de la confirmation. */
export async function importOk(token: string, type: ImportType, file: Buffer, opts: { controlTotal?: string; fileName?: string } = {}): Promise<any> {
  const run = await runImport(token, type, file, opts)
  if (run.pre.status !== 200 || run.pre.body?.accepted === false) {
    throw new Error(`aperçu ${type} refusé : ${run.pre.status} ${JSON.stringify(run.pre.body)?.slice(0, 800)}`)
  }
  if (run.pre.body.errorRows > 0 && (type === 'receivables' || type === 'payments')) {
    throw new Error(`aperçu ${type} avec erreurs : ${JSON.stringify(run.pre.body)}`)
  }
  const conf = run.conf!
  if (conf.status !== 200) throw new Error(`confirmation ${type} : ${conf.status} ${JSON.stringify(conf.body)?.slice(0, 800)}`)
  return conf.body
}

export async function importReceivables(token: string, rows: Inv[], extraction: string, fileName?: string) {
  return importOk(token, 'receivables', receivablesFile(rows, extraction), { controlTotal: euros(receivablesTotal(rows)), fileName })
}

export const PAYMENTS_HEADER = ['reference', 'montant', 'date_paiement', 'date_releve']
export interface Pay {
  reference: string
  montant: number
  date?: string
}
export function paymentsFile(rows: Pay[], statementDate: string = today()): Buffer {
  return strip([PAYMENTS_HEADER, ...rows.map((p) => [p.reference, euros(p.montant), p.date ?? statementDate, statementDate])])
}
export async function importPayments(token: string, rows: Pay[], statementDate: string = today()) {
  return importOk(token, 'payments', paymentsFile(rows, statementDate))
}

export const CONTACTS_HEADER = ['debiteur_id', 'role', 'courriel', 'telephone', 'adresse_postale']
export interface ContactRow {
  debiteur: string
  role?: string
  courriel?: string
  telephone?: string
  adresse?: string
}
export function contactsFile(rows: ContactRow[]): Buffer {
  return strip([CONTACTS_HEADER, ...rows.map((c) => [c.debiteur, c.role ?? '', c.courriel ?? '', c.telephone ?? '', c.adresse ?? ''])])
}
export const defaultContact = (debiteur: string, nature: 'famille' | 'entreprise' = 'famille'): ContactRow => ({
  debiteur,
  role: nature === 'famille' ? 'payeur' : 'comptabilite_fournisseurs',
  courriel: `${debiteur.toLowerCase()}@example.test`,
  telephone: '+33612345678',
  adresse: '12 rue des Lilas 75010 Paris',
})

export const DISPUTES_HEADER = ['numero', 'entite_siren', 'motif', 'responsable', 'date_ouverture']
export const DOCUMENTS_HEADER = ['numero', 'entite_siren', 'type', 'reference']

/** Lecture tolérante de la liste d'erreurs : le socle rend `errors`, la demande écrit `items`. */
export const errorEntries = (body: any): { row: number; column: string; reason: string }[] => body?.errors ?? body?.items ?? []

// ---------------------------------------------------------------- politique

export interface Rung {
  offerKind: 'lump_sum' | 'schedule'
  valueBp: number
  payByDays: number
  installments?: { count: number; intervalDays: number }
  delayFeeBp?: number
  counterpart?: { type: 'firm_date' | 'first_payment' | 'direct_debit'; deadlineDays?: number; firstPaymentBp?: number }
}

export interface PolicyRule {
  segment: string
  nature: 'family' | 'company'
  horizonDays: number
  nextStep: { kind: 'external_collector' | 'litigation' | 'assignment'; expectedValueBp: number }
  ladder: Rung[]
  maxScheduleDays: number
  thresholdCents: number
  requiredDocuments: ('contract' | 'order' | 'delivery_proof')[]
  limitation: { delayDays: number; startsFrom: 'invoice_date' | 'due_date'; alertDays: number }
}

/** Échelle standard : 100 %, 90 %, 85 %, 82 % (écarts 1000, 500, 300). */
export function standardLadder(nature: 'family' | 'company', values: number[] = [10000, 9000, 8500, 8200]): Rung[] {
  return [
    { offerKind: 'lump_sum', valueBp: values[0], payByDays: 7, delayFeeBp: 0 },
    { offerKind: 'lump_sum', valueBp: values[1], payByDays: 7, delayFeeBp: 0, counterpart: { type: 'firm_date', deadlineDays: 5 } },
    { offerKind: 'lump_sum', valueBp: values[2], payByDays: 14, delayFeeBp: 0, counterpart: { type: 'first_payment', firstPaymentBp: 3000 } },
    {
      offerKind: 'schedule', valueBp: values[3], payByDays: 7, installments: { count: 3, intervalDays: 30 },
      delayFeeBp: nature === 'company' ? 200 : 0, counterpart: { type: 'direct_debit' },
    },
  ]
}

export function ruleFor(segment: string, nature: 'family' | 'company', over: Partial<PolicyRule> = {}): PolicyRule {
  return {
    segment,
    nature,
    horizonDays: 90,
    nextStep: { kind: 'external_collector', expectedValueBp: 5000 },
    ladder: standardLadder(nature, segment === 'premium' ? [9500, 9000, 8700, 8500] : undefined),
    maxScheduleDays: 90,
    thresholdCents: 100_000_000,
    requiredDocuments: [],
    limitation: { delayDays: 1825, startsFrom: 'invoice_date', alertDays: 90 },
    ...over,
  }
}

export interface DecisionRow {
  segment?: string
  nature?: string
  states?: string[]
  late?: string
  action: 'none' | 'reminder' | 'proposal' | 'transfer_proposed'
  rule: string
}

/** Décision JDM (table de décision, première correspondance) : segment, nature, état, retard maximal. */
export function jdm(rows: DecisionRow[]): any {
  const quote = (v: string) => `"${v}"`
  return {
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
            { id: 'i_segment', name: 'Segment', field: 'segment' },
            { id: 'i_nature', name: 'Nature', field: 'nature' },
            { id: 'i_state', name: 'Etat', field: 'state' },
            { id: 'i_late', name: 'Retard', field: 'daysLateMax' },
          ],
          outputs: [
            { id: 'o_action', name: 'Action', field: 'action' },
            { id: 'o_rule', name: 'Regle', field: 'rule' },
          ],
          rules: rows.map((r, k) => ({
            _id: `r${k + 1}`,
            i_segment: r.segment ? quote(r.segment) : '',
            i_nature: r.nature ? quote(r.nature) : '',
            i_state: r.states ? r.states.map(quote).join(', ') : '',
            i_late: r.late ?? '',
            o_action: quote(r.action),
            o_rule: quote(r.rule),
          })),
        },
      },
      { id: 'n-out', type: 'outputNode', name: 'response', position: { x: 600, y: 0 } },
    ],
    edges: [
      { id: 'e1', type: 'edge', sourceId: 'n-in', targetId: 'n-table' },
      { id: 'e2', type: 'edge', sourceId: 'n-table', targetId: 'n-out' },
    ],
  }
}

/** Action du jour par défaut : occupé → aucune ; ≥ 90 j transfert proposé ; ≥ 30 j proposition ; ≥ 1 j relance ; sinon aucune. */
export const DEFAULT_DECISION_ROWS: DecisionRow[] = [
  { states: ['committed', 'frozen', 'supervisor_queue'], action: 'none', rule: 'r-none-busy' },
  { late: '>= 90', action: 'transfer_proposed', rule: 'r-transfer' },
  { late: '>= 30', action: 'proposal', rule: 'r-proposal' },
  { late: '>= 1', action: 'reminder', rule: 'r-reminder' },
  { action: 'none', rule: 'r-none' },
]

export const DEFAULT_WITNESSES = [
  { id: 'w-reminder', description: 'Famille en retard léger : relance', input: { segment: 'standard', nature: 'family', state: 'open', daysLateMax: 10, negotiableCents: 50000 }, expected: { action: 'reminder', rule: 'r-reminder' } },
  { id: 'w-proposal', description: 'Entreprise en retard moyen : proposition', input: { segment: 'standard', nature: 'company', state: 'open', daysLateMax: 45, negotiableCents: 50000 }, expected: { action: 'proposal', rule: 'r-proposal' } },
  { id: 'w-none', description: 'Famille à jour : aucune action', input: { segment: 'standard', nature: 'family', state: 'open', daysLateMax: 0, negotiableCents: 50000 }, expected: { action: 'none', rule: 'r-none' } },
  { id: 'w-busy', description: 'Dossier engagé : aucune action', input: { segment: 'standard', nature: 'family', state: 'committed', daysLateMax: 50, negotiableCents: 50000 }, expected: { action: 'none', rule: 'r-none-busy' } },
  { id: 'w-transfer', description: 'Très en retard : transfert proposé', input: { segment: 'standard', nature: 'family', state: 'open', daysLateMax: 120, negotiableCents: 50000 }, expected: { action: 'transfer_proposed', rule: 'r-transfer' } },
]

export interface PolicyGlobal {
  statementMaxAgeDays: number
  ledgerMaxImports: number
  reviewSampleSize: number
  paymentMethods: string[]
  decisionTypeCapsBp: { none: number; reminder: number; proposal: number; transfer_proposed: number }
  exposureCeilings: { agentVersion: string; segment: string; maxCents: number }[]
}

export const DEFAULT_GLOBAL: PolicyGlobal = {
  statementMaxAgeDays: 30,
  ledgerMaxImports: 2,
  reviewSampleSize: 5,
  paymentMethods: ['transfer', 'direct_debit', 'card'],
  decisionTypeCapsBp: { none: 10000, reminder: 10000, proposal: 10000, transfer_proposed: 10000 },
  exposureCeilings: [],
}

let policySeq = 0
export interface PolicyOpts {
  label?: string
  versionDate?: string
  global?: Partial<PolicyGlobal>
  /** remplace entièrement les règles par défaut */
  rules?: PolicyRule[]
  /** règles ajoutées aux règles par défaut (même couple segment-nature : la version donnée remplace) */
  extraRules?: PolicyRule[]
  /** modifie les règles par défaut, par segment-nature */
  ruleOverrides?: Record<string, Partial<PolicyRule>>
  decisionRows?: DecisionRow[]
  decision?: any
  witnesses?: any[]
  /** clés ajoutées à la racine du fichier (fichier invalide) */
  rootExtra?: Record<string, unknown>
}

export function policyDoc(o: PolicyOpts = {}): any {
  const segments = ['standard', 'premium']
  const natures: ('family' | 'company')[] = ['family', 'company']
  let rules: PolicyRule[] =
    o.rules ??
    segments.flatMap((s) => natures.map((n) => ruleFor(s, n, o.ruleOverrides?.[`${s}/${n}`] ?? {})))
  for (const extra of o.extraRules ?? []) {
    rules = rules.filter((r) => !(r.segment === extra.segment && r.nature === extra.nature)).concat(extra)
  }
  policySeq += 1
  return {
    label: o.label ?? `Politique de recette ${policySeq}-${Math.random().toString(16).slice(2, 8)}`,
    versionDate: o.versionDate ?? '2026-10-01',
    decision: o.decision ?? jdm(o.decisionRows ?? DEFAULT_DECISION_ROWS),
    parameters: { global: { ...DEFAULT_GLOBAL, ...(o.global ?? {}) }, rules },
    witnesses: o.witnesses ?? DEFAULT_WITNESSES,
    ...(o.rootExtra ?? {}),
  }
}

export const policyBytes = (doc: any) => Buffer.from(typeof doc === 'string' ? doc : JSON.stringify(doc), 'utf8')
export const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex')

export function previewPolicy(token: string, doc: any, fileName = 'politique.json') {
  return upload(token, policyBytes(doc), fileName, { path: '/policy-versions/previews' })
}

/** Aperçu, confirmation (201) et activation (200) ; rend l'identifiant de la version. Lève sinon. */
export async function activatePolicy(token: string, doc: any): Promise<string> {
  const pre = await previewPolicy(token, doc)
  if (pre.status !== 200 || !pre.body?.valid) throw new Error(`aperçu de politique : ${pre.status} ${JSON.stringify(pre.body)?.slice(0, 1500)}`)
  const conf = await post(`/policy-versions/previews/${pre.body.previewId}/confirm`, token)
  if (conf.status !== 201) throw new Error(`confirmation de politique : ${conf.status} ${JSON.stringify(conf.body)?.slice(0, 800)}`)
  const id = conf.body.version.id
  const act = await post(`/policy-versions/${id}/activate`, token)
  if (act.status !== 200) throw new Error(`activation de politique : ${act.status} ${JSON.stringify(act.body)?.slice(0, 1500)}`)
  return id
}

/** Aperçu et confirmation seulement (version `imported`). */
export async function importPolicyVersion(token: string, doc: any): Promise<string> {
  const pre = await previewPolicy(token, doc)
  if (pre.status !== 200 || !pre.body?.valid) throw new Error(`aperçu de politique : ${pre.status} ${JSON.stringify(pre.body)?.slice(0, 1500)}`)
  const conf = await post(`/policy-versions/previews/${pre.body.previewId}/confirm`, token)
  if (conf.status !== 201) throw new Error(`confirmation de politique : ${conf.status} ${JSON.stringify(conf.body)?.slice(0, 800)}`)
  return conf.body.version.id
}

// ---------------------------------------------------------------- monde de recette

export interface WorldOpts {
  invoices?: Inv[]
  extraction?: string
  /** `false` : aucune politique active ; sinon options de `policyDoc` */
  policy?: PolicyOpts | false
  /** relevé bancaire frais (défaut vrai) */
  statement?: boolean
  /** `true` : un interlocuteur par débiteur (défaut) ; `false` : aucun ; ou la liste */
  contacts?: boolean | ContactRow[]
  documents?: { numero: string; entite?: string; type: string; reference?: string }[]
}

export const DEFAULT_INVOICES: Inv[] = [{ numero: 'FA-001', debiteur: 'D1', montant: 100000 }]

export class World {
  private accs = new Map<string, Acc>()
  sup!: Acc
  extraction!: string
  policyId?: string
  invoices: Inv[] = []

  async acc(name: AccountName): Promise<Acc> {
    let a = this.accs.get(name)
    if (!a) {
      a = await makeAccount(`${name.toLowerCase()}@recette.test`, ACCOUNTS[name])
      this.accs.set(name, a)
    }
    return a
  }

  async tok(name: AccountName): Promise<string> {
    return (await this.acc(name)).token
  }

  /** Dossier (résumé) d'un identifiant client, lu par le superviseur. */
  async caseOf(debtor: string): Promise<any> {
    const res = await get(`/cases?search=${encodeURIComponent(debtor)}&size=100`, this.sup.token)
    const found = (res.body?.items ?? []).find((c: any) => c.debtorId === debtor)
    if (!found) throw new Error(`dossier ${debtor} introuvable : ${res.status} ${JSON.stringify(res.body)?.slice(0, 300)}`)
    return found
  }
  async caseId(debtor: string): Promise<string> {
    return (await this.caseOf(debtor)).id
  }
  async caseDetail(debtor: string): Promise<any> {
    const id = await this.caseId(debtor)
    return ok(await get(`/cases/${id}`, this.sup.token)).case
  }

  /** Identifiant d'interlocuteur (SQL : la recette connaît les interlocuteurs, plan R10). */
  async contactId(debtor: string, role?: string): Promise<string> {
    const rows = await sql<{ id: string }>(
      `select c.id from base.contacts c join base.cases k on k.id = c.case_id where k.debtor_id = $1 ${role ? 'and c.role = $2' : ''} order by c.id limit 1`,
      role ? [debtor, role] : [debtor],
    )
    if (!rows[0]) throw new Error(`aucun interlocuteur pour ${debtor}`)
    return rows[0].id
  }

  async invoiceId(number: string): Promise<string> {
    const res = await get(`/invoices?number=${encodeURIComponent(number)}&size=100`, this.sup.token)
    const found = (res.body?.items ?? []).find((i: any) => i.number === number)
    if (!found) throw new Error(`facture ${number} introuvable : ${res.status} ${JSON.stringify(res.body)?.slice(0, 300)}`)
    return found.id
  }

  /** Importe un nouveau cliché (date d'extraction donnée). */
  async receivables(rows: Inv[], extraction: string) {
    this.invoices = rows
    this.extraction = extraction
    return importReceivables(this.sup.token, rows, extraction)
  }

  async payments(rows: Pay[], statementDate: string = today()) {
    return importPayments(this.sup.token, rows, statementDate)
  }

  async prepareBatch(): Promise<Res> {
    return post('/daily-batches', this.sup.token)
  }

  async queueItems(query = ''): Promise<any[]> {
    const res = await get(`/decision-queue/items?size=100${query}`, this.sup.token)
    return ok(res).items
  }

  async queueCounts(): Promise<any> {
    return ok(await get('/decision-queue/counts', this.sup.token))
  }
}

/** Monte le monde : superviseur, cliché, politique active, relevé frais, interlocuteurs. */
export async function setupWorld(opts: WorldOpts = {}, existing?: World): Promise<World> {
  const w = existing ?? new World()
  w.sup = await w.acc('sup')
  const invoices = opts.invoices ?? DEFAULT_INVOICES
  w.invoices = invoices
  w.extraction = opts.extraction ?? daysFromToday(-3)
  await importReceivables(w.sup.token, invoices, w.extraction)
  if (opts.policy !== false) w.policyId = await activatePolicy(w.sup.token, policyDoc(opts.policy ?? {}))
  if (opts.statement !== false) {
    await importOk(w.sup.token, 'payments', paymentsFile([{ reference: 'RELEVE-INITIAL', montant: 100, date: addDays(w.extraction, -5) }], today()))
  }
  if (opts.contacts !== false) {
    const natureOf = new Map(invoices.map((i) => [i.debiteur, i.nature ?? 'famille']))
    const rows = Array.isArray(opts.contacts) ? opts.contacts : [...natureOf].map(([d, n]) => defaultContact(d, n))
    await importOk(w.sup.token, 'contacts', contactsFile(rows))
  }
  if (opts.documents?.length) {
    await importOk(w.sup.token, 'documents', strip([DOCUMENTS_HEADER, ...opts.documents.map((d) => [d.numero, d.entite ?? SIREN_A, d.type, d.reference ?? ''])]))
  }
  return w
}

// ---------------------------------------------------------------- outils des agents (REST et MCP)

export interface Outcome {
  ok: boolean
  /** statut HTTP (REST) ou statut porté par le résultat d'erreur (MCP) */
  status: number
  body: any
  replayed?: boolean
}

export interface Tools {
  open(conv: string, body: { caseId: string; interlocutorId: string; aiDisclosureGiven: boolean }, key?: string): Promise<Outcome>
  read(conv: string, caseId: string, key?: string): Promise<Outcome>
  nextOffer(conv: string, caseId: string, body?: { counterpart?: { type: string } }, key?: string): Promise<Outcome>
  commit(conv: string, caseId: string, body: any, key?: string): Promise<Outcome>
  contest(conv: string, caseId: string, body: any, key?: string): Promise<Outcome>
  human(conv: string, caseId: string, body?: any, key?: string): Promise<Outcome>
  complaint(conv: string, caseId: string, body: any, key?: string): Promise<Outcome>
  check(conv: string, body: { caseId: string; text: string }, key?: string): Promise<Outcome>
}

let keySeq = 0
export const freshKey = (prefix = 'k') => `${prefix}-${Date.now().toString(36)}-${(keySeq += 1)}-${Math.random().toString(16).slice(2, 8)}`

export const agentHeaders = (conv: string, key: string, channel: string, version: string): Record<string, string> => ({
  'x-agent-version': version,
  'x-channel': channel,
  'x-conversation-id': conv,
  'idempotency-key': key,
})

export class RestTools implements Tools {
  constructor(public token: string, public channel: Channel = 'voice', public version = 'agent-1.0') {}

  /** Appel REST avec des en-têtes complets, éventuellement modifiés. */
  async raw(method: string, path: string, conv: string, key: string, body?: unknown, override: Record<string, string | null> = {}): Promise<Res> {
    const headers: Record<string, string> = agentHeaders(conv, key, this.channel, this.version)
    for (const [k, v] of Object.entries(override)) {
      if (v === null) delete headers[k.toLowerCase()]
      else headers[k.toLowerCase()] = v
    }
    return http(method, path, this.token, body, headers)
  }

  private out(res: Res): Outcome {
    return { ok: res.status >= 200 && res.status < 300, status: res.status, body: res.body, replayed: res.headers.get('idempotent-replayed') === 'true' }
  }
  async open(conv: string, body: any, key = freshKey()) {
    return this.out(await this.raw('POST', '/agent/conversations', conv, key, body))
  }
  async read(conv: string, caseId: string, key = freshKey()) {
    return this.out(await this.raw('GET', `/agent/cases/${caseId}`, conv, key))
  }
  async nextOffer(conv: string, caseId: string, body: any = {}, key = freshKey()) {
    return this.out(await this.raw('POST', `/agent/cases/${caseId}/next-offer`, conv, key, body))
  }
  async commit(conv: string, caseId: string, body: any, key = freshKey()) {
    return this.out(await this.raw('POST', `/agent/cases/${caseId}/commitments`, conv, key, body))
  }
  async contest(conv: string, caseId: string, body: any, key = freshKey()) {
    return this.out(await this.raw('POST', `/agent/cases/${caseId}/contestations`, conv, key, body))
  }
  async human(conv: string, caseId: string, body: any = {}, key = freshKey()) {
    return this.out(await this.raw('POST', `/agent/cases/${caseId}/human-requests`, conv, key, body))
  }
  async complaint(conv: string, caseId: string, body: any, key = freshKey()) {
    return this.out(await this.raw('POST', `/agent/cases/${caseId}/complaints`, conv, key, body))
  }
  async check(conv: string, body: any, key = freshKey()) {
    return this.out(await this.raw('POST', '/agent/messages/check', conv, key, body))
  }
}

export const MCP_HEADERS = { accept: 'application/json, text/event-stream' }

export class McpTools implements Tools {
  private rpcId = 0
  constructor(public token: string, public channel: Channel = 'voice', public version = 'agent-1.0') {}

  async rpc(method: string, params?: unknown): Promise<Res> {
    const res = await http('POST', '/mcp', this.token, { jsonrpc: '2.0', id: (this.rpcId += 1), method, ...(params === undefined ? {} : { params }) }, MCP_HEADERS)
    // Le transport peut répondre en JSON ou en flux d'évènements (une ligne `data:`) : les deux sont admis.
    if (typeof res.body === 'string' && /^(event|data):/m.test(res.body)) {
      const data = res.body.split('\n').filter((l: string) => l.startsWith('data:')).map((l: string) => l.slice(5).trim())[0]
      try {
        return { ...res, body: JSON.parse(data) }
      } catch {
        return res
      }
    }
    return res
  }

  async tool(name: string, args: Record<string, unknown>): Promise<Outcome> {
    const res = await this.rpc('tools/call', { name, arguments: args })
    const result = res.body?.result
    if (res.status !== 200 || !result) return { ok: false, status: res.status, body: res.body }
    if (result.isError) {
      const sc = result.structuredContent ?? {}
      return { ok: false, status: sc.status ?? 0, body: sc }
    }
    return { ok: true, status: 200, body: result.structuredContent }
  }

  private ctx(conv: string, key: string) {
    return { agentVersion: this.version, channel: this.channel, conversationId: conv, idempotencyKey: key }
  }
  open(conv: string, body: any, key = freshKey()) {
    return this.tool('open_conversation', { ...body, ...this.ctx(conv, key) })
  }
  read(conv: string, caseId: string, key = freshKey()) {
    return this.tool('read_case', { caseId, ...this.ctx(conv, key) })
  }
  nextOffer(conv: string, caseId: string, body: any = {}, key = freshKey()) {
    return this.tool('next_offer', { caseId, ...body, ...this.ctx(conv, key) })
  }
  commit(conv: string, caseId: string, body: any, key = freshKey()) {
    return this.tool('register_commitment', { caseId, ...body, ...this.ctx(conv, key) })
  }
  contest(conv: string, caseId: string, body: any, key = freshKey()) {
    return this.tool('report_dispute', { caseId, ...body, ...this.ctx(conv, key) })
  }
  human(conv: string, caseId: string, body: any = {}, key = freshKey()) {
    return this.tool('request_human_intervention', { caseId, ...body, ...this.ctx(conv, key) })
  }
  complaint(conv: string, caseId: string, body: any, key = freshKey()) {
    return this.tool('report_complaint', { caseId, ...body, ...this.ctx(conv, key) })
  }
  check(conv: string, body: any, key = freshKey()) {
    return this.tool('check_message', { ...body, ...this.ctx(conv, key) })
  }
}

/** Ouvre une conversation (déclaration d'IA donnée) et exige le succès. */
export async function openConversation(tools: Tools, conv: string, caseId: string, interlocutorId: string): Promise<any> {
  const r = await tools.open(conv, { caseId, interlocutorId, aiDisclosureGiven: true })
  if (!r.ok) throw new Error(`ouverture de conversation refusée : ${r.status} ${JSON.stringify(r.body)}`)
  return r.body
}

/** Descend l'échelle jusqu'au rang donné (1 = ancrage) et rend la dernière offre. */
export async function descendTo(tools: Tools, conv: string, caseId: string, rank: number): Promise<any> {
  const counterparts = [undefined, { type: 'firm_date' }, { type: 'first_payment' }, { type: 'direct_debit' }]
  let offer: any
  for (let r = 1; r <= rank; r++) {
    const res = await tools.nextOffer(conv, caseId, counterparts[r - 1] ? { counterpart: counterparts[r - 1] } : {})
    if (!res.ok || res.body.status !== 'offer') throw new Error(`offre de rang ${r} refusée : ${res.status} ${JSON.stringify(res.body)}`)
    offer = res.body.offer
  }
  return offer
}

/** Corps d'engagement qui reproduit exactement une offre. */
export const commitmentFor = (offer: any, paymentMethod = 'transfer') => ({
  offerId: offer.id,
  paymentMethod,
  totalCents: offer.totalCents,
  installments: offer.installments.map((i: any) => ({ dueDate: i.dueDate, amountCents: i.amountCents })),
})

// ---------------------------------------------------------------- normalisation (comparaison de deux transports)

/** Remplace les identifiants par leur ordre d'apparition et les instants par `<instant>`. */
export function normalize(value: unknown): unknown {
  const ids = new Map<string, string>()
  const walk = (v: any): any => {
    if (Array.isArray(v)) return v.map(walk)
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]))
    if (typeof v === 'string') {
      if (isUuid(v)) {
        if (!ids.has(v)) ids.set(v, `<id${ids.size + 1}>`)
        return ids.get(v)
      }
      if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(v)) return '<instant>'
    }
    return v
  }
  return walk(value)
}

/** Clés qu'aucune réponse destinée à un agent ne doit porter (à tous les niveaux). */
export const FORBIDDEN_AGENT_KEYS = [
  'floor', 'plancher', 'rule', 'ruleId', 'policy', 'policyVersion', 'policyVersionId', 'segment', 'rank', 'expectedValue',
  'expectedValueBp', 'nextStep', 'internalReason', 'valueBp', 'ladder', 'referenceCents', 'thresholdCents',
]

export function forbiddenKeysIn(value: unknown, path = ''): string[] {
  const found: string[] = []
  if (Array.isArray(value)) value.forEach((v, i) => found.push(...forbiddenKeysIn(v, `${path}[${i}]`)))
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (FORBIDDEN_AGENT_KEYS.includes(k)) found.push(`${path}.${k}`)
      found.push(...forbiddenKeysIn(v, `${path}.${k}`))
    }
  }
  return found
}

// ---------------------------------------------------------------- SQL de déplacement dans le temps

/** Avance dans le passé les échéances de tous les engagements (ce qu'aucune horloge de test ne permet). */
export async function shiftCommitmentDates(days: number): Promise<void> {
  await sql('update base.commitment_installments set due_date = due_date - $1::int', [days])
}

/** Déplace dans le passé la date d'un lot (libère la place du jour : historique des lots). */
export async function moveBatchBack(batchId: string, days: number): Promise<void> {
  await sql('update base.send_orders set order_date = order_date - $2::int where batch_id = $1', [batchId, days])
  await sql('update base.daily_batches set batch_date = batch_date - $2::int where id = $1', [batchId, days])
}

/** Modifie l'échéance d'une facture (retard) sans nouvel import. */
export async function setDueDate(number: string, due: string): Promise<void> {
  await sql('update base.invoices set due_date = $2 where number = $1', [number, due])
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
