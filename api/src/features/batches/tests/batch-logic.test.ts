import { priceOffer, decimalOf } from '../../brain/offers'
import type { PolicyRungFile } from '../../policies/policies.schemas'
import { computeShares } from '../batch-checks'
import { chooseRecipient, proposalConditions, type ContactFact, type InvoiceFact } from '../order-builder'

const rung = (over: Partial<PolicyRungFile>): PolicyRungFile => ({ offerKind: 'lump_sum', valueBp: 10000, payByDays: 7, delayFeeBp: 0, ...over })

describe('pure logic of the daily batch', () => {
  describe('anchor pricing', () => {
    it('[rule-recouvrement-offer-computation] the sum is rounded to the upper half in integers, the discount is the rest, the first payment is the day plus payByDays', () => {
      expect(priceOffer(rung({ valueBp: 8250 }), 10001, '2026-10-14')).toMatchObject({ totalCents: 8251, discountCents: 1750, firstPaymentDate: '2026-10-21' })
      expect(priceOffer(rung({ valueBp: 8250 }), 10000, '2026-10-14')).toMatchObject({ totalCents: 8250, discountCents: 1750 })
      expect(priceOffer(rung({ valueBp: 1 }), 5000, '2026-10-14').totalCents).toBe(1)
      expect(priceOffer(rung({ valueBp: 1 }), 4999, '2026-10-14').totalCents).toBe(0)
    })

    it('[rule-recouvrement-offer-computation] a schedule is made of equal parts, the cents left over on the last one, one every intervalDays; the delay fee is part of the sum', () => {
      const offer = priceOffer(rung({ offerKind: 'schedule', valueBp: 8200, installments: { count: 3, intervalDays: 30 }, delayFeeBp: 200 }), 100001, '2026-10-14')
      expect(offer.delayFeeCents).toBe(2000)
      expect(offer.totalCents).toBe(82001 + 2000)
      expect(offer.instalments.map((p) => p.dueDate)).toEqual(['2026-10-21', '2026-11-20', '2026-12-20'])
      expect(offer.instalments.map((p) => p.amountCents)).toEqual([28000, 28000, 28001])
      expect(offer.instalments.reduce((a, p) => a + p.amountCents, 0)).toBe(offer.totalCents)
    })

    it('[rule-recouvrement-batch-orders-structured] the conditions of an anchor are name-value pairs within the bounds of the contract', () => {
      const conditions = proposalConditions(priceOffer(rung({ offerKind: 'schedule', valueBp: 9000, installments: { count: 2, intervalDays: 30 }, delayFeeBp: 100 }), 123456, '2026-10-14'))
      for (const c of conditions) {
        expect(c.name.length).toBeGreaterThanOrEqual(1)
        expect(c.name.length).toBeLessThanOrEqual(100)
        expect(c.value.length).toBeLessThanOrEqual(300)
      }
      expect(conditions.map((c) => c.name)).toEqual(['Type d’offre', 'Somme à régler (EUR)', 'Remise (EUR)', 'Premier versement avant le', 'Frais de délai inclus (EUR)', 'Échéance 1', 'Échéance 2'])
      expect(decimalOf(5)).toBe('0,05')
      expect(decimalOf(100000)).toBe('1000,00')
    })
  })

  describe('recipient', () => {
    const invoice = (id: string, channels: string[], documents: string[] = []): InvoiceFact => ({ id, number: id, balanceCents: 100, dueDate: '2026-10-01', channels, documents })
    const contact = (id: string, role: string, over: Partial<ContactFact> = {}): ContactFact => ({ id, role, email: null, phone: null, postalAddress: null, suspendedChannels: [], ...over })

    it('[rule-recouvrement-batch-channel-order] voice before email_sms before mail; role order, then identifier', () => {
      const all = ['voice', 'email_sms', 'mail']
      const a = chooseRecipient('proposal', [invoice('I', all)], [contact('b', 'payer', { phone: '1', postalAddress: 'x' }), contact('a', 'payer', { phone: '2' })], [])
      expect(a).toMatchObject({ ok: true, channel: 'voice', contact: { id: 'a' } })
      const b = chooseRecipient('proposal', [invoice('I', all)], [contact('z', 'accounts_payable', { postalAddress: 'x' }), contact('y', 'payer', { email: 'e' })], [])
      expect(b).toMatchObject({ ok: true, channel: 'email_sms', contact: { id: 'y' } })
      const c = chooseRecipient('proposal', [invoice('I', ['mail'])], [contact('z', 'payer', { postalAddress: 'x' }), contact('y', 'buyer', { postalAddress: 'x' })], [])
      expect(c).toMatchObject({ ok: true, channel: 'mail', contact: { id: 'y' } })
    })

    it('[rule-recouvrement-batch-order-eligibility] the reason of an exclusion: suspended, not authorized, nobody', () => {
      expect(chooseRecipient('reminder', [invoice('I', ['voice'])], [contact('a', 'payer', { phone: '1', suspendedChannels: ['voice'] })], [])).toEqual({ ok: false, reason: 'channel_suspended' })
      expect(chooseRecipient('reminder', [invoice('I', ['mail'])], [contact('a', 'payer', { phone: '1' })], [])).toEqual({ ok: false, reason: 'channel_not_authorized' })
      expect(chooseRecipient('reminder', [invoice('I', ['mail'])], [contact('a', 'payer', { suspendedChannels: [] })], [])).toEqual({ ok: false, reason: 'no_contact' })
      expect(chooseRecipient('reminder', [invoice('I', ['voice'])], [], [])).toEqual({ ok: false, reason: 'no_contact' })
    })

    it('[rule-recouvrement-documents-required-blocks-reminder] a missing document leaves the invoice out of a reminder, not out of a proposal', () => {
      const invoices = [invoice('I1', ['voice'], ['contract']), invoice('I2', ['voice'])]
      const contacts = [contact('a', 'payer', { phone: '1' })]
      expect(chooseRecipient('reminder', invoices, contacts, ['contract'])).toMatchObject({ ok: true, invoices: [{ id: 'I1' }] })
      expect(chooseRecipient('proposal', invoices, contacts, ['contract'])).toMatchObject({ ok: true, invoices: [{ id: 'I1' }, { id: 'I2' }] })
      expect(chooseRecipient('reminder', [invoice('I2', ['voice'])], contacts, ['contract'])).toEqual({ ok: false, reason: 'documents_missing' })
    })
  })

  describe('shares', () => {
    const zero = { none: 0, reminder: 0, proposal: 0, transfer_proposed: 0 }
    const caps = { none: 10000, reminder: 5000, proposal: 10000, transfer_proposed: 10000 }

    it('[rule-recouvrement-batch-auto-stop] a batch of no case has shares of zero and passes', () => {
      const { shares, check } = computeShares({ counts: zero, decided: 0, caps, history: [] })
      expect(shares.every((s) => s.shareBp === 0 && !s.exceeded)).toBe(true)
      expect(check.status).toBe('passed')
    })

    it('[rule-recouvrement-batch-auto-stop][rule-recouvrement-decision-share-sigma] nine batches are not enough for the statistics, ten are; the gap must be strictly above three deviations', () => {
      const counts = { none: 19, reminder: 81, proposal: 0, transfer_proposed: 0 }
      const history = (n: number) => Array.from({ length: n }, (_, i) => ({ none: 10000 - (i % 2 ? 6000 : 4000), reminder: i % 2 ? 6000 : 4000, proposal: 0, transfer_proposed: 0 }))
      expect(computeShares({ counts, decided: 100, caps, history: history(9) }).shares[1].mode).toBe('fixed_cap')
      const ten = computeShares({ counts, decided: 100, caps, history: history(10) })
      expect(ten.shares[1]).toMatchObject({ mode: 'statistical', meanBp: 5000, sigmaBp: 1000, thresholdBp: 3000, exceeded: true })
      // exactly three deviations away: 80 % against a threshold of 30 points does not block
      const edge = computeShares({ counts: { none: 20, reminder: 80, proposal: 0, transfer_proposed: 0 }, decided: 100, caps, history: history(10) })
      expect(edge.shares[1].exceeded).toBe(false)
    })
  })
})
