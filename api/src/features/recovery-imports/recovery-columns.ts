import type { CellResult, ColumnFault, ImportColumn } from '../imports/imports.types'
import { parisDate } from '../cases/clock.service'
import { amountCell, dateCell, fail, ok, quoted, sirenCell, textCell } from './recovery-parsers'
import { MAX_AMOUNT_CENTS } from './recovery-imports.constants'

type Parse = ImportColumn['parse']
const column = (name: string, required: boolean, description: string, parse: Parse): ImportColumn => ({ name, required, description, parse })

/** One of a closed list of words, mapped to the stored code. */
function wordCell<T extends string>(label: string, words: Record<string, T>, hint: string): Parse {
  return (cell): CellResult<T> => {
    if (cell === null) return fail(`${label} est obligatoire (${hint}).`)
    const found = words[cell.toLowerCase()]
    return found === undefined ? fail(`${label} : ${quoted(cell)} est inconnu (attendu : ${hint}).`) : ok(found)
  }
}

const SEGMENT = /^[a-z0-9][a-z0-9_-]{0,49}$/
const CHANNEL_WORDS: Record<string, string> = { voix: 'voice', courriel_sms: 'email_sms', courrier: 'mail' }

// ---------------------------------------------------------------------------------------------------- receivables

/** rule-recouvrement-import-pivot-format: the columns of the receivables file, in the order of the screen. */
export const RECEIVABLES_COLUMNS: ImportColumn[] = [
  column('type_piece', true, "Type de pièce : « facture » ou « avoir ».", wordCell('Le type de pièce', { facture: 'invoice', avoir: 'credit_note' }, 'facture ou avoir')),
  column('numero', true, 'Numéro de la pièce (1 à 50 caractères), unique pour une entité créancière.', textCell('Le numéro', true, 50)),
  column('entite_siren', true, "SIREN de l'entité créancière qui a émis la pièce (9 chiffres).", sirenCell("Le SIREN de l'entité créancière", true)),
  column('debiteur_id', true, 'Identifiant client du logiciel de facturation (1 à 50 caractères) : un dossier par identifiant.', textCell("L'identifiant du débiteur", true, 50)),
  column('debiteur_nature', true, 'Nature du débiteur : « famille » ou « entreprise ».', wordCell('La nature du débiteur', { famille: 'family', entreprise: 'company' }, 'famille ou entreprise')),
  column('debiteur_siren', false, 'SIREN du débiteur (9 chiffres) : obligatoire pour une entreprise, vide pour une famille.', sirenCell('Le SIREN du débiteur', false)),
  column('payeur', false, 'Payeur désigné sur la pièce (1 à 100 caractères).', textCell('Le payeur', false, 100)),
  column('montant', true, 'Montant de la pièce : strictement positif pour une facture, strictement négatif pour un avoir (au plus 100 000 000,00).', amountCell('Le montant', true)),
  column('solde', true, 'Solde restant dû : de 0 au montant pour une facture, du montant à 0 pour un avoir.', amountCell('Le solde', true)),
  column('date_facture', true, 'Date de la facture (AAAA-MM-JJ ou JJ/MM/AAAA).', dateCell('La date de facture', true)),
  column('echeance', true, "Date d'échéance, égale ou postérieure à la date de facture.", dateCell("La date d'échéance", true)),
  column('segment', true, 'Segment du débiteur : minuscules, chiffres, « _ » et « - » (1 à 50 caractères).', (cell) => {
    if (cell === null) return fail('Le segment est obligatoire.')
    return SEGMENT.test(cell) ? ok(cell) : fail(`Le segment ${quoted(cell)} est invalide (minuscules, chiffres, « _ » et « - », 1 à 50 caractères).`)
  }),
  column('canaux', false, 'Canaux autorisés parmi voix, courriel_sms, courrier, séparés par « ; ». Vide : aucun canal.', (cell) => {
    const words = (cell ?? '')
      .split(';')
      .map((w) => w.trim())
      .filter((w) => w !== '')
    const channels: string[] = []
    for (const word of words) {
      const code = CHANNEL_WORDS[word.toLowerCase()]
      if (code === undefined) return fail(`Le canal ${quoted(word)} est inconnu (voix, courriel_sms ou courrier).`)
      if (!channels.includes(code)) channels.push(code)
    }
    return ok(channels)
  }),
  column("date_extraction", true, "Date d'extraction du cliché : identique sur toutes les lignes, pas dans le futur.", dateCell("La date d'extraction", true)),
  column('reference_sortie', false, "Identifiant stable d'une sortie comptable saisie dans l'outil comptable (1 à 30 caractères).", textCell('La référence de sortie', false, 30)),
]

/** Cross-column rules of a receivable row; each fault names the column it belongs to (the first one by column order wins). */
export function receivableCrossFaults(v: Record<string, unknown>, today: string): ColumnFault[] {
  const faults: ColumnFault[] = []
  const kind = v.type_piece as 'invoice' | 'credit_note' | undefined
  const nature = v.debiteur_nature as 'family' | 'company' | undefined
  const siren = (v.debiteur_siren as string | null | undefined) ?? null
  const amount = v.montant as number | null | undefined
  const balance = v.solde as number | null | undefined
  if (nature === 'company' && v.debiteur_siren !== undefined && siren === null) {
    faults.push({ column: 'debiteur_siren', reason: "Le SIREN du débiteur est obligatoire pour une entreprise." })
  }
  if (nature === 'family' && siren !== null) {
    faults.push({ column: 'debiteur_siren', reason: 'Le SIREN du débiteur doit être vide pour une famille.' })
  }
  if (kind && typeof amount === 'number') {
    if (kind === 'invoice' && amount <= 0) faults.push({ column: 'montant', reason: `Le montant d'une facture doit être strictement positif (reçu : ${amount / 100}).` })
    if (kind === 'credit_note' && amount >= 0) faults.push({ column: 'montant', reason: `Le montant d'un avoir doit être strictement négatif (reçu : ${amount / 100}).` })
    if (Math.abs(amount) > MAX_AMOUNT_CENTS) faults.push({ column: 'montant', reason: 'Le montant dépasse 100 000 000,00.' })
    if (typeof balance === 'number' && !faults.some((f) => f.column === 'montant')) {
      if (kind === 'invoice' && (balance < 0 || balance > amount)) faults.push({ column: 'solde', reason: `Le solde d'une facture doit être compris entre 0 et son montant (${amount / 100}).` })
      if (kind === 'credit_note' && (balance > 0 || balance < amount)) faults.push({ column: 'solde', reason: `Le solde d'un avoir doit être compris entre son montant (${amount / 100}) et 0.` })
    }
  }
  const invoiceDate = v.date_facture as string | null | undefined
  const due = v.echeance as string | null | undefined
  if (invoiceDate && due && due < invoiceDate) faults.push({ column: 'echeance', reason: `L'échéance ${due} précède la date de facture ${invoiceDate}.` })
  const extraction = v.date_extraction as string | null | undefined
  if (extraction && extraction > today) faults.push({ column: 'date_extraction', reason: `La date d'extraction ${extraction} est dans le futur.` })
  return faults
}

// ------------------------------------------------------------------------------------------------------ payments

export const PAYMENTS_COLUMNS: ImportColumn[] = [
  column('reference', true, 'Référence du paiement sur le relevé (1 à 100 caractères), unique.', textCell('La référence', true, 100)),
  column('montant', true, 'Montant du paiement, strictement positif (au plus 100 000 000,00).', amountCell('Le montant', true)),
  column('date_paiement', true, 'Date du paiement, pas dans le futur.', dateCell('La date de paiement', true)),
  column('date_releve', true, 'Date du relevé bancaire : identique sur toutes les lignes, pas dans le futur.', dateCell('La date du relevé', true)),
]

export function paymentCrossFaults(v: Record<string, unknown>, today: string): ColumnFault[] {
  const faults: ColumnFault[] = []
  const amount = v.montant as number | null | undefined
  if (typeof amount === 'number' && amount <= 0) faults.push({ column: 'montant', reason: 'Le montant du paiement doit être strictement positif.' })
  const paid = v.date_paiement as string | null | undefined
  if (paid && paid > today) faults.push({ column: 'date_paiement', reason: `La date de paiement ${paid} est dans le futur.` })
  const statement = v.date_releve as string | null | undefined
  if (statement && statement > today) faults.push({ column: 'date_releve', reason: `La date du relevé ${statement} est dans le futur.` })
  return faults
}

// ------------------------------------------------------------------------------------- the three row-by-row files

const notInFuture = (label: string): Parse => {
  const read = dateCell(label, true)
  return (cell) => {
    const result = read(cell)
    if (result.ok && typeof result.value === 'string' && result.value > parisDate(new Date())) return fail(`${label} ${result.value} est dans le futur.`)
    return result
  }
}

export const DISPUTES_COLUMNS: ImportColumn[] = [
  column('numero', true, "Numéro de la facture en litige (1 à 50 caractères).", textCell('Le numéro', true, 50)),
  column('entite_siren', false, "SIREN de l'entité créancière : nécessaire si le numéro existe chez plusieurs entités.", sirenCell("Le SIREN de l'entité créancière", false)),
  column('motif', true, 'Motif du litige (1 à 500 caractères).', textCell('Le motif', true, 500)),
  column('responsable', true, 'Responsable du suivi du litige (1 à 100 caractères).', textCell('Le responsable', true, 100)),
  column('date_ouverture', true, "Date d'ouverture du litige, pas dans le futur.", notInFuture("La date d'ouverture")),
]

export const CONTACT_ROLE_WORDS = {
  comptabilite_fournisseurs: 'accounts_payable',
  acheteur: 'buyer',
  valideur: 'approver',
  payeur: 'payer',
} as const

export const CONTACTS_COLUMNS: ImportColumn[] = [
  column('debiteur_id', true, 'Identifiant client du débiteur (dossier existant).', textCell("L'identifiant du débiteur", true, 50)),
  column(
    'role',
    true,
    'Rôle : comptabilite_fournisseurs, acheteur ou valideur pour une entreprise ; payeur pour une famille.',
    wordCell('Le rôle', CONTACT_ROLE_WORDS, 'comptabilite_fournisseurs, acheteur, valideur ou payeur'),
  ),
  column('courriel', false, "Adresse de courriel (254 caractères au plus) ; une adresse invalide suspend le canal courriel et SMS.", textCell('Le courriel', false, 254)),
  column('telephone', false, 'Téléphone (30 caractères au plus) ; un numéro invalide suspend la voix et le SMS.', textCell('Le téléphone', false, 30)),
  column('adresse_postale', false, 'Adresse postale (500 caractères au plus) ; sans code postal à 5 chiffres, le courrier est suspendu.', textCell("L'adresse postale", false, 500)),
]

export const DOCUMENT_TYPE_WORDS = { contrat: 'contract', commande: 'order', preuve_livraison: 'delivery_proof' } as const

export const DOCUMENTS_COLUMNS: ImportColumn[] = [
  column('numero', true, 'Numéro de la facture concernée (1 à 50 caractères).', textCell('Le numéro', true, 50)),
  column('entite_siren', false, "SIREN de l'entité créancière : nécessaire si le numéro existe chez plusieurs entités.", sirenCell("Le SIREN de l'entité créancière", false)),
  column('type', true, 'Type de pièce : contrat, commande ou preuve_livraison.', wordCell('Le type de pièce', DOCUMENT_TYPE_WORDS, 'contrat, commande ou preuve_livraison')),
  column('reference', false, "Référence de la pièce dans l'outil source (1 à 100 caractères) ; aucun document n'est transmis ni stocké.", textCell('La référence', false, 100)),
]
