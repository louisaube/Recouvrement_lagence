import { failureMessage, type Failure } from '../useCall'
import type { ImportSpecification } from './importTypes'

export const DEFAULT_EXTENSIONS = ['.xlsx', '.csv']

export const MESSAGE_EXPIRED = "L'aperçu a expiré ou n'existe plus. Déposez à nouveau le fichier."
export const MESSAGE_ALREADY_IMPORTED = 'Ce fichier a déjà été importé. Un même fichier ne peut pas être importé deux fois.'

const FR = new Intl.NumberFormat('fr-FR')

/** French number format (1 250 000). */
export function formatCount(n: number): string {
  return FR.format(n)
}

/** Size limit in Mo (binary megabytes). */
export function formatMegabytes(bytes: number): string {
  const mo = bytes / 1048576
  return FR.format(Number.isInteger(mo) ? mo : Math.round(mo * 10) / 10)
}

function tooLarge(spec?: ImportSpecification): string {
  return `Le fichier est trop volumineux${spec ? ` (maximum ${formatMegabytes(spec.maxFileSizeBytes)} Mo)` : ''}.`
}

/** rule-foundation-import-client-precheck: local checks, without reading the file. */
export function precheck(file: File, spec?: ImportSpecification): string | undefined {
  const extensions = spec?.acceptedExtensions ?? DEFAULT_EXTENSIONS
  const name = file.name.toLowerCase()
  if (!extensions.some((e) => name.endsWith(e.toLowerCase()))) return 'Format non pris en charge. Déposez un fichier .xlsx ou .csv.'
  if (file.size === 0) return 'Le fichier est vide.'
  if (spec && file.size > spec.maxFileSizeBytes) return tooLarge(spec)
  return undefined
}

/** Refusals at analysis (70-ecrans.md §7); anything else follows rule-foundation-api-failure-handling. */
export function analysisMessage(failure: Failure, spec?: ImportSpecification): string {
  if (failure.status === 413 || failure.code === 'import.file_too_large') return tooLarge(spec)
  switch (failure.code) {
    case 'import.invalid_file_type':
      return "Ce fichier n'est ni un classeur .xlsx ni un fichier .csv valide."
    case 'import.unsafe_archive':
      return "Fichier refusé : l'archive contenue dans ce classeur est jugée dangereuse (taille décompressée excessive ou structure suspecte)."
    case 'import.external_links':
      return 'Fichier refusé : il contient des formules ou des liaisons vers des fichiers externes. Remplacez-les par des valeurs puis réessayez.'
    case 'import.too_many_rows':
      return `Le fichier contient trop de lignes${spec ? ` (maximum ${formatCount(spec.maxRows)} lignes)` : ''}.`
    case 'import.empty_file':
      return 'Le fichier ne contient aucune ligne de données.'
    case 'import.missing_columns':
      return 'Colonnes manquantes ou illisibles. Vérifiez la première ligne du fichier : elle doit contenir les colonnes attendues ci-dessous.'
    case 'import.already_imported':
      return MESSAGE_ALREADY_IMPORTED
  }
  if (failure.status === 409) return MESSAGE_ALREADY_IMPORTED
  return failureMessage(failure)
}

export function isExpired(failure: Failure): boolean {
  return failure.status === 404 || failure.code === 'import.preview_not_found'
}

export function isAlreadyImported(failure: Failure): boolean {
  return failure.status === 409 || failure.code === 'import.already_imported'
}

/** Failure of the confirmation. */
export function confirmMessage(failure: Failure): string {
  if (isExpired(failure)) return MESSAGE_EXPIRED
  if (isAlreadyImported(failure)) return MESSAGE_ALREADY_IMPORTED
  return failureMessage(failure)
}
