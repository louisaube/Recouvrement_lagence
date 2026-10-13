/**
 * Lot r3-import : écran « Importer des utilisateurs » (/utilisateurs/import).
 * Spécification : specifications/socle/70-ecrans.md (§2, §6, §7), 60-import.md, 98-arbitrages.md.
 * Sélection par rôle et nom accessible uniquement. Les fichiers sont fabriqués par les aides de la recette
 * (acceptance/import-helpers.ts : CSV et .xlsx écrits à la main) et déposés par le champ « Fichier à importer ».
 * Les cas impraticables en navigateur (100 Mio, un million de lignes, lenteur) sont simulés en interceptant
 * la réponse de l'API ; tout le reste passe par l'API réelle et la base de test.
 * Navigateur réglé en fr-FR, fuseau Europe/Paris (playwright.config.ts).
 */
import { test, expect, account, type Page } from './fixtures'
import { sql } from '../harness'
import { usersCsv, usersXlsx, buildCsv, buildXlsx, type Row } from '../import-helpers'

const ADMIN_EMAIL = 'admin@recette.test'
const IMPORT = '/utilisateurs/import'
const GENERIQUE = 'Une erreur est survenue. Veuillez réessayer.'
const NON_AUTORISE = 'Action non autorisée.'
const EXPIRE = "L'aperçu a expiré ou n'existe plus. Déposez à nouveau le fichier."
const DEJA_IMPORTE = 'Ce fichier a déjà été importé. Un même fichier ne peut pas être importé deux fois.'

// Les libellés « compte(s) » : pluriel littéral « (s) » ou accord français, les deux sont admis.
const S = '(?:s|\\(s\\))?'

const SPEC = /\/users\/imports\/specification(\?.*)?$/
const PREVIEW = /\/users\/imports\/preview(\?.*)?$/
const ERRORS = /\/users\/imports\/[^/]+\/errors(\?.*)?$/
const CONFIRM = /\/users\/imports\/[^/]+\/confirm(\?.*)?$/
const ANY_IMPORT = /\/users\/imports\//

// ───────────────────────── aides ─────────────────────────

async function connecter(page: Page, role: 'user' | 'admin') {
  const a = await account(role, role === 'admin' ? ADMIN_EMAIL : undefined)
  await page.goto('/connexion')
  await page.getByLabel('Adresse e-mail', { exact: true }).fill(a.email)
  await page.getByLabel('Mot de passe', { exact: true }).fill(a.password)
  await page.getByRole('button', { name: 'Se connecter' }).click()
  await expect(page.getByRole('heading', { name: 'Bienvenue' })).toBeVisible()
  return a
}

async function ouvrirImport(page: Page) {
  await page.goto(IMPORT)
  await expect(page.getByRole('heading', { name: 'Importer des utilisateurs', exact: true })).toBeVisible()
  await expect(page.getByText('Colonnes attendues', { exact: true })).toBeVisible()
}

async function admin(page: Page) {
  const a = await connecter(page, 'admin')
  await ouvrirImport(page)
  return a
}

const champFichier = (page: Page) => page.getByLabel('Fichier à importer', { exact: true })

async function deposer(page: Page, contenu: Buffer, nom = 'comptes.csv') {
  await champFichier(page).setInputFiles({ name: nom, mimeType: 'application/octet-stream', buffer: contenu })
}

const resume = (page: Page, libelle: string, n: number | string) =>
  page.getByText(new RegExp(`${libelle}\\s*:\\s*${String(n).replace(/ /g, '\\s')}(?!\\d)`))

/** Attend l'étape « Aperçu » (résumé affiché). */
async function attendreApercu(page: Page, timeout = 20_000) {
  await expect(page.getByText("Rien n'a encore été enregistré.")).toBeVisible({ timeout })
}

/** Dépose un fichier et attend l'aperçu. */
async function apercu(page: Page, contenu: Buffer, nom = 'comptes.csv') {
  await deposer(page, contenu, nom)
  await attendreApercu(page)
}

const boutonImporter = (page: Page, n: number | string) =>
  page.getByRole('button', { name: new RegExp(`^Importer ${String(n).replace(/ /g, '\\s')} compte${S}$`) })

const dialogue = (page: Page) => page.getByRole('dialog', { name: "Confirmer l'import" })

async function confirmer(page: Page, n: number | string) {
  await boutonImporter(page, n).click()
  await expect(dialogue(page)).toBeVisible()
  await dialogue(page).getByRole('button', { name: "Confirmer l'import" }).click()
}

/** Lignes de données du tableau des erreurs (hors en-tête). */
const lignesErreur = (page: Page) => page.getByRole('row').filter({ has: page.getByRole('cell') })

/** Ligne du tableau des erreurs pour un numéro de ligne et une colonne. */
const erreur = (page: Page, ligne: number, colonne: string) =>
  lignesErreur(page)
    .filter({ has: page.getByRole('cell', { name: String(ligne), exact: true }) })
    .filter({ has: page.getByRole('cell', { name: colonne, exact: true }) })

async function comptesCrees(): Promise<string[]> {
  return (await sql<{ email: string }>('select email from base.users where email <> $1 order by email', [ADMIN_EMAIL])).map((r) => r.email)
}

async function nb(table: string): Promise<number> {
  const [{ n }] = await sql<{ n: number }>(`select count(*)::int n from base.${table}`)
  return n
}

/** Remplace une route de l'API par une réponse fixe (en-têtes CORS compris), éventuellement retenue. */
async function simuler(page: Page, motif: RegExp, methode: 'GET' | 'POST', status: number, body?: unknown, attendre?: Promise<void>) {
  await page.route(motif, async (route) => {
    const req = route.request()
    if (req.method() !== methode) return route.fallback()
    const origine = await req.headerValue('origin')
    if (attendre) await attendre
    try {
      await route.fulfill({
        status,
        contentType: 'application/json',
        headers: origine ? { 'access-control-allow-origin': origine, 'access-control-allow-credentials': 'true' } : {},
        body: JSON.stringify(body ?? { status, code: 'api.unknown_error', message: 'détail technique SQL stack /srv/api/dist/main.js' }),
      })
    } catch {
      /* requête abandonnée par le navigateur */
    }
  })
}

/** Compte les appels réels vers une route de l'API. */
function compter(page: Page, motif: RegExp, methode = 'POST') {
  const etat = { n: 0, urls: [] as string[] }
  page.on('request', (r) => {
    if (r.method() === methode && motif.test(r.url())) {
      etat.n++
      etat.urls.push(r.url())
    }
  })
  return etat
}

const SPEC_PETITE = {
  columns: [
    { name: 'email', required: true, description: 'Adresse e-mail du compte (254 caractères maximum).' },
    { name: 'role', required: true, description: 'Rôle du compte : user ou admin.' },
    { name: 'groupes', required: false, description: 'Noms de groupes existants séparés par « ; ». Laisser vide pour aucun groupe.' },
  ],
  maxFileSizeBytes: 1048576,
  maxRows: 1000000,
  acceptedExtensions: ['.xlsx', '.csv'],
}

const retour = (page: Page) =>
  page.getByRole('link', { name: 'Utilisateurs', exact: true }).or(page.getByRole('button', { name: 'Utilisateurs', exact: true })).last()

// ───────────────────────── accès et point d'entrée ─────────────────────────

test.describe("Accès et point d'entrée", () => {
  test("[rule-foundation-import-users-admin-only] [rule-foundation-users-admin-screen] l'écran Utilisateurs d'un administrateur offre « Importer des utilisateurs », qui mène à /utilisateurs/import", async ({ page }) => {
    await connecter(page, 'admin')
    await page.goto('/utilisateurs')
    await expect(page.getByRole('heading', { name: 'Utilisateurs', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Nouvel utilisateur' })).toBeVisible()
    const entree = page.getByRole('link', { name: 'Importer des utilisateurs' }).or(page.getByRole('button', { name: 'Importer des utilisateurs' }))
    await entree.click()
    await expect(page.getByRole('heading', { name: 'Importer des utilisateurs', exact: true })).toBeVisible()
    expect(new URL(page.url()).pathname).toBe(IMPORT)
  })

  test("[rule-foundation-import-users-admin-only] le point d'entrée n'existe que sur l'écran Utilisateurs", async ({ page }) => {
    await connecter(page, 'admin')
    for (const chemin of ['/', '/groupes', '/perimetres', '/journal']) {
      await page.goto(chemin)
      await expect(page.getByRole('navigation', { name: 'Administration' })).toBeVisible()
      await expect(page.getByRole('link', { name: /importer/i })).toHaveCount(0)
      await expect(page.getByRole('button', { name: /importer/i })).toHaveCount(0)
    }
  })

  test("[rule-foundation-import-users-admin-only] [rule-foundation-admin-screens-guard] un utilisateur ordinaire voit « Accès refusé » sur /utilisateurs/import, sans aucun appel à l'import", async ({ page }) => {
    await connecter(page, 'user')
    await expect(page.getByRole('navigation', { name: 'Administration' })).toHaveCount(0)
    const appels = compter(page, ANY_IMPORT, 'GET')
    const appelsPost = compter(page, ANY_IMPORT, 'POST')
    await page.goto(IMPORT)
    await expect(page.getByRole('heading', { name: 'Accès refusé' })).toBeVisible()
    await expect(page.getByText("Vous n'avez pas les droits nécessaires pour consulter cette page.")).toBeVisible()
    expect(new URL(page.url()).pathname).toBe(IMPORT)
    await expect(page.getByRole('heading', { name: 'Importer des utilisateurs' })).toHaveCount(0)
    await expect(champFichier(page)).toHaveCount(0)
    await page.waitForTimeout(500)
    expect(appels.n + appelsPost.n).toBe(0)
    await page.getByRole('button', { name: "Retour à l'accueil" }).click()
    await expect(page.getByRole('heading', { name: 'Bienvenue' })).toBeVisible()
  })

  test('[rule-foundation-protected-redirect] sans session, /utilisateurs/import redirige vers la connexion puis revient à l\'import', async ({ page }) => {
    const a = await account('admin', ADMIN_EMAIL)
    await page.goto(IMPORT)
    await expect(page.getByRole('heading', { name: 'Connexion' })).toBeVisible()
    const u = new URL(page.url())
    expect(u.pathname).toBe('/connexion')
    expect(u.searchParams.get('redirection')).toBe(IMPORT)
    await page.getByLabel('Adresse e-mail', { exact: true }).fill(a.email)
    await page.getByLabel('Mot de passe', { exact: true }).fill(a.password)
    await page.getByRole('button', { name: 'Se connecter' }).click()
    await expect(page.getByRole('heading', { name: 'Importer des utilisateurs', exact: true })).toBeVisible()
    expect(new URL(page.url()).pathname).toBe(IMPORT)
  })

  test("[rule-foundation-admin-nav] [rule-foundation-import-users-admin-only] l'onglet « Utilisateurs » reste actif sur l'import et le bouton retour ramène à /utilisateurs", async ({ page }) => {
    await admin(page)
    const nav = page.getByRole('navigation', { name: 'Administration' })
    const actif = nav.locator('[aria-selected="true"], [aria-current]')
    await expect(actif).toHaveCount(1)
    await expect(actif).toContainText('Utilisateurs')
    await retour(page).click()
    await expect(page.getByRole('heading', { name: 'Utilisateurs', exact: true })).toBeVisible()
    expect(new URL(page.url()).pathname).toBe('/utilisateurs')
  })
})

// ───────────────────────── étape 1 : dépôt ─────────────────────────

test.describe('Étape 1 : dépôt du fichier', () => {
  test("[rule-foundation-import-formats] [rule-foundation-import-users-columns] structure : trois étapes, zone de dépôt, champ limité à .xlsx,.csv, panneau « Colonnes attendues » issu de la spécification", async ({ page }) => {
    await admin(page)
    for (const etape of ['Dépôt du fichier', 'Aperçu', 'Confirmation']) {
      await expect(page.getByText(etape, { exact: true })).toBeVisible()
    }
    await expect(page.getByText('Glissez un fichier .xlsx ou .csv ici')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Choisir un fichier' })).toBeEnabled()
    await expect(champFichier(page)).toHaveAttribute('accept', '.xlsx,.csv')
    await expect(page.getByText(/La première ligne du fichier doit contenir les noms de colonnes ci-dessous\./)).toBeVisible()
    await expect(page.getByText(/Formats acceptés : \.xlsx et \.csv, maximum 100 Mo et 1\s000\s000 lignes\./)).toBeVisible()
    for (const col of ['Colonne', 'Obligatoire', 'Description']) {
      await expect(page.getByRole('columnheader', { name: col, exact: true })).toBeVisible()
    }
    const lignes = page.getByRole('row').filter({ has: page.getByRole('cell') })
    await expect(lignes).toHaveCount(3)
    await expect(lignes.nth(0)).toContainText('email')
    await expect(lignes.nth(0)).toContainText('Oui')
    await expect(lignes.nth(0)).toContainText('Adresse e-mail du compte (254 caractères maximum).')
    await expect(lignes.nth(1)).toContainText('role')
    await expect(lignes.nth(1)).toContainText('Oui')
    await expect(lignes.nth(1)).toContainText('Rôle du compte : user ou admin.')
    await expect(lignes.nth(2)).toContainText('groupes')
    await expect(lignes.nth(2)).toContainText('Non')
    await expect(lignes.nth(2)).toContainText('Noms de groupes existants séparés par « ; ». Laisser vide pour aucun groupe.')
    // aucun écran d'aperçu ni de confirmation avant le dépôt
    await expect(page.getByText("Rien n'a encore été enregistré.")).toHaveCount(0)
    await expect(page.getByRole('button', { name: /^Importer \d/ })).toHaveCount(0)
  })

  test("[rule-foundation-import-two-steps] ouvrir l'écran n'écrit rien et n'appelle que la spécification ; un rechargement revient au dépôt", async ({ page }) => {
    await connecter(page, 'admin')
    const post = compter(page, ANY_IMPORT, 'POST')
    const get = compter(page, ANY_IMPORT, 'GET')
    await ouvrirImport(page)
    await page.reload()
    await expect(page.getByText('Colonnes attendues', { exact: true })).toBeVisible()
    expect(post.n).toBe(0)
    expect(get.urls.every((u) => /\/users\/imports\/specification/.test(u))).toBe(true)
    expect(new URL(page.url()).search).toBe('')
    expect(await nb('import_previews')).toBe(0)
  })

  test('[rule-foundation-french-ui] échec du chargement des colonnes attendues : message, « Réessayer », le dépôt reste possible', async ({ page }) => {
    await connecter(page, 'admin')
    await simuler(page, SPEC, 'GET', 500)
    await page.goto(IMPORT)
    await expect(page.getByRole('heading', { name: 'Importer des utilisateurs', exact: true })).toBeVisible()
    await expect(page.getByText('Impossible de charger les colonnes attendues.')).toBeVisible()
    await expect(page.getByText(/SQL|stack|api\.unknown_error|main\.js/)).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Choisir un fichier' })).toBeEnabled()
    // le dépôt reste possible sans la spécification (l'API tranche)
    await apercu(page, usersCsv([['seul@recette.test', 'user', '']]))
    await expect(resume(page, 'Lignes valides', 1)).toBeVisible()
  })

  test('[rule-foundation-import-users-columns] « Réessayer » recharge les colonnes attendues', async ({ page }) => {
    await connecter(page, 'admin')
    await simuler(page, SPEC, 'GET', 500)
    await page.goto(IMPORT)
    await expect(page.getByText('Impossible de charger les colonnes attendues.')).toBeVisible()
    await page.unroute(SPEC)
    await page.getByRole('button', { name: 'Réessayer' }).click()
    await expect(page.getByText('Impossible de charger les colonnes attendues.')).toHaveCount(0)
    await expect(page.getByRole('cell', { name: 'groupes', exact: true })).toBeVisible()
  })

  test("[rule-foundation-import-client-precheck] extension non prise en charge : message local, aucun envoi", async ({ page }) => {
    await admin(page)
    const post = compter(page, PREVIEW)
    for (const nom of ['comptes.pdf', 'comptes.txt', 'comptes.xls', 'comptes', 'comptes.ods']) {
      await deposer(page, Buffer.from('email,role\na@x.fr,user\n'), nom)
      await expect(page.getByText('Format non pris en charge. Déposez un fichier .xlsx ou .csv.')).toBeVisible()
      await expect(page.getByText("Rien n'a encore été enregistré.")).toHaveCount(0)
    }
    await page.waitForTimeout(300)
    expect(post.n).toBe(0)
  })

  test('[rule-foundation-import-client-precheck] fichier de 0 octet : « Le fichier est vide. », aucun envoi', async ({ page }) => {
    await admin(page)
    const post = compter(page, PREVIEW)
    await deposer(page, Buffer.alloc(0), 'vide.csv')
    await expect(page.getByText('Le fichier est vide.')).toBeVisible()
    await page.waitForTimeout(300)
    expect(post.n).toBe(0)
  })

  test("[rule-foundation-import-client-precheck] fichier plus gros que la limite de la spécification : « Le fichier est trop volumineux (maximum N Mo). », aucun envoi", async ({ page }) => {
    await connecter(page, 'admin')
    await simuler(page, SPEC, 'GET', 200, SPEC_PETITE)
    await ouvrirImport(page)
    const post = compter(page, PREVIEW)
    await deposer(page, Buffer.alloc(1048576 + 1024, 0x61), 'gros.csv')
    await expect(page.getByText('Le fichier est trop volumineux (maximum 1 Mo).')).toBeVisible()
    await page.waitForTimeout(300)
    expect(post.n).toBe(0)
  })

  test("[rule-foundation-import-client-precheck] [rule-foundation-import-formats] l'extension est insensible à la casse et un fichier accepté lance immédiatement l'analyse, sans bouton d'envoi", async ({ page }) => {
    await admin(page)
    await expect(page.getByRole('button', { name: /envoyer|analyser|téléverser/i })).toHaveCount(0)
    await deposer(page, usersCsv([['majuscule@recette.test', 'user', '']]), 'COMPTES.CSV')
    await attendreApercu(page)
    await expect(page.getByText('COMPTES.CSV', { exact: false }).first()).toBeVisible()
    await expect(resume(page, 'Lignes lues', 1)).toBeVisible()
  })

  test("[rule-foundation-import-formats] un seul fichier à la fois : en cas de dépôt multiple, seul le premier est retenu, avec un message", async ({ page }) => {
    await admin(page)
    const csv = 'email,role,groupes\nglisse1@recette.test,user,\n'
    await page.getByText('Glissez un fichier .xlsx ou .csv ici').evaluate(async (zone, contenu) => {
      const dt = new DataTransfer()
      dt.items.add(new File([contenu], 'premier.csv', { type: 'text/csv' }))
      dt.items.add(new File([contenu.replace('glisse1', 'glisse2')], 'second.csv', { type: 'text/csv' }))
      for (const type of ['dragenter', 'dragover', 'drop']) {
        zone.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }))
      }
    }, csv)
    await expect(page.getByText('Un seul fichier à la fois : seul « premier.csv » a été retenu.')).toBeVisible()
    await attendreApercu(page)
    await expect(page.getByText('premier.csv').first()).toBeVisible()
    await expect(resume(page, 'Lignes lues', 1)).toBeVisible()
    expect(await nb('import_previews')).toBe(1)
  })

  test('[rule-foundation-import-no-client-parsing] le fichier est transmis tel quel en multipart (partie « file »), octet pour octet', async ({ page }) => {
    await admin(page)
    const contenu = usersCsv([['brut@recette.test', 'user', '']], { bom: true, delimiter: ';', eol: '\r\n' })
    const envoi = page.waitForRequest((r) => r.method() === 'POST' && PREVIEW.test(r.url()))
    await deposer(page, contenu, 'brut.csv')
    const req = await envoi
    expect(req.headers()['content-type']).toMatch(/^multipart\/form-data; boundary=/)
    const corps = req.postDataBuffer()!
    expect(corps.includes(contenu)).toBe(true)
    expect(corps.toString('latin1')).toMatch(/name="file"; filename="brut\.csv"/)
    await attendreApercu(page)
  })
})

// ───────────────────────── étape 2 : aperçu ─────────────────────────

test.describe('Étape 2 : aperçu', () => {
  test("[rule-foundation-import-two-steps] [rule-foundation-import-preview-content] aperçu d'un CSV sans erreur : résumé, mention « Rien n'a encore été enregistré. », aucune écriture métier, aucune confirmation", async ({ page }) => {
    await connecter(page, 'admin')
    await sql("insert into base.groups (name) values ('Équipe A')")
    await ouvrirImport(page)
    const confirmations = compter(page, CONFIRM)
    const avant = { users: await nb('users'), cred: await nb('credentials'), gu: await nb('group_users'), g: await nb('groups') }
    await apercu(page, usersCsv([['a@recette.test', 'user', ''], ['b@recette.test', 'admin', 'équipe a'], ['c@recette.test', ' user ', '']]), 'comptes.csv')
    await expect(page.getByText('comptes.csv').first()).toBeVisible()
    await expect(resume(page, 'Lignes lues', 3)).toBeVisible()
    await expect(resume(page, 'Lignes valides', 3)).toBeVisible()
    await expect(resume(page, 'Lignes en erreur', 0)).toBeVisible()
    await expect(page.getByText('Aucune erreur : toutes les lignes seront importées.')).toBeVisible()
    await expect(page.getByText('Lignes en erreur', { exact: true })).toHaveCount(0) // pas de tableau sans erreur
    await expect(page.getByRole('columnheader', { name: 'Raison', exact: true })).toHaveCount(0)
    await expect(page.getByText(/expire/i)).toHaveCount(0) // la date d'expiration n'est pas affichée
    await expect(boutonImporter(page, 3)).toBeEnabled()
    await expect(page.getByRole('button', { name: 'Choisir un autre fichier' })).toBeVisible()
    // rien n'est écrit hors des tables d'import, et le journal ne trace pas l'aperçu
    expect({ users: await nb('users'), cred: await nb('credentials'), gu: await nb('group_users'), g: await nb('groups') }).toEqual(avant)
    expect(await nb('audit_logs')).toBe(0)
    expect(await nb('import_previews')).toBe(1)
    await page.waitForTimeout(300)
    expect(confirmations.n).toBe(0)
  })

  test('[rule-foundation-import-preview-content] [rule-foundation-import-users-email] [rule-foundation-import-users-role] [rule-foundation-import-users-groups] [rule-foundation-import-in-file-duplicates] CSV avec erreurs : compteurs, alerte, tableau « Ligne / Colonne / Raison » avec les raisons françaises exactes', async ({ page }) => {
    await connecter(page, 'admin')
    await account('user', 'dejala@recette.test')
    await sql("insert into base.groups (name) values ('Équipe A')")
    await ouvrirImport(page)
    await apercu(
      page,
      usersCsv([
        ['ok1@recette.test', 'user', ''], // 2 valide
        ['ok2@recette.test', 'admin', 'Équipe A'], // 3 valide
        ['pas-un-mail', 'Admin', ''], // 4 deux colonnes fautives
        ['', 'user', ''], // 5 e-mail absent
        ['ok1@recette.test', 'user', ''], // 6 doublon de la ligne 2
        ['dejala@recette.test', 'user', ''], // 7 compte existant
        ['g@recette.test', 'user', 'Fantôme'], // 8 groupe inconnu
        ['h@recette.test', '', ''], // 9 rôle absent
        ['i@recette.test', 'user', 'Inconnu1;Inconnu2'], // 10 plusieurs groupes inconnus
      ]),
    )
    await expect(resume(page, 'Lignes lues', 9)).toBeVisible()
    await expect(resume(page, 'Lignes valides', 2)).toBeVisible()
    await expect(resume(page, 'Lignes en erreur', 7)).toBeVisible()
    await expect(
      page.getByText('Seules les 2 lignes valides seront importées. Les 7 lignes en erreur seront ignorées : corrigez le fichier et déposez-le à nouveau pour les importer.'),
    ).toBeVisible()
    await expect(page.getByText('Lignes en erreur', { exact: true })).toBeVisible()
    for (const col of ['Ligne', 'Colonne', 'Raison']) {
      await expect(page.getByRole('columnheader', { name: col, exact: true })).toBeVisible()
    }
    // 8 entrées : la ligne 4 occupe deux lignes du tableau
    await expect(lignesErreur(page)).toHaveCount(8)
    await expect(page.getByText('1–8 sur 8')).toBeVisible()
    await expect(erreur(page, 4, 'email')).toContainText('« pas-un-mail » n\'est pas une adresse e-mail valide.')
    await expect(erreur(page, 4, 'role')).toContainText('Rôle « Admin » inconnu : attendu « user » ou « admin ».')
    await expect(erreur(page, 5, 'email')).toContainText("L'adresse e-mail est obligatoire.")
    await expect(erreur(page, 6, 'email')).toContainText('Adresse déjà présente à la ligne 2 du fichier : seule la première occurrence est retenue.')
    await expect(erreur(page, 7, 'email')).toContainText("Un compte existe déjà avec l'adresse « dejala@recette.test ».")
    await expect(erreur(page, 8, 'groupes')).toContainText('Groupe inexistant : « Fantôme ».')
    await expect(erreur(page, 9, 'role')).toContainText('Le rôle est obligatoire (user ou admin).')
    await expect(erreur(page, 10, 'groupes')).toContainText(/Groupes inexistants : « Inconnu1 », « Inconnu2 »/)
    // aucun détail technique
    await expect(page.getByText(/SQL|stack|undefined|\[object/)).toHaveCount(0)
  })

  test('[rule-foundation-import-cell-normalisation] [rule-foundation-import-header-matching] [rule-foundation-import-formats] CSV à point-virgule avec BOM et CRLF, colonnes dans un autre ordre, en-tête rogné et sans casse, colonne en trop ignorée', async ({ page }) => {
    await admin(page)
    const csv = buildCsv(
      [
        [' GROUPES ', 'Extra', ' Role', 'EMAIL '],
        ['', 'x', 'user', 'ordre@recette.test'],
        ['', 'y', 'admin', 'ordre2@recette.test'],
      ],
      { delimiter: ';', bom: true, eol: '\r\n' },
    )
    await apercu(page, csv)
    await expect(resume(page, 'Lignes lues', 2)).toBeVisible()
    await expect(resume(page, 'Lignes valides', 2)).toBeVisible()
    await expect(page.getByText('Aucune erreur : toutes les lignes seront importées.')).toBeVisible()
  })

  test("[rule-foundation-import-cell-normalisation] [rule-foundation-import-preview-content] .xlsx : numéros de ligne du tableur après des lignes vides, formule lue par sa valeur en cache, autres feuilles ignorées", async ({ page }) => {
    await admin(page)
    const rows: Row[] = [
      ['ok@recette.test', 'user', ''], // ligne 2
      [{ value: 'calcule@recette.test', formula: 'LOWER(A9)' }, 'admin', ''], // ligne 3, formule interne ordinaire
      ['mauvais@recette.test', 'chef', ''], // ligne 7 après trois lignes vides
    ]
    const fichier = usersXlsx(rows, { rowNumbers: [1, 2, 3, 7], secondSheetRows: [['ignore', 'ignore'], ['x', 'y']] })
    await apercu(page, fichier, 'classeur.xlsx')
    await expect(page.getByText('classeur.xlsx').first()).toBeVisible()
    await expect(resume(page, 'Lignes lues', 3)).toBeVisible()
    await expect(resume(page, 'Lignes valides', 2)).toBeVisible()
    await expect(resume(page, 'Lignes en erreur', 1)).toBeVisible()
    await expect(lignesErreur(page)).toHaveCount(1)
    await expect(erreur(page, 7, 'role')).toContainText('Rôle « chef » inconnu : attendu « user » ou « admin ».')
  })

  test("[rule-foundation-import-errors-paginated] [rule-foundation-list-pagination] 27 lignes en erreur : 10 par page, « 1–10 sur 27 », pages suivantes dans l'ordre, 25 puis 50 par page", async ({ page }) => {
    await admin(page)
    const rows: Row[] = []
    for (let k = 1; k <= 27; k++) rows.push([`mauvais${k}@recette.test`, 'inconnu', ''])
    await apercu(page, usersCsv(rows))
    await expect(resume(page, 'Lignes lues', 27)).toBeVisible()
    await expect(resume(page, 'Lignes valides', 0)).toBeVisible()
    await expect(resume(page, 'Lignes en erreur', 27)).toBeVisible()
    await expect(page.getByText('Lignes par page :')).toBeVisible()
    await expect(page.getByText('1–10 sur 27')).toBeVisible()
    await expect(lignesErreur(page)).toHaveCount(10)
    await expect(lignesErreur(page).first()).toContainText('2')
    await expect(lignesErreur(page).first()).toContainText('role')
    await page.getByRole('button', { name: /page suivante|next page/i }).click()
    await expect(page.getByText('11–20 sur 27')).toBeVisible()
    await expect(lignesErreur(page).first().getByRole('cell').first()).toHaveText('12')
    await page.getByRole('button', { name: /page suivante|next page/i }).click()
    await expect(page.getByText('21–27 sur 27')).toBeVisible()
    await expect(lignesErreur(page)).toHaveCount(7)
    await expect(lignesErreur(page).last().getByRole('cell').first()).toHaveText('28')
    await page.getByRole('combobox', { name: 'Lignes par page :' }).click()
    await expect(page.getByRole('option')).toHaveText(['10', '25', '50'])
    await page.getByRole('option', { name: '25', exact: true }).click()
    await expect(page.getByText('1–25 sur 27')).toBeVisible()
    await expect(lignesErreur(page)).toHaveCount(25)
    await page.getByRole('combobox', { name: 'Lignes par page :' }).click()
    await page.getByRole('option', { name: '50', exact: true }).click()
    await expect(page.getByText('1–27 sur 27')).toBeVisible()
    await expect(lignesErreur(page)).toHaveCount(27)
  })

  test('[rule-foundation-import-large-files] [rule-foundation-french-ui] 1 250 lignes : nombres au format français dans le résumé', async ({ page }) => {
    await admin(page)
    const rows: Row[] = []
    for (let k = 1; k <= 1250; k++) rows.push([`masse${k}@recette.test`, 'user', ''])
    await deposer(page, usersCsv(rows), 'masse.csv')
    await attendreApercu(page, 25_000)
    await expect(page.getByText(/Lignes lues\s*:\s*1[\s\u00a0\u202f]250/)).toBeVisible()
    await expect(page.getByText(/Lignes valides\s*:\s*1[\s\u00a0\u202f]250/)).toBeVisible()
    await expect(page.getByRole('button', { name: /^Importer 1[\s\u00a0\u202f]?250 compte/ })).toBeVisible()
  })

  test("[rule-foundation-import-confirm-needs-valid-rows] aperçu sans ligne valide : bouton d'import désactivé avec « Aucune ligne valide : rien à importer. », « Choisir un autre fichier » revient au dépôt", async ({ page }) => {
    await admin(page)
    await apercu(page, usersCsv([['x@recette.test', 'chef', ''], ['pas-un-mail', 'user', '']]))
    await expect(resume(page, 'Lignes valides', 0)).toBeVisible()
    await expect(resume(page, 'Lignes en erreur', 2)).toBeVisible()
    await expect(page.getByText('Aucune ligne valide. Corrigez le fichier et déposez-le à nouveau.')).toBeVisible()
    const bouton = page.getByRole('button', { name: 'Aucune ligne valide : rien à importer.' })
    await expect(bouton).toBeVisible()
    await expect(bouton).toBeDisabled()
    await expect(page.getByRole('button', { name: /^Importer \d/ })).toHaveCount(0)
    await page.getByRole('button', { name: 'Choisir un autre fichier' }).click()
    await expect(page.getByText('Glissez un fichier .xlsx ou .csv ici')).toBeVisible()
    await expect(page.getByText('Colonnes attendues', { exact: true })).toBeVisible()
    await expect(page.getByText("Rien n'a encore été enregistré.")).toHaveCount(0)
    await expect(page.getByText('Lignes en erreur', { exact: true })).toHaveCount(0)
    // on peut redéposer le même fichier (le champ est réinitialisé)
    await apercu(page, usersCsv([['x@recette.test', 'chef', ''], ['pas-un-mail', 'user', '']]))
    await expect(resume(page, 'Lignes en erreur', 2)).toBeVisible()
  })

  test("[rule-foundation-api-failure-handling] échec du chargement des erreurs : message générique sans détail technique, « Réessayer » recharge le tableau", async ({ page }) => {
    await admin(page)
    await simuler(page, ERRORS, 'GET', 500)
    await apercu(page, usersCsv([['bon@recette.test', 'user', ''], ['mauvais@recette.test', 'chef', '']]))
    await expect(page.getByText(GENERIQUE)).toBeVisible()
    await expect(page.getByText(/SQL|stack|api\.unknown_error|main\.js/)).toHaveCount(0)
    await page.unroute(ERRORS)
    await page.getByRole('button', { name: 'Réessayer' }).click()
    await expect(page.getByText(GENERIQUE)).toHaveCount(0)
    await expect(lignesErreur(page)).toHaveCount(1)
    await expect(erreur(page, 3, 'role')).toContainText('Rôle « chef » inconnu')
  })

  test("[rule-foundation-import-preview-expires] liste des erreurs d'un aperçu expiré (404) : retour au dépôt avec « L'aperçu a expiré ou n'existe plus. Déposez à nouveau le fichier. »", async ({ page }) => {
    await admin(page)
    await simuler(page, ERRORS, 'GET', 404, { status: 404, code: 'import.preview_not_found', message: 'Aperçu introuvable' })
    await deposer(page, usersCsv([['bon@recette.test', 'user', ''], ['mauvais@recette.test', 'chef', '']]))
    await expect(page.getByText(EXPIRE)).toBeVisible()
    await expect(page.getByText('Glissez un fichier .xlsx ou .csv ici')).toBeVisible()
    await expect(page.getByText("Rien n'a encore été enregistré.")).toHaveCount(0)
    await expect(page.getByText('Aperçu introuvable')).toHaveCount(0)
  })

  test("[rule-foundation-import-two-steps] quitter la page abandonne l'aperçu sans garde de navigation ni écriture métier", async ({ page }) => {
    await admin(page)
    page.on('dialog', async (d) => {
      throw new Error('aucune garde de navigation attendue : ' + d.message())
    })
    await apercu(page, usersCsv([['abandon@recette.test', 'user', '']]))
    await retour(page).click()
    await expect(page.getByRole('heading', { name: 'Utilisateurs', exact: true })).toBeVisible()
    expect(await comptesCrees()).toEqual([])
    expect(await nb('audit_logs')).toBe(0)
    // la liste des utilisateurs ne contient que l'administrateur
    await expect(page.getByRole('cell', { name: 'abandon@recette.test' })).toHaveCount(0)
  })
})

// ───────────────────────── refus à l'analyse ─────────────────────────

test.describe("Refus d'un fichier à l'analyse", () => {
  const cas: { titre: string; regle: string; nom: string; contenu: () => Buffer; message: string | RegExp }[] = [
    {
      titre: 'texte renommé en .xlsx',
      regle: '[rule-foundation-import-content-sniffing]',
      nom: 'faux.xlsx',
      contenu: () => Buffer.from('email,role\na@x.fr,user\n'),
      message: "Ce fichier n'est ni un classeur .xlsx ni un fichier .csv valide.",
    },
    {
      titre: 'PDF renommé en .csv',
      regle: '[rule-foundation-import-content-sniffing]',
      nom: 'faux.csv',
      contenu: () => Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(200, 0x20)]),
      message: "Ce fichier n'est ni un classeur .xlsx ni un fichier .csv valide.",
    },
    {
      titre: 'classeur renommé en .csv',
      regle: '[rule-foundation-import-content-sniffing]',
      nom: 'classeur.csv',
      contenu: () => usersXlsx([['a@recette.test', 'user', '']]),
      message: "Ce fichier n'est ni un classeur .xlsx ni un fichier .csv valide.",
    },
    {
      titre: 'archive contenant un nom d\'entrée avec « .. »',
      regle: '[rule-foundation-import-archive-limits] [rule-foundation-import-trapped-files-refused]',
      nom: 'piege.xlsx',
      contenu: () => usersXlsx([['a@recette.test', 'user', '']], { extraEntries: [{ name: '../evil.txt', data: 'x' }] }),
      message: "Fichier refusé : l'archive contenue dans ce classeur est jugée dangereuse (taille décompressée excessive ou structure suspecte).",
    },
    {
      titre: 'entrée chiffrée',
      regle: '[rule-foundation-import-archive-limits] [rule-foundation-import-trapped-files-refused]',
      nom: 'chiffre.xlsx',
      contenu: () => usersXlsx([['a@recette.test', 'user', '']], { extraEntries: [{ name: 'xl/secret.bin', data: 'x', encrypted: true }] }),
      message: /Fichier refusé : l'archive contenue dans ce classeur est jugée dangereuse|Ce fichier n'est ni un classeur \.xlsx ni un fichier \.csv valide\./,
    },
    {
      titre: 'formule référençant un autre classeur',
      regle: '[rule-foundation-import-external-links-refused] [rule-foundation-import-trapped-files-refused]',
      nom: 'externe.xlsx',
      contenu: () => usersXlsx([[{ value: 'a@recette.test', formula: "'C:\\x\\[a.xlsx]S'!A1" }, 'user', '']]),
      message: 'Fichier refusé : il contient des formules ou des liaisons vers des fichiers externes. Remplacez-les par des valeurs puis réessayez.',
    },
    {
      titre: 'liaison externe (relation de cible externe)',
      regle: '[rule-foundation-import-external-links-refused] [rule-foundation-import-trapped-files-refused]',
      nom: 'liaison.xlsx',
      contenu: () =>
        usersXlsx([['a@recette.test', 'user', '']], {
          workbookRels:
            '<Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/externalLink" Target="file:///C:/x/autre.xlsx" TargetMode="External"/>',
        }),
      message: 'Fichier refusé : il contient des formules ou des liaisons vers des fichiers externes. Remplacez-les par des valeurs puis réessayez.',
    },
    {
      titre: 'en-tête valide sans ligne de données',
      regle: '[rule-foundation-import-limits]',
      nom: 'entete.csv',
      contenu: () => usersCsv([]),
      message: 'Le fichier ne contient aucune ligne de données.',
    },
    {
      titre: 'colonne obligatoire absente',
      regle: '[rule-foundation-import-header-matching]',
      nom: 'colonnes.csv',
      contenu: () => buildCsv([['e-mail', 'role'], ['a@recette.test', 'user']]),
      message: 'Colonnes manquantes ou illisibles. Vérifiez la première ligne du fichier : elle doit contenir les colonnes attendues ci-dessous.',
    },
    {
      titre: 'classeur sans colonne reconnue',
      regle: '[rule-foundation-import-header-matching]',
      nom: 'colonnes.xlsx',
      contenu: () => buildXlsx([['nom', 'prenom'], ['Durand', 'Léa']]),
      message: 'Colonnes manquantes ou illisibles. Vérifiez la première ligne du fichier : elle doit contenir les colonnes attendues ci-dessous.',
    },
  ]

  for (const c of cas) {
    test(`${c.regle} ${c.titre} : message français, retour au dépôt, rien n'est conservé`, async ({ page }) => {
      await admin(page)
      await deposer(page, c.contenu(), c.nom)
      await expect(page.getByText(c.message)).toBeVisible()
      // retour au dépôt, fichier oublié, panneau des colonnes toujours là
      await expect(page.getByText('Glissez un fichier .xlsx ou .csv ici')).toBeVisible()
      await expect(page.getByText('Colonnes attendues', { exact: true })).toBeVisible()
      await expect(page.getByText("Rien n'a encore été enregistré.")).toHaveCount(0)
      await expect(page.getByText(/import\.[a-z_]+|SQL|stack|undefined/)).toHaveCount(0)
      expect(await nb('import_previews')).toBe(0)
      expect(await comptesCrees()).toEqual([])
    })
  }

  test("[rule-foundation-import-limits] [rule-foundation-import-trapped-files-refused] trop volumineux (413) : « Le fichier est trop volumineux (maximum 100 Mo). »", async ({ page }) => {
    await admin(page)
    await simuler(page, PREVIEW, 'POST', 413, { status: 413, code: 'import.file_too_large', message: 'trop gros' })
    await deposer(page, usersCsv([['a@recette.test', 'user', '']]))
    await expect(page.getByText('Le fichier est trop volumineux (maximum 100 Mo).')).toBeVisible()
    await expect(page.getByText('Glissez un fichier .xlsx ou .csv ici')).toBeVisible()
    await expect(page.getByText('trop gros')).toHaveCount(0)
  })

  test('[rule-foundation-import-limits] trop de lignes : « Le fichier contient trop de lignes (maximum 1 000 000 lignes). »', async ({ page }) => {
    await admin(page)
    await simuler(page, PREVIEW, 'POST', 400, { status: 400, code: 'import.too_many_rows', message: 'too many' })
    await deposer(page, usersCsv([['a@recette.test', 'user', '']]))
    await expect(page.getByText(/Le fichier contient trop de lignes \(maximum 1[\s\u00a0\u202f]000[\s\u00a0\u202f]000 lignes\)\./)).toBeVisible()
    await expect(page.getByText('Glissez un fichier .xlsx ou .csv ici')).toBeVisible()
  })

  test('[rule-foundation-api-failure-handling] autre 400, 403, 500 et 401 à l\'analyse : messages génériques, aucune fuite technique ; 401 = fin de session', async ({ page }) => {
    await admin(page)
    const essais: [number, unknown, string][] = [
      [400, { status: 400, code: 'api.validation.incoming_failed', message: 'x', details: [{ path: 'file', message: 'technique' }] }, 'Données invalides. Vérifiez les champs.'],
      [403, { status: 403, code: 'security.access_denied', message: 'Forbidden resource' }, NON_AUTORISE],
      [500, undefined, GENERIQUE],
    ]
    for (const [status, body, message] of essais) {
      await page.unroute(PREVIEW).catch(() => {})
      await simuler(page, PREVIEW, 'POST', status, body)
      await deposer(page, usersCsv([['a@recette.test', 'user', '']]))
      await expect(page.getByText(message)).toBeVisible()
      await expect(page.getByText(/Forbidden resource|technique|SQL|stack|main\.js/)).toHaveCount(0)
      await expect(page.getByText('Glissez un fichier .xlsx ou .csv ici')).toBeVisible()
    }
    await page.unroute(PREVIEW)
    await simuler(page, PREVIEW, 'POST', 401, { status: 401, code: 'security.invalid_token', message: 'jeton' })
    await deposer(page, usersCsv([['a@recette.test', 'user', '']]))
    await expect(page.getByRole('heading', { name: 'Connexion' })).toBeVisible()
    expect(new URL(page.url()).pathname).toBe('/connexion')
  })

  test("[rule-foundation-import-no-double] un fichier déjà importé est refusé au dépôt : « Ce fichier a déjà été importé. Un même fichier ne peut pas être importé deux fois. »", async ({ page }) => {
    await admin(page)
    const fichier = usersCsv([['unefois@recette.test', 'user', '']])
    await apercu(page, fichier, 'premier.csv')
    await confirmer(page, 1)
    await expect(page.getByText(/1 compte(?:s|\(s\))? créé(?:s|\(s\))?\./)).toBeVisible()
    await page.getByRole('button', { name: 'Importer un autre fichier' }).click()
    await expect(page.getByText('Glissez un fichier .xlsx ou .csv ici')).toBeVisible()
    // même octets sous un autre nom : refusé
    await deposer(page, fichier, 'renomme.csv')
    await expect(page.getByText(DEJA_IMPORTE)).toBeVisible()
    await expect(page.getByText('Glissez un fichier .xlsx ou .csv ici')).toBeVisible()
    await expect(page.getByText("Rien n'a encore été enregistré.")).toHaveCount(0)
    expect(await comptesCrees()).toEqual(['unefois@recette.test'])
    // un octet de plus = un autre fichier
    await deposer(page, Buffer.concat([fichier, Buffer.from('\n')]), 'renomme.csv')
    await attendreApercu(page)
  })

  test("[rule-foundation-import-no-double] deux aperçus du même fichier sans confirmation répondent tous deux 200", async ({ page }) => {
    await admin(page)
    const fichier = usersCsv([['deux@recette.test', 'user', '']])
    await apercu(page, fichier, 'a.csv')
    await page.getByRole('button', { name: 'Choisir un autre fichier' }).click()
    await apercu(page, fichier, 'b.csv')
    await expect(page.getByText('b.csv').first()).toBeVisible()
    expect(await nb('import_previews')).toBe(2)
  })
})

// ───────────────────────── annulation de l'analyse ─────────────────────────

test.describe("Annulation de l'analyse", () => {
  test("[rule-foundation-import-cancel-analysis] [rule-foundation-import-large-files] pendant l'analyse : barre de progression, message de patience, zone inactive ; « Annuler » ramène au dépôt sans message d'erreur, une réponse tardive est ignorée", async ({ page }) => {
    await admin(page)
    let liberer!: () => void
    const porte = new Promise<void>((resolve) => (liberer = resolve))
    await simuler(
      page,
      PREVIEW,
      'POST',
      200,
      { importId: '5f0c1f1e-0000-4000-8000-000000000001', fileName: 'lent.csv', totalRows: 1, validRows: 1, errorRows: 0, expiresAt: new Date(Date.now() + 7_200_000).toISOString() },
      porte,
    )
    await deposer(page, usersCsv([['lent@recette.test', 'user', '']]), 'lent.csv')
    await expect(page.getByText('Analyse du fichier en cours…')).toBeVisible()
    await expect(page.getByText('Pour un très gros fichier, cela peut prendre plusieurs minutes. Ne fermez pas cette page.')).toBeVisible()
    await expect(page.getByRole('progressbar')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Choisir un fichier' })).toBeDisabled()
    await page.getByRole('button', { name: 'Annuler' }).click()
    await expect(page.getByText('Glissez un fichier .xlsx ou .csv ici')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Choisir un fichier' })).toBeEnabled()
    await expect(page.getByText('Analyse du fichier en cours…')).toHaveCount(0)
    await expect(page.getByRole('alert')).toHaveCount(0)
    await expect(page.getByText(GENERIQUE)).toHaveCount(0)
    // une réponse tardive de l'analyse abandonnée ne fait rien
    liberer()
    await page.waitForTimeout(700)
    await expect(page.getByText("Rien n'a encore été enregistré.")).toHaveCount(0)
    await expect(page.getByText('Glissez un fichier .xlsx ou .csv ici')).toBeVisible()
    await expect(page.getByRole('alert')).toHaveCount(0)
  })

  test("[rule-foundation-import-cancel-analysis] après une annulation on peut déposer un nouveau fichier et obtenir son aperçu", async ({ page }) => {
    await admin(page)
    let liberer!: () => void
    const porte = new Promise<void>((resolve) => (liberer = resolve))
    await simuler(page, PREVIEW, 'POST', 200, { importId: '5f0c1f1e-0000-4000-8000-000000000002', fileName: 'x.csv', totalRows: 1, validRows: 1, errorRows: 0, expiresAt: new Date().toISOString() }, porte)
    await deposer(page, usersCsv([['x@recette.test', 'user', '']]), 'x.csv')
    await expect(page.getByText('Analyse du fichier en cours…')).toBeVisible()
    await page.getByRole('button', { name: 'Annuler' }).click()
    await expect(page.getByText('Glissez un fichier .xlsx ou .csv ici')).toBeVisible()
    liberer()
    await page.unroute(PREVIEW)
    await apercu(page, usersCsv([['y@recette.test', 'user', '']]), 'y.csv')
    await expect(page.getByText('y.csv').first()).toBeVisible()
    await expect(resume(page, 'Lignes valides', 1)).toBeVisible()
  })
})

// ───────────────────────── étape 3 : confirmation ─────────────────────────

test.describe('Étape 3 : confirmation', () => {
  test("[rule-foundation-import-confirm-valid-only] [rule-foundation-import-users-no-password] [rule-foundation-import-users-groups] [rule-foundation-import-users-role] dialogue « Confirmer l'import », « Annuler » sans appel, puis confirmation : alerte de succès, comptes, rôles et groupes enregistrés, erreurs ignorées", async ({ page }) => {
    await connecter(page, 'admin')
    await sql("insert into base.groups (name) values ('Équipe A'), ('Équipe B')")
    await ouvrirImport(page)
    const confirmations = compter(page, CONFIRM)
    await apercu(
      page,
      usersCsv([
        ['Lea@recette.test', ' admin ', 'équipe a; Équipe B ;;'],
        ['lea@recette.test', 'user', ''], // autre casse = autre compte
        ['mauvais@recette.test', 'chef', ''],
      ]),
    )
    await expect(resume(page, 'Lignes valides', 2)).toBeVisible()
    await boutonImporter(page, 2).click()
    const d = dialogue(page)
    await expect(d).toBeVisible()
    await expect(d).toContainText(new RegExp(`2 compte${S} seront créés\\.`))
    await expect(d).toContainText(new RegExp(`1 ligne${S} en erreur seront ignorées et ne seront pas importées\\.`))
    await expect(d).toContainText("Cette action est tracée au journal d'audit.")
    // annuler : aucun appel, rien d'écrit
    await d.getByRole('button', { name: 'Annuler' }).click()
    await expect(dialogue(page)).toHaveCount(0)
    expect(confirmations.n).toBe(0)
    expect(await comptesCrees()).toEqual([])
    // confirmer
    await boutonImporter(page, 2).click()
    await dialogue(page).getByRole('button', { name: "Confirmer l'import" }).click()
    await expect(page.getByText(new RegExp(`2 compte${S} créé${S}\\.`))).toBeVisible()
    await expect(page.getByRole('button', { name: 'Importer un autre fichier' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Retour aux utilisateurs' })).toBeVisible()
    await expect(page.getByText(/n'ont pas pu être enregistrées/)).toHaveCount(0)
    expect(confirmations.n).toBe(1)
    // base : comptes, rôles exacts, appartenances, secret inutilisable
    expect(await comptesCrees()).toEqual(['Lea@recette.test', 'lea@recette.test'])
    const roles = await sql<{ email: string; role: string }>("select email, role from base.users where email ilike '%lea@recette.test' order by email")
    expect(roles).toEqual([{ email: 'Lea@recette.test', role: 'admin' }, { email: 'lea@recette.test', role: 'user' }])
    const membres = await sql<{ email: string; name: string }>(
      'select u.email, g.name from base.group_users gu join base.users u on u.id = gu.user_id join base.groups g on g.id = gu.group_id order by g.name',
    )
    expect(membres).toEqual([{ email: 'Lea@recette.test', name: 'Équipe A' }, { email: 'Lea@recette.test', name: 'Équipe B' }])
    const [{ n }] = await sql<{ n: number }>("select count(*)::int n from base.credentials c join base.users u on u.id = c.user_id where u.email <> $1 and c.type = 'token'", [ADMIN_EMAIL])
    expect(n).toBe(2)
    // mémoire permanente du fichier
    const [p] = await sql<{ status: string; created_count: number; skipped_count: number }>("select status, created_count, skipped_count from base.import_previews where status = 'confirmed'")
    expect(p).toEqual({ status: 'confirmed', created_count: 2, skipped_count: 0 })
    expect(await nb('import_preview_rows')).toBe(0)
    expect(await nb('import_preview_errors')).toBe(0)
  })

  test("[rule-foundation-import-audited] la confirmation laisse une seule entrée de journal, visible dans l'écran Journal (« Import ») sans e-mail ni contenu de cellule ; l'aperçu n'en laisse aucune", async ({ page }) => {
    const a = await admin(page)
    await apercu(page, usersCsv([['trace1@recette.test', 'user', ''], ['trace2@recette.test', 'user', '']]), 'comptes.xlsx.csv')
    expect(await nb('audit_logs')).toBe(0)
    await confirmer(page, 2)
    await expect(page.getByText(new RegExp(`2 compte${S} créé${S}\\.`))).toBeVisible()
    const entrees = await sql<{ action: string; object_type: string; object_id: string; scope_code: string | null; summary: string; actor_email: string }>(
      'select action, object_type, object_id, scope_code, summary, actor_email from base.audit_logs',
    )
    expect(entrees).toHaveLength(1)
    const [importId] = (await sql<{ id: string }>("select id from base.import_previews where status = 'confirmed'")).map((r) => r.id)
    expect(entrees[0]).toEqual({
      action: 'users:import-confirm',
      object_type: 'Import de comptes',
      object_id: importId,
      scope_code: null,
      summary: 'Import de 2 comptes depuis « comptes.xlsx.csv »',
      actor_email: a.email,
    })
    await page.getByRole('navigation', { name: 'Administration' }).getByRole('link', { name: 'Journal', exact: true }).click()
    await expect(page.getByRole('heading', { name: "Journal d'audit", exact: true })).toBeVisible()
    const lignes = page.getByRole('row').filter({ has: page.getByRole('cell') })
    await expect(lignes).toHaveCount(1)
    await expect(lignes.first()).toContainText('Import de 2 comptes depuis « comptes.xlsx.csv »')
    await expect(lignes.first()).toContainText('users:import-confirm')
    await expect(lignes.first()).toContainText('Import de comptes')
    await expect(lignes.first()).toContainText(a.email)
    await expect(lignes.first().getByText('Import', { exact: true })).toBeVisible()
    await expect(lignes.first()).not.toContainText('trace1@recette.test')
  })

  test("[rule-foundation-import-confirm-valid-only] après un import, « Retour aux utilisateurs » mène à /utilisateurs où les comptes importés figurent avec leur rôle et leurs groupes", async ({ page }) => {
    await connecter(page, 'admin')
    await sql("insert into base.groups (name) values ('Équipe A')")
    await ouvrirImport(page)
    await apercu(page, usersCsv([['liste1@recette.test', 'user', 'Équipe A'], ['liste2@recette.test', 'admin', '']]))
    await confirmer(page, 2)
    await expect(page.getByText(new RegExp(`2 compte${S} créé${S}\\.`))).toBeVisible()
    await page.getByRole('link', { name: 'Retour aux utilisateurs' }).click()
    await expect(page.getByRole('heading', { name: 'Utilisateurs', exact: true })).toBeVisible()
    expect(new URL(page.url()).pathname).toBe('/utilisateurs')
    const l1 = page.getByRole('row').filter({ hasText: 'liste1@recette.test' })
    await expect(l1).toContainText('Utilisateur')
    await expect(l1).toContainText('Équipe A')
    const l2 = page.getByRole('row').filter({ hasText: 'liste2@recette.test' })
    await expect(l2).toContainText('Administrateur')
    await expect(l2).toContainText('Aucun groupe')
  })

  test("[rule-foundation-import-users-no-password] un compte importé existe mais ne peut pas encore se connecter : « Identifiants incorrects. » quel que soit le mot de passe, pour un user comme pour un admin", async ({ page, browser }) => {
    await admin(page)
    await apercu(page, usersCsv([['sans.mdp@recette.test', 'user', ''], ['sans.mdp.admin@recette.test', 'admin', '']]))
    await confirmer(page, 2)
    await expect(page.getByText(new RegExp(`2 compte${S} créé${S}\\.`))).toBeVisible()
    const ctx = await browser.newContext({ locale: 'fr-FR', timezoneId: 'Europe/Paris', baseURL: process.env.STUDIO_URL ?? 'http://localhost:5173' })
    try {
      const p2 = await ctx.newPage()
      for (const email of ['sans.mdp@recette.test', 'sans.mdp.admin@recette.test']) {
        for (const mdp of ['Recette-2026!', 'MotDePasse-Quelconque-1']) {
          await p2.goto('/connexion')
          await p2.getByLabel('Adresse e-mail', { exact: true }).fill(email)
          await p2.getByLabel('Mot de passe', { exact: true }).fill(mdp)
          await p2.getByRole('button', { name: 'Se connecter' }).click()
          await expect(p2.getByText('Identifiants incorrects.')).toBeVisible()
          expect(new URL(p2.url()).pathname).toBe('/connexion')
        }
      }
    } finally {
      await ctx.close()
    }
  })

  test("[rule-foundation-import-confirm-revalidates] un compte créé entre l'aperçu et la confirmation est ignoré : succès partiel et avertissement, sans faire échouer l'import", async ({ page }) => {
    await admin(page)
    await apercu(page, usersCsv([['nouveau@recette.test', 'user', ''], ['entre.temps@recette.test', 'user', '']]))
    await expect(resume(page, 'Lignes valides', 2)).toBeVisible()
    await account('user', 'entre.temps@recette.test')
    await confirmer(page, 2)
    await expect(page.getByText(new RegExp(`1 compte${S} créé${S}\\.`))).toBeVisible()
    await expect(
      page.getByText(new RegExp(`1 ligne${S} valide${S} à l'aperçu n'ont pas pu être enregistrées \\(par exemple parce qu'un compte a été créé entre-temps\\)\\.`)),
    ).toBeVisible()
    expect(await comptesCrees()).toEqual(['entre.temps@recette.test', 'nouveau@recette.test'])
    const [{ n }] = await sql<{ n: number }>("select count(*)::int n from base.credentials c join base.users u on u.id = c.user_id where u.email = 'entre.temps@recette.test'")
    expect(n).toBe(1) // le compte préexistant n'a pas été touché
  })

  test("[rule-foundation-import-confirm-revalidates] un groupe disparu entre l'aperçu et la confirmation rend la ligne ignorée, sans compte orphelin", async ({ page }) => {
    await connecter(page, 'admin')
    await sql("insert into base.groups (name) values ('Éphémère')")
    await ouvrirImport(page)
    await apercu(page, usersCsv([['avec.groupe@recette.test', 'user', 'Éphémère'], ['sans.groupe@recette.test', 'user', '']]))
    await expect(resume(page, 'Lignes valides', 2)).toBeVisible()
    await sql("delete from base.groups where name = 'Éphémère'")
    await confirmer(page, 2)
    await expect(page.getByText(new RegExp(`1 compte${S} créé${S}\\.`))).toBeVisible()
    await expect(page.getByText(/n'ont pas pu être enregistrées/)).toBeVisible()
    expect(await comptesCrees()).toEqual(['sans.groupe@recette.test'])
  })

  test("[rule-foundation-import-two-steps] [rule-foundation-import-confirm-valid-only] une série de clics sur « Confirmer l'import » n'envoie qu'une requête et garde le succès", async ({ page }) => {
    await admin(page)
    await apercu(page, usersCsv([['clic1@recette.test', 'user', ''], ['clic2@recette.test', 'user', '']]))
    const confirmations = compter(page, CONFIRM)
    await boutonImporter(page, 2).click()
    const bouton = dialogue(page).getByRole('button', { name: "Confirmer l'import" })
    await expect(bouton).toBeVisible()
    await bouton.evaluate((b: HTMLElement) => {
      b.click()
      b.click()
      b.click()
    })
    await expect(page.getByText(new RegExp(`2 compte${S} créé${S}\\.`))).toBeVisible()
    await page.waitForTimeout(500)
    expect(confirmations.n).toBe(1)
    await expect(page.getByText(DEJA_IMPORTE)).toHaveCount(0)
    await expect(page.getByText(new RegExp(`2 compte${S} créé${S}\\.`))).toBeVisible()
    expect(await comptesCrees()).toEqual(['clic1@recette.test', 'clic2@recette.test'])
  })

  test('[rule-foundation-import-two-steps] pendant l\'envoi, les boutons du dialogue sont désactivés et « Import en cours… » s\'affiche', async ({ page }) => {
    await admin(page)
    await apercu(page, usersCsv([['attente@recette.test', 'user', '']]))
    let liberer!: () => void
    const porte = new Promise<void>((resolve) => (liberer = resolve))
    await page.route(CONFIRM, async (route) => {
      await porte
      await route.fallback()
    })
    await boutonImporter(page, 1).click()
    await dialogue(page).getByRole('button', { name: "Confirmer l'import" }).click()
    await expect(page.getByText('Import en cours…')).toBeVisible()
    await expect(dialogue(page).getByRole('button', { name: 'Annuler' })).toBeDisabled()
    liberer()
    await expect(page.getByText(/1 compte(?:s|\(s\))? créé(?:s|\(s\))?\./)).toBeVisible()
  })

  test("[rule-foundation-import-no-double] confirmation d'un fichier confirmé entre-temps par une autre session : 409, message de doublon et bouton « Déposer un fichier »", async ({ page, context }) => {
    await admin(page)
    const fichier = usersCsv([['double@recette.test', 'user', '']])
    await apercu(page, fichier, 'double.csv')
    // une seconde page (même administrateur) importe le même fichier
    const autre = await context.newPage()
    await autre.goto(IMPORT)
    await expect(autre.getByText('Colonnes attendues', { exact: true })).toBeVisible()
    await deposer(autre, fichier, 'double-bis.csv')
    await attendreApercu(autre)
    await confirmer(autre, 1)
    await expect(autre.getByText(/1 compte(?:s|\(s\))? créé(?:s|\(s\))?\./)).toBeVisible()
    await autre.close()
    // la première confirmation échoue : dialogue fermé, aperçu conservé, alerte au-dessus
    await confirmer(page, 1)
    await expect(page.getByText(DEJA_IMPORTE)).toBeVisible()
    await expect(dialogue(page)).toHaveCount(0)
    await expect(page.getByText(/créé(?:s|\(s\))?\./)).toHaveCount(0)
    expect(await comptesCrees()).toEqual(['double@recette.test']) // créé une seule fois
    await page.getByRole('button', { name: 'Déposer un fichier' }).click()
    await expect(page.getByText('Glissez un fichier .xlsx ou .csv ici')).toBeVisible()
  })

  test("[rule-foundation-import-preview-expires] confirmation d'un aperçu disparu (404) : « L'aperçu a expiré ou n'existe plus. Déposez à nouveau le fichier. » et « Déposer un fichier »", async ({ page }) => {
    await admin(page)
    await apercu(page, usersCsv([['perdu@recette.test', 'user', '']]))
    await sql('delete from base.import_previews')
    await confirmer(page, 1)
    await expect(page.getByText(EXPIRE)).toBeVisible()
    await expect(dialogue(page)).toHaveCount(0)
    await expect(page.getByText(/Aperçu introuvable|import\.preview_not_found/)).toHaveCount(0)
    expect(await comptesCrees()).toEqual([])
    expect(await nb('audit_logs')).toBe(0)
    await page.getByRole('button', { name: 'Déposer un fichier' }).click()
    await expect(page.getByText('Glissez un fichier .xlsx ou .csv ici')).toBeVisible()
  })

  test("[rule-foundation-import-preview-expires] aperçu d'un autre administrateur : la confirmation répond 404 et l'écran affiche le message d'aperçu expiré, rien n'est créé", async ({ page, browser }) => {
    await admin(page)
    const fichier = usersCsv([['prive@recette.test', 'user', '']])
    await apercu(page, fichier, 'prive.csv')
    const [{ id }] = await sql<{ id: string }>('select id from base.import_previews')
    // un second administrateur ne peut pas confirmer l'aperçu du premier : on simule son appel depuis son propre écran
    const b = await account('admin', 'second-admin@recette.test')
    const ctx = await browser.newContext({ locale: 'fr-FR', timezoneId: 'Europe/Paris', baseURL: process.env.STUDIO_URL ?? 'http://localhost:5173' })
    try {
      const p2 = await ctx.newPage()
      await p2.goto('/connexion')
      await p2.getByLabel('Adresse e-mail', { exact: true }).fill(b.email)
      await p2.getByLabel('Mot de passe', { exact: true }).fill(b.password)
      await p2.getByRole('button', { name: 'Se connecter' }).click()
      await expect(p2.getByRole('heading', { name: 'Bienvenue' })).toBeVisible()
      const statut = await p2.evaluate(async ({ importId, api }) => {
        const r = await fetch(`${api}/users/imports/${importId}/confirm`, { method: 'POST', credentials: 'include' })
        return r.status
      }, { importId: id, api: process.env.VITE_API_URL ?? 'http://localhost:4000' })
      expect(statut).toBe(404)
    } finally {
      await ctx.close()
    }
    // seul le second administrateur, créé par le test, existe : l'aperçu du premier n'a rien créé
    expect(await comptesCrees()).toEqual([b.email])
    // le créateur peut toujours confirmer
    await confirmer(page, 1)
    await expect(page.getByText(/1 compte(?:s|\(s\))? créé(?:s|\(s\))?\./)).toBeVisible()
  })

  test("[rule-foundation-api-failure-handling] échec de la confirmation (500) : dialogue fermé, aperçu conservé, message générique sans détail, « Réessayer » relance la confirmation", async ({ page }) => {
    await admin(page)
    await apercu(page, usersCsv([['reprise@recette.test', 'user', '']]))
    await simuler(page, CONFIRM, 'POST', 500)
    await confirmer(page, 1)
    await expect(page.getByText(GENERIQUE)).toBeVisible()
    await expect(page.getByText(/SQL|stack|api\.unknown_error|main\.js/)).toHaveCount(0)
    await expect(dialogue(page)).toHaveCount(0)
    await expect(resume(page, 'Lignes valides', 1)).toBeVisible() // l'aperçu est conservé
    expect(await comptesCrees()).toEqual([])
    await page.unroute(CONFIRM)
    await page.getByRole('button', { name: 'Réessayer' }).click()
    await expect(page.getByText(/1 compte(?:s|\(s\))? créé(?:s|\(s\))?\./)).toBeVisible()
    expect(await comptesCrees()).toEqual(['reprise@recette.test'])
  })

  test("[rule-foundation-api-failure-handling] confirmation refusée (403) : « Action non autorisée. »", async ({ page }) => {
    await admin(page)
    await apercu(page, usersCsv([['refus@recette.test', 'user', '']]))
    await simuler(page, CONFIRM, 'POST', 403, { status: 403, code: 'security.access_denied', message: 'Forbidden resource' })
    await confirmer(page, 1)
    await expect(page.getByText(NON_AUTORISE)).toBeVisible()
    await expect(page.getByText('Forbidden resource')).toHaveCount(0)
  })

  test("[rule-foundation-api-failure-handling] confirmation en 401 : fin de session, retour à la connexion", async ({ page }) => {
    await admin(page)
    await apercu(page, usersCsv([['expire@recette.test', 'user', '']]))
    await simuler(page, CONFIRM, 'POST', 401, { status: 401, code: 'security.invalid_token', message: 'jeton' })
    await confirmer(page, 1)
    await expect(page.getByRole('heading', { name: 'Connexion' })).toBeVisible()
    expect(new URL(page.url()).pathname).toBe('/connexion')
  })

  test("[rule-foundation-import-confirm-valid-only] « Importer un autre fichier » ramène au dépôt avec un état vidé, prêt pour un nouvel import", async ({ page }) => {
    await admin(page)
    await apercu(page, usersCsv([['premier@recette.test', 'user', '']]), 'un.csv')
    await confirmer(page, 1)
    await expect(page.getByText(/1 compte(?:s|\(s\))? créé(?:s|\(s\))?\./)).toBeVisible()
    await page.getByRole('button', { name: 'Importer un autre fichier' }).click()
    await expect(page.getByText('Glissez un fichier .xlsx ou .csv ici')).toBeVisible()
    await expect(page.getByText(/créé(?:s|\(s\))?\./)).toHaveCount(0)
    await expect(page.getByText('un.csv')).toHaveCount(0)
    await apercu(page, usersCsv([['second@recette.test', 'admin', '']]), 'deux.csv')
    await expect(page.getByText('deux.csv').first()).toBeVisible()
    await confirmer(page, 1)
    await expect(page.getByText(/1 compte(?:s|\(s\))? créé(?:s|\(s\))?\./)).toBeVisible()
    expect(await comptesCrees()).toEqual(['premier@recette.test', 'second@recette.test'])
    expect(await nb('audit_logs')).toBe(2)
  })

  test("[rule-foundation-import-confirm-valid-only] import d'un classeur .xlsx avec lignes en erreur : seules les lignes valides sont créées", async ({ page }) => {
    await connecter(page, 'admin')
    await sql("insert into base.groups (name) values ('Équipe A')")
    await ouvrirImport(page)
    await apercu(
      page,
      usersXlsx([
        ['xlsx1@recette.test', 'user', 'Équipe A'],
        ['xlsx2@recette.test', 'admin', ''],
        ['xlsx-mauvais@recette.test', 'ADMIN', ''],
        ['xlsx1@recette.test', 'user', ''],
      ]),
      'classeur.xlsx',
    )
    await expect(resume(page, 'Lignes lues', 4)).toBeVisible()
    await expect(resume(page, 'Lignes valides', 2)).toBeVisible()
    await expect(resume(page, 'Lignes en erreur', 2)).toBeVisible()
    await expect(erreur(page, 4, 'role')).toContainText('Rôle « ADMIN » inconnu')
    await expect(erreur(page, 5, 'email')).toContainText('Adresse déjà présente à la ligne 2 du fichier')
    await confirmer(page, 2)
    await expect(page.getByText(new RegExp(`2 compte${S} créé${S}\\.`))).toBeVisible()
    expect(await comptesCrees()).toEqual(['xlsx1@recette.test', 'xlsx2@recette.test'])
    const [{ n }] = await sql<{ n: number }>('select count(*)::int n from base.group_users')
    expect(n).toBe(1)
  })
})

// ───────────────────────── petit écran ─────────────────────────

test.describe('Petit écran', () => {
  test("[rule-foundation-import-no-client-parsing] [rule-foundation-french-ui] sous 600 px : bouton retour au-dessus du titre, étapes empilées, pas de débordement horizontal, import possible", async ({ page }) => {
    await page.setViewportSize({ width: 480, height: 900 })
    await admin(page)
    const titre = await page.getByRole('heading', { name: 'Importer des utilisateurs', exact: true }).boundingBox()
    const dos = await retour(page).boundingBox()
    expect(dos!.y + dos!.height).toBeLessThanOrEqual(titre!.y + 1) // le retour passe au-dessus du titre
    const e1 = await page.getByText('Dépôt du fichier', { exact: true }).boundingBox()
    const e2 = await page.getByText('Aperçu', { exact: true }).boundingBox()
    const e3 = await page.getByText('Confirmation', { exact: true }).boundingBox()
    expect(e2!.y).toBeGreaterThan(e1!.y + e1!.height / 2) // indicateur vertical
    expect(e3!.y).toBeGreaterThan(e2!.y + e2!.height / 2)
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false)
    await apercu(page, usersCsv([['mobile@recette.test', 'user', ''], ['mauvais', 'user', '']]))
    await expect(resume(page, 'Lignes en erreur', 1)).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false)
  })
})
