import { resetData, closePool, sql } from './harness'
import {
  World, get, ok, setupWorld, daysFromToday, RestTools, openConversation, descendTo, commitmentFor, shiftCommitmentDates, SIREN_A, SIREN_B, paymentsFile, importOk, strip, DISPUTES_HEADER,
} from './recouvrement-helpers'
import type { Inv } from './recouvrement-helpers'

// Version v1-cerveau-recouvrement : engagements tenus ou rompus, évaluation du dossier, remise en sortie comptable.

const D = (n: number) => daysFromToday(n)

describe('Recouvrement - engagements tenus et rompus', () => {
  let w: World
  let sup: string
  let agent: RestTools

  beforeEach(async () => {
    await resetData()
    w = new World()
  })
  afterAll(async () => {
    await closePool()
  })

  async function world(invoices: Inv[]) {
    await setupWorld({ invoices }, w)
    sup = await w.tok('sup')
    agent = new RestTools(await w.tok('agent'), 'voice')
  }
  async function commitAt(debtor: string, rank: number, method = 'transfer') {
    const caseId = await w.caseId(debtor)
    const conv = `c-${debtor}`
    await openConversation(agent, conv, caseId, await w.contactId(debtor))
    const offer = await descendTo(agent, conv, caseId, rank)
    const res = await agent.commit(conv, caseId, commitmentFor(offer, method))
    if (!res.ok) throw new Error(`engagement refusé : ${res.status} ${JSON.stringify(res.body)}`)
    return { caseId, conv, offer, commitment: res.body.commitment }
  }
  const pay = async (rows: { reference: string; montant: number }[]) => importOk(sup, 'payments', paymentsFile(rows.map((r) => ({ ...r, date: D(0) })), D(0)))
  const history = async (caseId: string) => ok(await get(`/cases/${caseId}/state-history?size=100`, sup)).items

  it('[rule-recouvrement-commitment-held][rule-recouvrement-evaluation-points] a commitment whose installments are paid by affected payments is held; the case with no open invoice left is settled (cause commitment_held)', async () => {
    await world([{ numero: 'FA-001', debiteur: 'D1', montant: 100000 }])
    const { caseId } = await commitAt('D1', 1)
    await pay([{ reference: 'VIR FA-001', montant: 100000 }])
    const detail = await w.caseDetail('D1')
    expect(detail.commitments[0].status).toBe('held')
    expect(detail.state).toBe('settled')
    expect((await history(caseId))[0]).toMatchObject({ from: 'committed', to: 'settled', cause: 'commitment_held' })
  })

  it('[rule-recouvrement-commitment-held] a held commitment with invoices left open gives back the open state (cause commitment_held)', async () => {
    await world([{ numero: 'FA-001', debiteur: 'D1', montant: 100000 }, { numero: 'FA-002', debiteur: 'D1', montant: 40000 }])
    const { caseId, commitment } = await commitAt('D1', 2)
    expect(commitment.totalCents).toBe(126000)
    await pay([{ reference: 'VIR FA-001', montant: 100000 }, { reference: 'VIR FA-002', montant: 26000 }])
    const detail = await w.caseDetail('D1')
    expect(detail.commitments[0].status).toBe('held')
    expect(detail.state).toBe('open')
    expect((await history(caseId))[0]).toMatchObject({ from: 'committed', to: 'open', cause: 'commitment_held' })
  })

  it('[rule-recouvrement-commitment-held] an installment payment short of the cumulative amount due keeps the commitment pending while an installment is still to come', async () => {
    await world([{ numero: 'FA-001', debiteur: 'D1', montant: 100000 }])
    await commitAt('D1', 4)
    await pay([{ reference: 'VIR FA-001', montant: 10000 }])
    const detail = await w.caseDetail('D1')
    expect(detail.commitments[0].status).toBe('pending')
    expect(detail.state).toBe('committed')
  })

  it('[rule-recouvrement-commitment-broken][rule-recouvrement-agent-evaluation] a missed installment is noticed by the next read of the agent: the commitment is broken, its offers are revoked, the case is open again and the negotiation starts again at the anchor', async () => {
    await world([{ numero: 'FA-001', debiteur: 'D1', montant: 100000 }])
    const { caseId, conv } = await commitAt('D1', 4)
    await shiftCommitmentDates(40)
    const read = await agent.read(conv, caseId)
    expect(read.status).toBe(200)
    const detail = await w.caseDetail('D1')
    expect(detail.commitments[0].status).toBe('broken')
    expect(detail.unlockedOffers.every((o: any) => o.status === 'revoked')).toBe(true)
    expect(detail.state).toBe('open')
    expect((await history(caseId))[0]).toMatchObject({ from: 'committed', to: 'open', cause: 'commitment_broken' })
    const anchor = await agent.nextOffer(conv, caseId, {})
    expect(anchor.body).toMatchObject({ status: 'offer', offer: { totalCents: 100000, counterpart: null } })
  })

  it('[rule-recouvrement-commitment-broken] a missed installment is also noticed by a batch preparation and by a new import, with the same effect', async () => {
    await world([{ numero: 'FA-001', debiteur: 'D1', montant: 100000 }, { numero: 'FA-002', debiteur: 'D2', montant: 100000 }])
    await commitAt('D1', 4)
    await shiftCommitmentDates(40)
    await w.prepareBatch()
    expect((await w.caseDetail('D1')).commitments[0].status).toBe('broken')
    await commitAt('D2', 4)
    await shiftCommitmentDates(40)
    await pay([{ reference: 'VIR HORS-DOSSIER', montant: 100 }])
    expect((await w.caseDetail('D2')).commitments[0].status).toBe('broken')
  })

  it('[rule-recouvrement-commitment-held][rule-recouvrement-commitment-broken] a held schedule requires the cumulative due at each installment: paying everything after the last due date still counts as held only if the cumulative amount reaches the total', async () => {
    await world([{ numero: 'FA-001', debiteur: 'D1', montant: 100000 }])
    const { conv, caseId } = await commitAt('D1', 4)
    await pay([{ reference: 'VIR FA-001', montant: 82000 }])
    await shiftCommitmentDates(100)
    await agent.read(conv, caseId)
    expect((await w.caseDetail('D1')).commitments[0].status).toBe('held')
  })

  it('[rule-recouvrement-commitment-covers-negotiable][rule-recouvrement-ledger-output-creation][rule-recouvrement-ledger-output-per-creditor] a held commitment with a discount produces one to_approve output per creditor entity, the discount being shared in proportion of the balances at registration, the cents left on the invoice with the greatest balance', async () => {
    await world([
      { numero: 'FA-1', debiteur: 'D1', montant: 50000, entite: SIREN_A },
      { numero: 'FA-2', debiteur: 'D1', montant: 30000, entite: SIREN_A },
      { numero: 'FB-1', debiteur: 'D1', montant: 20001, entite: SIREN_B },
    ])
    const { commitment } = await commitAt('D1', 2)
    expect(commitment.totalCents).toBe(90001)
    await pay([{ reference: 'VIR FA-1', montant: 45000 }, { reference: 'VIR FA-2', montant: 27000 }, { reference: 'VIR FB-1', montant: 18001 }])
    expect((await w.caseDetail('D1')).commitments[0].status).toBe('held')
    const outputs = ok(await get('/ledger-outputs?size=100', sup)).items
    expect(outputs).toHaveLength(2)
    expect(outputs.every((o: any) => o.type === 'discount_credit' && o.origin === 'commitment' && o.status === 'to_approve')).toBe(true)
    const a = outputs.find((o: any) => o.creditorSiren === SIREN_A)
    const b = outputs.find((o: any) => o.creditorSiren === SIREN_B)
    expect(a.amountCents).toBe(8000)
    expect(a.lines.sort((x: any, y: any) => x.invoiceNumber.localeCompare(y.invoiceNumber))).toEqual([{ invoiceNumber: 'FA-1', amountCents: 5001 }, { invoiceNumber: 'FA-2', amountCents: 2999 }])
    expect(b.amountCents).toBe(2000)
    expect(b.lines).toEqual([{ invoiceNumber: 'FB-1', amountCents: 2000 }])
    expect(a.commitmentId).toBe(commitment.id)
    expect(a.reference).toMatch(/^SC-[0-9]{6,12}$/)
    expect(a.reference).not.toBe(b.reference)
    expect(a.reason).toMatch(/^Remise accordée sur engagement tenu \(échéance du \d{2}\/\d{2}\/\d{4}\)\.$/)
  })

  it('[rule-recouvrement-commitment-held] a commitment with no discount produces no ledger output', async () => {
    await world([{ numero: 'FA-001', debiteur: 'D1', montant: 100000 }])
    await commitAt('D1', 1)
    await pay([{ reference: 'VIR FA-001', montant: 100000 }])
    expect((await w.caseDetail('D1')).commitments[0].status).toBe('held')
    expect(ok(await get('/ledger-outputs', sup)).total).toBe(0)
  })

  it('[rule-recouvrement-payment-on-frozen-invoice] a payment is applied to a frozen invoice as well: the balance is reduced', async () => {
    await world([{ numero: 'FA-001', debiteur: 'D1', montant: 100000 }, { numero: 'FA-002', debiteur: 'D1', montant: 50000 }])
    await importOk(sup, 'disputes', strip([DISPUTES_HEADER, ['FA-001', '', 'Litige', 'Service', D(-1)]]))
    await pay([{ reference: 'VIR FA-001', montant: 30000 }])
    const invoice = (await w.caseDetail('D1')).invoices.find((i: any) => i.number === 'FA-001')
    expect(invoice).toMatchObject({ balanceCents: 70000, frozen: true })
  })
})
