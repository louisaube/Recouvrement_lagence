/** The five files of the pivot format (rule-recouvrement-import-pivot-format). The sixth, the policy, has its own route. */
export const IMPORT_TYPES = ['receivables', 'payments', 'disputes', 'contacts', 'documents'] as const
export type ImportType = (typeof IMPORT_TYPES)[number]

/** Whole-file types: refused at the first error (rule-recouvrement-import-refuse-whole). */
export const WHOLE_FILE_TYPES = ['receivables', 'payments'] as const
export type WholeFileType = (typeof WHOLE_FILE_TYPES)[number]
export const isWholeFile = (type: ImportType): type is WholeFileType => (WHOLE_FILE_TYPES as readonly string[]).includes(type)

/** `import_previews.feature`: one memory of the confirmed files per type (rule-foundation-import-no-double). */
export const FEATURE_OF: Record<ImportType, string> = {
  receivables: 'recovery-receivables',
  payments: 'recovery-payments',
  disputes: 'recovery-disputes',
  contacts: 'recovery-contacts',
  documents: 'recovery-documents',
}

export const TYPE_OF_FEATURE = Object.fromEntries(Object.entries(FEATURE_OF).map(([type, feature]) => [feature, type])) as Record<
  string,
  ImportType
>

/** rule-recouvrement-import-audited: the object types of the audit trail, chosen once and never renamed. */
export const OBJECT_TYPE_OF: Record<ImportType, string> = {
  receivables: 'Import de créances',
  payments: 'Import de paiements',
  disputes: 'Import de litiges',
  contacts: "Import d'interlocuteurs",
  documents: 'Import de pièces',
}

/** Lower-case French name of the file (summaries, labels). */
export const FILE_LABEL_OF: Record<ImportType, string> = {
  receivables: 'créances',
  payments: 'paiements',
  disputes: 'litiges',
  contacts: 'interlocuteurs',
  documents: 'pièces',
}

export const REPORT_CATEGORY_LABELS = {
  new: 'Nouveaux',
  settled: 'Soldés',
  modified: 'Modifiés',
  removed: 'Retirés',
} as const

/** Same limit as the foundation (rule-foundation-import-limits): the whole-file engine announces and applies them. */
export const MAX_AMOUNT_CENTS = 10_000_000_000
