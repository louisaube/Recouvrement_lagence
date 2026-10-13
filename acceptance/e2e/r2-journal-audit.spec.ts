/**
 * Lot r2-journal-audit : écran Journal d'audit (/journal).
 * Spécification : specifications/socle/70-ecrans.md (§2, §10), 50-journal-audit.md, 98-arbitrages.md.
 * Sélection par rôle et nom accessible uniquement ; les entrées de départ sont posées par SQL (contrat de données,
 * `base.audit_logs`), les parcours de traçabilité passent par les écrans d'administration.
 * Navigateur réglé en fr-FR, fuseau Europe/Paris (playwright.config.ts).
 */
import { test, expect, account, type Page } from './fixtures'
import { sql } from '../harness'

const ADMIN_EMAIL = 'admin@recette.test'
const GENERIQUE = 'Une erreur est survenue. Veuillez réessayer.'
const NON_AUTORISE = 'Action non autorisée.'
const VIDE_SANS_FILTRE = "Aucune action n'a encore été tracée."
const VIDE_AVEC_FILTRES = 'Aucune entrée ne correspond à ces filtres.'
const AUDIT = /\/audit-logs(\?.*)?$/
const AUDIT_FILTERS = /\/audit-logs\/filters(\?.*)?$/

const U1 = '11111111-1111-4111-8111-111111111111'
const U2 = '22222222-2222-4222-8222-222222222222'
const U3 = '33333333-3333-4333-8333-333333333333'

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

interface Entree {
  at: string
  actorId?: string
  email?: string
  action?: string
  type?: string
  objectId?: string
  scope?: string | null
  summary?: string
}

async function poser(e: Entree): Promise<void> {
  await sql(
    'insert into base.audit_logs (occurred_at, actor_id, actor_email, action, object_type, object_id, scope_code, summary) values ($1, $2, $3, $4, $5, $6, $7, $8)',
    [
      e.at,
      e.actorId ?? U1,
      e.email ?? 'alice@recette.test',
      e.action ?? 'groups:update',
      e.type ?? 'Groupe',
      e.objectId ?? 'obj-1',
      e.scope ?? null,
      e.summary ?? 'Résumé de test',
    ]
  )
}

/** Pose n entrées, une par minute à partir d'un instant, résumé « Entrée k » (k = 1 la plus ancienne). */
async function poserMasse(n: number, debut = '2026-03-01T08:00:00.000Z') {
  const t0 = new Date(debut).getTime()
  for (let k = 1; k <= n; k++) {
    await poser({ at: new Date(t0 + k * 60_000).toISOString(), summary: `Entrée ${k}`, objectId: `obj-${k}` })
  }
}

async function ouvrirJournal(page: Page, requete = '') {
  await page.goto('/journal' + requete)
  await expect(page.getByRole('heading', { name: "Journal d'audit", exact: true })).toBeVisible()
}

async function admin(page: Page, requete = '') {
  const a = await connecter(page, 'admin')
  await ouvrirJournal(page, requete)
  return a
}

/** Lignes de données du tableau (hors en-tête). */
const lignes = (page: Page) => page.getByRole('row').filter({ has: page.getByRole('cell') })

/** Textes de la colonne « Résumé » (dernière colonne) dans l'ordre affiché. */
async function resumes(page: Page) {
  return (await lignes(page).locator('td:last-child, [role="cell"]:last-child').allInnerTexts()).map((t) => t.trim())
}

const champ = (page: Page, nom: string) => page.getByRole('combobox', { name: nom, exact: true })

async function choisirOption(page: Page, nom: string, option: string) {
  await champ(page, nom).click()
  await page.getByRole('option', { name: option, exact: true }).click()
}

const cheminEtRecherche = (page: Page) => {
  const u = new URL(page.url())
  return u.pathname + u.search
}

/** Remplace un point d'accès de l'API par une réponse fixe (en-têtes CORS compris). */
async function simuler(page: Page, motif: RegExp, status: number, body?: unknown) {
  await page.route(motif, async (route) => {
    if (route.request().method() !== 'GET') return route.fallback()
    const origine = await route.request().headerValue('origin')
    await route.fulfill({
      status,
      contentType: 'application/json',
      headers: origine ? { 'access-control-allow-origin': origine, 'access-control-allow-credentials': 'true' } : {},
      body: JSON.stringify(body ?? { status, code: 'api.unknown_error', message: 'détail technique SQL stack' }),
    })
  })
}

/** Compte les appels réels vers une route de l'API. */
function compter(page: Page, motif: RegExp) {
  const etat = { n: 0, urls: [] as string[] }
  page.on('request', (r) => {
    if (r.method() === 'GET' && motif.test(r.url())) {
      etat.n++
      etat.urls.push(r.url())
    }
  })
  return etat
}

// ───────────────────────── accès et navigation ─────────────────────────

test.describe('Accès, onglet et redirections', () => {
  test("[rule-foundation-audit-admin-only] [rule-foundation-admin-nav] l'administrateur voit l'onglet « Journal », actif sur /journal quels que soient les paramètres", async ({ page }) => {
    await connecter(page, 'admin')
    const nav = page.getByRole('navigation', { name: 'Administration' })
    await nav.getByRole('link', { name: 'Journal', exact: true }).click()
    await expect(page.getByRole('heading', { name: "Journal d'audit", exact: true })).toBeVisible()
    expect(new URL(page.url()).pathname).toBe('/journal')
    const actif = nav.locator('[aria-selected="true"], [aria-current]')
    await expect(actif).toHaveCount(1)
    await expect(actif).toContainText('Journal')
    await ouvrirJournal(page, '?action=groups%3Aupdate')
    await expect(nav.locator('[aria-selected="true"], [aria-current]')).toContainText('Journal')
  })

  test("[rule-foundation-audit-admin-only] [rule-foundation-admin-screens-guard] un utilisateur ordinaire n'a pas l'onglet et voit « Accès refusé » sur /journal, sans appel au journal", async ({ page }) => {
    await connecter(page, 'user')
    await expect(page.getByRole('navigation', { name: 'Administration' })).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Journal', exact: true })).toHaveCount(0)
    const appels = compter(page, /\/audit-logs/)
    await page.goto('/journal')
    await expect(page.getByRole('heading', { name: 'Accès refusé' })).toBeVisible()
    await expect(page.getByText("Vous n'avez pas les droits nécessaires pour consulter cette page.")).toBeVisible()
    expect(new URL(page.url()).pathname).toBe('/journal')
    await expect(page.getByRole('heading', { name: "Journal d'audit" })).toHaveCount(0)
    await page.waitForTimeout(500)
    expect(appels.n).toBe(0)
    await page.getByRole('button', { name: "Retour à l'accueil" }).click()
    await expect(page.getByRole('heading', { name: 'Bienvenue' })).toBeVisible()
    expect(new URL(page.url()).pathname).toBe('/')
  })

  test('[rule-foundation-protected-redirect] [rule-foundation-audit-shareable-filter] sans session, un lien filtré redirige vers la connexion puis revient au même lien filtré', async ({ page }) => {
    const a = await account('admin', ADMIN_EMAIL)
    await poser({ at: '2026-03-01T10:00:00.000Z', action: 'groups:update', summary: 'Cible du lien' })
    await poser({ at: '2026-03-01T11:00:00.000Z', action: 'scopes:create', type: 'Périmètre', scope: 'site-a', summary: 'Autre entrée' })
    const cible = '/journal?action=groups%3Aupdate&du=2026-03-01'
    await page.goto(cible)
    await expect(page.getByRole('heading', { name: 'Connexion' })).toBeVisible()
    const u = new URL(page.url())
    expect(u.pathname).toBe('/connexion')
    expect(u.searchParams.get('redirection')).toBe(cible)
    await page.getByLabel('Adresse e-mail', { exact: true }).fill(a.email)
    await page.getByLabel('Mot de passe', { exact: true }).fill(a.password)
    await page.getByRole('button', { name: 'Se connecter' }).click()
    await expect(page.getByRole('heading', { name: "Journal d'audit", exact: true })).toBeVisible()
    expect(cheminEtRecherche(page)).toBe(cible)
    await expect(page.getByText('Cible du lien')).toBeVisible()
    await expect(page.getByText('Autre entrée')).toHaveCount(0)
  })
})

// ───────────────────────── éléments de l'écran ─────────────────────────

test.describe("Éléments de l'écran", () => {
  test("[rule-foundation-audit-french-screen] [rule-foundation-audit-immutable] titre, bouton « Copier le lien », filtres, colonnes ; aucune colonne d'actions ni commande de modification, suppression ou export", async ({ page }) => {
    await poser({ at: '2026-03-01T10:00:00.000Z' })
    await admin(page)
    await expect(page.getByRole('button', { name: 'Copier le lien' })).toBeVisible()
    for (const f of ['Auteur', 'Action', "Type d'objet", 'Périmètre']) {
      await expect(champ(page, f)).toBeVisible()
    }
    await expect(page.getByLabel('Du', { exact: true })).toBeVisible()
    await expect(page.getByLabel('Au', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Réinitialiser les filtres' })).toBeDisabled()
    for (const col of ['Date', 'Auteur', 'Action', 'Objet', 'Périmètre', 'Résumé']) {
      await expect(page.getByRole('columnheader', { name: col, exact: true })).toBeVisible()
    }
    await expect(page.getByRole('columnheader')).toHaveCount(6)
    await expect(page.getByRole('columnheader', { name: 'Actions', exact: true })).toHaveCount(0)
    for (const interdit of [/modifier/i, /supprimer/i, /effacer/i, /exporter/i, /export/i, /télécharger/i, /nouveau/i, /nouvelle/i]) {
      await expect(page.getByRole('button', { name: interdit })).toHaveCount(0)
      await expect(page.getByRole('link', { name: interdit })).toHaveCount(0)
    }
    await expect(page.getByText('Lignes par page :')).toBeVisible()
  })

  test("[rule-foundation-audit-french-screen] [rule-foundation-audit-newest-first] [rule-foundation-audit-summary-no-secret] une entrée est affichée en français : date du navigateur, auteur, pastille d'action, objet, périmètre, résumé", async ({ page }) => {
    await poser({
      at: '2026-01-31T10:15:30.123Z',
      email: 'alice@recette.test',
      action: 'scopes:create',
      type: 'Périmètre',
      objectId: 'a1b2c3d4-0000-4000-8000-000000000001',
      scope: 'creche-parc',
      summary: 'Création du périmètre « Crèche du Parc » (creche-parc)',
    })
    await poser({
      at: '2026-07-01T10:00:00.000Z',
      email: 'bruno@recette.test',
      actorId: U2,
      action: 'groups:update',
      type: 'Groupe',
      objectId: 'grp-2',
      scope: null,
      summary: 'Modification du groupe « Équipe du Parc » (membres)',
    })
    await admin(page)
    await expect(lignes(page)).toHaveCount(2)
    // plus récente d'abord ; heure d'été (UTC+2) puis heure d'hiver (UTC+1), fuseau Europe/Paris
    const premiere = lignes(page).nth(0)
    await expect(premiere).toContainText('01/07/2026 12:00:00')
    await expect(premiere).toContainText('bruno@recette.test')
    await expect(premiere.getByText('Modification', { exact: true })).toBeVisible()
    await expect(premiere.getByText('groups:update', { exact: true })).toBeVisible()
    await expect(premiere.getByText('Groupe', { exact: true })).toBeVisible()
    await expect(premiere.getByText('grp-2', { exact: true })).toBeVisible()
    await expect(premiere.getByText('—', { exact: true })).toBeVisible()
    await expect(premiere.getByText('Modification du groupe « Équipe du Parc » (membres)')).toBeVisible()
    const seconde = lignes(page).nth(1)
    await expect(seconde).toContainText('31/01/2026 11:15:30')
    await expect(seconde).toContainText('alice@recette.test')
    await expect(seconde.getByText('Création', { exact: true })).toBeVisible()
    await expect(seconde.getByText('scopes:create', { exact: true })).toBeVisible()
    await expect(seconde.getByText('Périmètre', { exact: true })).toBeVisible()
    await expect(seconde.getByText('creche-parc', { exact: true })).toBeVisible()
    await expect(seconde.getByText('Création du périmètre « Crèche du Parc » (creche-parc)')).toBeVisible()
    // valeur ISO conservée en attribut machine
    await expect(seconde.locator('time')).toHaveAttribute('datetime', /^2026-01-31T10:15:30(\.123)?(Z|\+00:00)$/)
    await expect(page.getByText('1–2 sur 2')).toBeVisible()
  })

  test("[rule-foundation-audit-french-screen] le verbe de l'action est traduit : Création, Modification, Suppression, « Import » pour import-confirm, suffixe brut sinon", async ({ page }) => {
    await poser({ at: '2026-03-01T10:00:00.000Z', action: 'users:create', type: 'Utilisateur', summary: 'S1' })
    await poser({ at: '2026-03-01T10:01:00.000Z', action: 'users:update', type: 'Utilisateur', summary: 'S2' })
    await poser({ at: '2026-03-01T10:02:00.000Z', action: 'orders:delete', type: 'Commande', summary: 'S3' })
    await poser({ at: '2026-03-01T10:03:00.000Z', action: 'users:import-confirm', type: 'Import de comptes', summary: 'S4' })
    await poser({ at: '2026-03-01T10:04:00.000Z', action: 'orders:archive', type: 'Commande', summary: 'S5' })
    await admin(page)
    const l = (s: string) => lignes(page).filter({ hasText: s })
    await expect(l('S1').getByText('Création', { exact: true })).toBeVisible()
    await expect(l('S1').getByText('users:create', { exact: true })).toBeVisible()
    await expect(l('S2').getByText('Modification', { exact: true })).toBeVisible()
    await expect(l('S3').getByText('Suppression', { exact: true })).toBeVisible()
    await expect(l('S3').getByText('orders:delete', { exact: true })).toBeVisible()
    await expect(l('S4').getByText('Import', { exact: true })).toBeVisible()
    await expect(l('S4').getByText('users:import-confirm', { exact: true })).toBeVisible()
    await expect(l('S4').getByText('Import de comptes', { exact: true })).toBeVisible()
    await expect(l('S5').getByText('archive', { exact: true })).toBeVisible()
    await expect(l('S5').getByText('orders:archive', { exact: true })).toBeVisible()
  })

  test("[rule-foundation-audit-newest-first] l'ordre est le plus récent d'abord, sans tri possible par l'utilisateur", async ({ page }) => {
    await poser({ at: '2026-03-01T10:00:00.000Z', summary: 'Ancienne' })
    await poser({ at: '2026-03-03T10:00:00.000Z', summary: 'Récente' })
    await poser({ at: '2026-03-02T10:00:00.000Z', summary: 'Milieu' })
    await admin(page)
    expect(await resumes(page)).toEqual(['Récente', 'Milieu', 'Ancienne'])
    await page.getByRole('columnheader', { name: 'Date', exact: true }).click()
    expect(await resumes(page)).toEqual(['Récente', 'Milieu', 'Ancienne'])
    await expect(page.getByRole('button', { name: /trier|sort/i })).toHaveCount(0)
  })

  test("[rule-foundation-audit-french-screen] l'identifiant d'objet long est tronqué, sa valeur complète est dans l'infobulle", async ({ page }) => {
    const long = 'identifiant-' + 'x'.repeat(88)
    await poser({ at: '2026-03-01T10:00:00.000Z', objectId: long, summary: 'Objet à identifiant long' })
    await admin(page)
    const id = lignes(page).first().getByText(/^identifiant-x/)
    await expect(id).toBeVisible()
    await id.hover()
    await expect(page.getByRole('tooltip')).toHaveText(long)
  })

  test('[rule-foundation-audit-summary-no-secret] [rule-foundation-audit-french-screen] le résumé est du texte brut : le HTML n\'est jamais interprété', async ({ page }) => {
    const html = 'Création du groupe « <img src=x onerror="window.__xss=1"> <b>gras</b> » (0 membre)'
    await poser({ at: '2026-03-01T10:00:00.000Z', summary: html })
    await admin(page)
    await expect(lignes(page).first().getByText(html, { exact: true })).toBeVisible()
    await expect(page.locator('td img, td b')).toHaveCount(0)
    expect(await page.evaluate(() => (window as any).__xss)).toBeUndefined()
  })

  test("[rule-foundation-audit-survives-author-deletion] l'e-mail enregistré d'un auteur sans compte est affiché tel quel et l'auteur reste sélectionnable", async ({ page }) => {
    await poser({ at: '2026-03-01T10:00:00.000Z', actorId: U3, email: 'ancien.admin@recette.test', summary: 'Action de l\'ancien admin' })
    await poser({ at: '2026-03-01T11:00:00.000Z', actorId: U1, email: 'alice@recette.test', summary: 'Action d\'Alice' })
    await admin(page)
    await expect(lignes(page).filter({ hasText: 'ancien.admin@recette.test' })).toHaveCount(1)
    await champ(page, 'Auteur').click()
    await expect(page.getByRole('option', { name: 'ancien.admin@recette.test', exact: true })).toBeVisible()
    await page.getByRole('option', { name: 'ancien.admin@recette.test', exact: true }).click()
    await expect(lignes(page)).toHaveCount(1)
    await expect(lignes(page).first()).toContainText("Action de l'ancien admin")
    expect(new URL(page.url()).searchParams.get('auteur')).toBe(U3)
  })
})

// ───────────────────────── états vides, chargement, erreurs ─────────────────────────

test.describe('États de la liste', () => {
  test('[rule-foundation-audit-french-screen] journal vide : « Aucune action n\'a encore été tracée. » et aucune valeur de filtre', async ({ page }) => {
    await admin(page)
    await expect(page.getByText(VIDE_SANS_FILTRE)).toBeVisible()
    await expect(lignes(page)).toHaveCount(0)
    await champ(page, 'Action').click()
    await expect(page.getByRole('option')).toHaveCount(1)
    await expect(page.getByRole('option', { name: 'Toutes', exact: true })).toBeVisible()
  })

  test('[rule-foundation-audit-filters-combine] [rule-foundation-audit-french-screen] filtres sans résultat : « Aucune entrée ne correspond à ces filtres. »', async ({ page }) => {
    await poser({ at: '2026-03-01T10:00:00.000Z', action: 'groups:update' })
    await poser({ at: '2026-03-01T11:00:00.000Z', action: 'scopes:create', type: 'Périmètre', scope: 'site-a' })
    await admin(page)
    // action d'un côté, périmètre de l'autre : l'intersection est vide
    await choisirOption(page, 'Action', 'Modification — groups:update')
    await choisirOption(page, 'Périmètre', 'site-a')
    await expect(page.getByText(VIDE_AVEC_FILTRES)).toBeVisible()
    await expect(page.getByText(VIDE_SANS_FILTRE)).toHaveCount(0)
    await expect(lignes(page)).toHaveCount(0)
  })

  test('[rule-foundation-api-failure-handling] [rule-foundation-audit-french-screen] erreur 500 de la liste : message générique sans détail technique, « Réessayer » recharge', async ({ page }) => {
    await poser({ at: '2026-03-01T10:00:00.000Z', summary: 'Visible après reprise' })
    await connecter(page, 'admin')
    await simuler(page, AUDIT, 500)
    await ouvrirJournal(page)
    await expect(page.getByText(GENERIQUE)).toBeVisible()
    await expect(page.getByText(/SQL|stack|api\.unknown_error/)).toHaveCount(0)
    await page.unroute(AUDIT)
    await page.getByRole('button', { name: 'Réessayer' }).click()
    await expect(page.getByText('Visible après reprise')).toBeVisible()
    await expect(page.getByText(GENERIQUE)).toHaveCount(0)
  })

  test('[rule-foundation-api-failure-handling] erreur 403 de la liste : « Action non autorisée. »', async ({ page }) => {
    await connecter(page, 'admin')
    await simuler(page, AUDIT, 403, { status: 403, code: 'security.access_denied', message: 'Forbidden resource' })
    await ouvrirJournal(page)
    await expect(page.getByText(NON_AUTORISE)).toBeVisible()
    await expect(page.getByText('Forbidden resource')).toHaveCount(0)
  })

  test('[rule-foundation-api-failure-handling] erreur 401 de la liste : fin de session, retour à la connexion', async ({ page }) => {
    await connecter(page, 'admin')
    await simuler(page, AUDIT, 401, { status: 401, code: 'security.invalid_token', message: 'jeton' })
    await ouvrirJournal(page)
    await expect(page.getByRole('heading', { name: 'Connexion' })).toBeVisible()
    expect(new URL(page.url()).pathname).toBe('/connexion')
  })

  test('[rule-foundation-audit-french-screen] échec du chargement des valeurs de filtre : avertissement et « Réessayer », la liste reste lisible', async ({ page }) => {
    await poser({ at: '2026-03-01T10:00:00.000Z', action: 'groups:update', summary: 'Liste lisible' })
    await connecter(page, 'admin')
    await simuler(page, AUDIT_FILTERS, 500)
    await ouvrirJournal(page)
    await expect(page.getByText('Impossible de charger les valeurs des filtres.')).toBeVisible()
    await expect(page.getByText('Liste lisible')).toBeVisible()
    await page.unroute(AUDIT_FILTERS)
    await page.getByRole('button', { name: 'Réessayer' }).click()
    await expect(page.getByText('Impossible de charger les valeurs des filtres.')).toHaveCount(0)
    await champ(page, 'Action').click()
    await expect(page.getByRole('option', { name: 'Modification — groups:update', exact: true })).toBeVisible()
  })
})

// ───────────────────────── valeurs de filtre ─────────────────────────

test.describe('Valeurs de filtre', () => {
  test('[rule-foundation-audit-filter-options-from-journal] [rule-foundation-audit-french-screen] les listes sont tirées du journal (« Toutes » / « Tous » en tête), jamais des comptes ni des périmètres existants', async ({ page }) => {
    await sql("insert into base.scopes (code, name) values ('jamais-tracee', 'Jamais tracée')")
    await sql("insert into base.users (email, role) values ('inactif@recette.test', 'user')")
    await poser({ at: '2026-03-01T10:00:00.000Z', action: 'groups:update', type: 'Groupe', scope: null })
    await poser({ at: '2026-03-01T11:00:00.000Z', action: 'scopes:create', type: 'Périmètre', scope: 'site-a', actorId: U2, email: 'Bruno@recette.test' })
    await poser({ at: '2026-03-01T12:00:00.000Z', action: 'users:create', type: 'Utilisateur', scope: null })
    await admin(page)

    await champ(page, 'Action').click()
    const options = page.getByRole('option')
    await expect(options.first()).toHaveText('Toutes')
    await expect(page.getByRole('option', { name: 'Modification — groups:update', exact: true })).toBeVisible()
    await expect(page.getByRole('option', { name: 'Création — scopes:create', exact: true })).toBeVisible()
    await expect(page.getByRole('option', { name: 'Création — users:create', exact: true })).toBeVisible()
    await expect(options).toHaveCount(4)
    await page.keyboard.press('Escape')

    await champ(page, "Type d'objet").click()
    await expect(page.getByRole('option').first()).toHaveText('Tous')
    for (const t of ['Groupe', 'Périmètre', 'Utilisateur']) await expect(page.getByRole('option', { name: t, exact: true })).toBeVisible()
    await expect(page.getByRole('option')).toHaveCount(4)
    await page.keyboard.press('Escape')

    await champ(page, 'Périmètre').click()
    await expect(page.getByRole('option').first()).toHaveText('Tous')
    await expect(page.getByRole('option', { name: 'site-a', exact: true })).toBeVisible()
    await expect(page.getByRole('option', { name: 'jamais-tracee', exact: true })).toHaveCount(0)
    await expect(page.getByRole('option')).toHaveCount(2)
    await page.keyboard.press('Escape')

    await champ(page, 'Auteur').click()
    await expect(page.getByRole('option', { name: 'alice@recette.test', exact: true })).toBeVisible()
    await expect(page.getByRole('option', { name: 'Bruno@recette.test', exact: true })).toBeVisible()
    await expect(page.getByRole('option', { name: 'inactif@recette.test', exact: true })).toHaveCount(0)
    await expect(page.getByRole('option', { name: ADMIN_EMAIL, exact: true })).toHaveCount(0)
  })

  test('[rule-foundation-audit-filter-options-from-journal] les valeurs de filtre sont chargées une seule fois à l\'ouverture', async ({ page }) => {
    await poserMasse(3)
    await connecter(page, 'admin')
    const filtres = compter(page, AUDIT_FILTERS)
    await ouvrirJournal(page)
    await choisirOption(page, 'Action', 'Modification — groups:update')
    await choisirOption(page, "Type d'objet", 'Groupe')
    await expect(lignes(page)).toHaveCount(3)
    expect(filtres.n).toBe(1)
  })

  test('[rule-foundation-audit-french-screen] « Auteur » : choix unique avec saisie et « Aucun auteur » quand rien ne correspond', async ({ page }) => {
    await poser({ at: '2026-03-01T10:00:00.000Z', actorId: U1, email: 'alice@recette.test', summary: 'Par Alice' })
    await poser({ at: '2026-03-01T11:00:00.000Z', actorId: U2, email: 'bruno@recette.test', summary: 'Par Bruno' })
    await admin(page)
    const auteur = champ(page, 'Auteur')
    await auteur.fill('brun')
    await expect(page.getByRole('option')).toHaveCount(1)
    await expect(page.getByRole('option', { name: 'bruno@recette.test', exact: true })).toBeVisible()
    await auteur.fill('zzz')
    await expect(page.getByText('Aucun auteur', { exact: true })).toBeVisible()
    await auteur.fill('brun')
    await page.getByRole('option', { name: 'bruno@recette.test', exact: true }).click()
    await expect(lignes(page)).toHaveCount(1)
    await expect(lignes(page).first()).toContainText('Par Bruno')
    expect(new URL(page.url()).searchParams.get('auteur')).toBe(U2)
  })
})

// ───────────────────────── filtrage ─────────────────────────

test.describe('Filtrage', () => {
  test("[rule-foundation-audit-filters] [rule-foundation-audit-shareable-filter] filtrer par action met l'adresse à jour (nouvelle entrée d'historique) et ne garde que les entrées de l'action exacte", async ({ page }) => {
    await poser({ at: '2026-03-01T10:00:00.000Z', action: 'groups:update', summary: 'G1' })
    await poser({ at: '2026-03-01T11:00:00.000Z', action: 'groups:create', summary: 'G2' })
    await poser({ at: '2026-03-01T12:00:00.000Z', action: 'groups:update', summary: 'G3' })
    await admin(page)
    await expect(lignes(page)).toHaveCount(3)
    const appel = page.waitForRequest((r) => AUDIT.test(r.url()) && new URL(r.url()).searchParams.get('action') === 'groups:update')
    await choisirOption(page, 'Action', 'Modification — groups:update')
    const url = new URL((await appel).url())
    // seuls les filtres non vides sont envoyés
    expect([...url.searchParams.keys()].filter((k) => !['from', 'size'].includes(k))).toEqual(['action'])
    expect(await resumes(page)).toEqual(['G3', 'G1'])
    expect(cheminEtRecherche(page)).toBe('/journal?action=groups%3Aupdate')
    await expect(page.getByText('1–2 sur 2')).toBeVisible()
    await page.goBack()
    expect(cheminEtRecherche(page)).toBe('/journal')
    await expect(lignes(page)).toHaveCount(3)
    await expect(champ(page, 'Action')).toContainText('Toutes')
  })

  test("[rule-foundation-audit-filters] [rule-foundation-audit-filters-combine] type d'objet, périmètre et auteur se combinent par ET ; « Réinitialiser les filtres » les efface", async ({ page }) => {
    await poser({ at: '2026-03-01T10:00:00.000Z', actorId: U1, email: 'alice@recette.test', action: 'scopes:create', type: 'Périmètre', scope: 'site-a', summary: 'A-site-a' })
    await poser({ at: '2026-03-01T11:00:00.000Z', actorId: U2, email: 'bruno@recette.test', action: 'scopes:update', type: 'Périmètre', scope: 'site-a', summary: 'B-site-a' })
    await poser({ at: '2026-03-01T12:00:00.000Z', actorId: U1, email: 'alice@recette.test', action: 'scopes:create', type: 'Périmètre', scope: 'site-b', summary: 'A-site-b' })
    await poser({ at: '2026-03-01T13:00:00.000Z', actorId: U1, email: 'alice@recette.test', action: 'groups:create', type: 'Groupe', summary: 'A-groupe' })
    await admin(page)
    await expect(lignes(page)).toHaveCount(4)

    await choisirOption(page, "Type d'objet", 'Périmètre')
    await expect(lignes(page)).toHaveCount(3)
    await choisirOption(page, 'Périmètre', 'site-a')
    await expect(lignes(page)).toHaveCount(2)
    await champ(page, 'Auteur').click()
    await page.getByRole('option', { name: 'alice@recette.test', exact: true }).click()
    await expect(lignes(page)).toHaveCount(1)
    await expect(lignes(page).first()).toContainText('A-site-a')
    const q = new URL(page.url()).searchParams
    expect(q.get('type')).toBe('Périmètre')
    expect(q.get('perimetre')).toBe('site-a')
    expect(q.get('auteur')).toBe(U1)
    await expect(page.getByText('1–1 sur 1')).toBeVisible()

    const reset = page.getByRole('button', { name: 'Réinitialiser les filtres' })
    await expect(reset).toBeEnabled()
    await reset.click()
    await expect(lignes(page)).toHaveCount(4)
    await expect(reset).toBeDisabled()
    expect(cheminEtRecherche(page)).toBe('/journal')
  })
})

// ───────────────────────── période ─────────────────────────

test.describe('Période', () => {
  test('[rule-foundation-audit-period-inclusive-days] [rule-foundation-audit-ms-precision] « Du » et « Au » sont des jours civils entiers (fuseau du navigateur), bornes incluses à la milliseconde', async ({ page }) => {
    // Europe/Paris en mars 2026 = UTC+1 : le jour civil du 10 mars va de 2026-03-09T23:00:00.000Z à 2026-03-10T22:59:59.999Z
    await poser({ at: '2026-03-09T22:59:59.999Z', summary: 'Avant (9 mars 23:59:59.999)' })
    await poser({ at: '2026-03-09T23:00:00.000Z', summary: 'Début inclus (10 mars 00:00:00.000)' })
    await poser({ at: '2026-03-10T12:00:00.000Z', summary: 'Milieu' })
    await poser({ at: '2026-03-10T22:59:59.999Z', summary: 'Fin incluse (10 mars 23:59:59.999)' })
    await poser({ at: '2026-03-10T23:00:00.000Z', summary: 'Après (11 mars 00:00:00.000)' })
    await admin(page)
    await expect(lignes(page)).toHaveCount(5)

    const appel = page.waitForRequest((r) => {
      const p = new URL(r.url()).searchParams
      return AUDIT.test(r.url()) && p.get('occurredFrom') === '2026-03-09T23:00:00.000Z'
    })
    await page.getByLabel('Du', { exact: true }).fill('2026-03-10')
    const p = new URL((await appel).url()).searchParams
    expect(p.get('occurredTo')).toBeNull()
    await expect(lignes(page)).toHaveCount(4)

    const appel2 = page.waitForRequest((r) => AUDIT.test(r.url()) && new URL(r.url()).searchParams.get('occurredTo') === '2026-03-10T22:59:59.999Z')
    await page.getByLabel('Au', { exact: true }).fill('2026-03-10')
    await appel2
    await expect(lignes(page)).toHaveCount(3)
    expect(await resumes(page)).toEqual(['Fin incluse (10 mars 23:59:59.999)', 'Milieu', 'Début inclus (10 mars 00:00:00.000)'])
    await expect(page.getByText('1–3 sur 3')).toBeVisible()
    // les dates remplacent l'entrée d'historique et sont portées par l'adresse
    expect(cheminEtRecherche(page)).toBe('/journal?du=2026-03-10&au=2026-03-10')
  })

  test('[rule-foundation-audit-period-inclusive-days] « Du » postérieur à « Au » : message sur les deux champs à la place des résultats, aucun appel', async ({ page }) => {
    await poserMasse(3)
    await connecter(page, 'admin')
    await ouvrirJournal(page)
    await expect(lignes(page)).toHaveCount(3)
    const appels = compter(page, AUDIT)
    await page.getByLabel('Du', { exact: true }).fill('2026-03-20')
    await expect(lignes(page)).toHaveCount(0)
    await page.getByLabel('Au', { exact: true }).fill('2026-03-10')
    await expect(page.getByText('La date de début doit précéder la date de fin.').first()).toBeVisible()
    await expect(page.getByLabel('Du', { exact: true })).toHaveAttribute('aria-invalid', 'true')
    await expect(page.getByLabel('Au', { exact: true })).toHaveAttribute('aria-invalid', 'true')
    await expect(lignes(page)).toHaveCount(0)
    await expect(page.getByText(VIDE_AVEC_FILTRES)).toHaveCount(0)
    await expect(page.getByText(VIDE_SANS_FILTRE)).toHaveCount(0)
    const avant = appels.n
    await page.waitForTimeout(500)
    expect(appels.n).toBe(avant)
    expect(appels.urls.filter((u) => u.includes('occurredFrom=2026-03-19T23') && u.includes('occurredTo=2026-03-10'))).toEqual([])
    // corriger la période restaure les résultats
    await page.getByLabel('Au', { exact: true }).fill('2026-03-31')
    await expect(page.getByText('La date de début doit précéder la date de fin.')).toHaveCount(0)
  })
})

// ───────────────────────── pagination ─────────────────────────

test.describe('Pagination', () => {
  test('[rule-foundation-list-pagination] [rule-foundation-audit-newest-first] 27 entrées : 10 par page, « 1–10 sur 27 », pages suivantes dans l\'ordre, 25 puis 50 par page', async ({ page }) => {
    await poserMasse(27)
    await admin(page)
    await expect(page.getByText('Lignes par page :')).toBeVisible()
    await expect(page.getByText('1–10 sur 27')).toBeVisible()
    await expect(lignes(page)).toHaveCount(10)
    expect((await resumes(page))[0]).toBe('Entrée 27')
    expect((await resumes(page))[9]).toBe('Entrée 18')
    await page.getByRole('button', { name: /page suivante|next page/i }).click()
    await expect(page.getByText('11–20 sur 27')).toBeVisible()
    expect((await resumes(page))[0]).toBe('Entrée 17')
    await page.getByRole('button', { name: /page suivante|next page/i }).click()
    await expect(page.getByText('21–27 sur 27')).toBeVisible()
    await expect(lignes(page)).toHaveCount(7)
    expect((await resumes(page))[6]).toBe('Entrée 1')
    // la page n'est pas portée par l'adresse
    expect(cheminEtRecherche(page)).toBe('/journal')

    await page.getByRole('combobox', { name: 'Lignes par page :' }).click()
    await expect(page.getByRole('option')).toHaveText(['10', '25', '50'])
    await page.getByRole('option', { name: '25', exact: true }).click()
    await expect(page.getByText('1–25 sur 27')).toBeVisible()
    await expect(lignes(page)).toHaveCount(25)
    await page.getByRole('combobox', { name: 'Lignes par page :' }).click()
    await page.getByRole('option', { name: '50', exact: true }).click()
    await expect(page.getByText('1–27 sur 27')).toBeVisible()
    await expect(lignes(page)).toHaveCount(27)
  })

  test("[rule-foundation-audit-shareable-filter] [rule-foundation-audit-filters-combine] modifier un filtre depuis la page 2 revient à la première page ; le total compte les entrées filtrées", async ({ page }) => {
    for (let k = 1; k <= 12; k++) {
      await poser({ at: new Date(Date.UTC(2026, 2, 1, 8, k)).toISOString(), action: 'groups:update', summary: `Maj ${k}` })
    }
    for (let k = 1; k <= 3; k++) {
      await poser({ at: new Date(Date.UTC(2026, 2, 2, 8, k)).toISOString(), action: 'groups:create', summary: `Cré ${k}` })
    }
    await admin(page)
    await expect(page.getByText('1–10 sur 15')).toBeVisible()
    await page.getByRole('button', { name: /page suivante|next page/i }).click()
    await expect(page.getByText('11–15 sur 15')).toBeVisible()
    await choisirOption(page, 'Action', 'Création — groups:create')
    await expect(page.getByText('1–3 sur 3')).toBeVisible()
    expect(await resumes(page)).toEqual(['Cré 3', 'Cré 2', 'Cré 1'])
  })
})

// ───────────────────────── lien partageable ─────────────────────────

test.describe('Lien partageable et adresse assainie', () => {
  test('[rule-foundation-audit-shareable-filter] ouvrir un lien restaure tous les filtres dans les contrôles ; les autres paramètres d\'adresse sont conservés', async ({ page }) => {
    await poser({ at: '2026-03-10T10:00:00.000Z', actorId: U1, email: 'alice@recette.test', action: 'scopes:create', type: 'Périmètre', scope: 'site-a', summary: 'Visée' })
    await poser({ at: '2026-03-10T11:00:00.000Z', actorId: U2, email: 'bruno@recette.test', action: 'scopes:create', type: 'Périmètre', scope: 'site-a', summary: 'Autre auteur' })
    await poser({ at: '2026-04-10T11:00:00.000Z', actorId: U1, email: 'alice@recette.test', action: 'scopes:create', type: 'Périmètre', scope: 'site-a', summary: 'Hors période' })
    await poser({ at: '2026-03-10T12:00:00.000Z', actorId: U1, email: 'alice@recette.test', action: 'groups:create', type: 'Groupe', summary: 'Autre action' })
    await connecter(page, 'admin')
    await ouvrirJournal(page, `?auteur=${U1}&action=scopes%3Acreate&type=P%C3%A9rim%C3%A8tre&perimetre=site-a&du=2026-03-01&au=2026-03-31&ref=campagne`)
    await expect(lignes(page)).toHaveCount(1)
    await expect(lignes(page).first()).toContainText('Visée')
    await expect(champ(page, 'Auteur')).toHaveValue('alice@recette.test')
    await expect(champ(page, 'Action')).toContainText('Création — scopes:create')
    await expect(champ(page, "Type d'objet")).toContainText('Périmètre')
    await expect(champ(page, 'Périmètre')).toContainText('site-a')
    await expect(page.getByLabel('Du', { exact: true })).toHaveValue('2026-03-01')
    await expect(page.getByLabel('Au', { exact: true })).toHaveValue('2026-03-31')
    await expect(page.getByRole('button', { name: 'Réinitialiser les filtres' })).toBeEnabled()
    // modifier un filtre conserve les paramètres étrangers
    await choisirOption(page, 'Périmètre', 'Tous')
    await expect(lignes(page)).toHaveCount(1)
    const q = new URL(page.url()).searchParams
    expect(q.get('ref')).toBe('campagne')
    expect(q.has('perimetre')).toBe(false)
    expect(q.get('action')).toBe('scopes:create')
  })

  test('[rule-foundation-audit-url-sanitized] les valeurs d\'adresse invalides sont ignorées et retirées, les valides sont conservées', async ({ page }) => {
    await poserMasse(2)
    await connecter(page, 'admin')
    const appels = compter(page, AUDIT)
    const invalides = [
      'du=abc',
      'au=2026-02-30',
      'du=1000-05-05',
      'au=9999-05-05',
      'auteur=pas-un-uuid',
      `action=${'a'.repeat(101)}`,
      `type=${'t'.repeat(101)}`,
      `perimetre=${'p'.repeat(51)}`,
      'action=x%00y',
    ]
    await ouvrirJournal(page, '?' + invalides.join('&') + '&ref=garde')
    await expect(lignes(page)).toHaveCount(2)
    await expect.poll(() => cheminEtRecherche(page)).toBe('/journal?ref=garde')
    await expect(page.getByLabel('Du', { exact: true })).toHaveValue('')
    await expect(page.getByLabel('Au', { exact: true })).toHaveValue('')
    await expect(page.getByRole('button', { name: 'Réinitialiser les filtres' })).toBeDisabled()
    for (const u of appels.urls) {
      const p = new URL(u).searchParams
      for (const k of ['actorId', 'action', 'objectType', 'scope', 'occurredFrom', 'occurredTo']) expect(p.has(k), k).toBe(false)
    }
  })

  test('[rule-foundation-audit-url-sanitized] des bornes de longueur et d\'année valides sont acceptées', async ({ page }) => {
    await poserMasse(2)
    await connecter(page, 'admin')
    const action100 = 'a'.repeat(100)
    await ouvrirJournal(page, `?action=${action100}&perimetre=${'p'.repeat(50)}&du=1001-01-01&au=9998-12-31`)
    await expect(page.getByText(VIDE_AVEC_FILTRES)).toBeVisible()
    const q = new URL(page.url()).searchParams
    expect(q.get('action')).toBe(action100)
    expect(q.get('perimetre')).toBe('p'.repeat(50))
    expect(q.get('du')).toBe('1001-01-01')
    expect(q.get('au')).toBe('9998-12-31')
  })

  test('[rule-foundation-audit-url-sanitized] un auteur uuid inconnu des listes reste appliqué et s\'affiche par son identifiant ; une valeur HTML n\'est pas interprétée', async ({ page }) => {
    await poserMasse(2)
    await connecter(page, 'admin')
    const inconnu = '99999999-9999-4999-8999-999999999999'
    await ouvrirJournal(page, `?auteur=${inconnu}&action=${encodeURIComponent('<img src=x onerror="window.__xss=1">')}`)
    await expect(page.getByText(VIDE_AVEC_FILTRES)).toBeVisible()
    await expect(champ(page, 'Auteur')).toHaveValue(inconnu)
    expect(new URL(page.url()).searchParams.get('auteur')).toBe(inconnu)
    await expect(page.locator('img[src="x"]')).toHaveCount(0)
    expect(await page.evaluate(() => (window as any).__xss)).toBeUndefined()
  })

  test('[rule-foundation-audit-shareable-filter] « Copier le lien » copie l\'adresse courante puis affiche « Lien copié. »', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await poser({ at: '2026-03-01T10:00:00.000Z' })
    await admin(page, '?action=groups%3Aupdate')
    await page.getByRole('button', { name: 'Copier le lien' }).click()
    await expect(page.getByText('Lien copié.')).toBeVisible()
    const copie = await page.evaluate(() => navigator.clipboard.readText())
    const u = new URL(copie)
    expect(u.pathname + u.search).toBe('/journal?action=groups%3Aupdate')
  })

  test('[rule-foundation-audit-shareable-filter] « Copier le lien » sans presse-papiers : « Copie impossible. Copiez l\'adresse depuis la barre du navigateur. »', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('refusé')) }, configurable: true })
    })
    await admin(page)
    await page.getByRole('button', { name: 'Copier le lien' }).click()
    await expect(page.getByText("Copie impossible. Copiez l'adresse depuis la barre du navigateur.")).toBeVisible()
    await expect(page.getByText('Lien copié.')).toHaveCount(0)
  })
})

// ───────────────────────── traçabilité de bout en bout ─────────────────────────

test.describe('Traçabilité de bout en bout', () => {
  test("[rule-foundation-audit-trace-content] [rule-foundation-audit-declarative-route] [rule-foundation-audit-scope-field] [rule-foundation-audit-french-screen] créer un périmètre puis un groupe depuis les écrans laisse deux entrées au journal, sans modification de l'écran", async ({ page }) => {
    const a = await connecter(page, 'admin')
    await page.goto('/perimetres')
    await page.getByRole('button', { name: 'Nouveau périmètre' }).click()
    await page.getByRole('dialog').getByLabel('Code').fill('creche-parc')
    await page.getByRole('dialog').getByLabel('Nom').fill('Crèche du Parc')
    await page.getByRole('dialog').getByRole('button', { name: 'Enregistrer' }).click()
    await expect(page.getByText('Périmètre créé.')).toBeVisible()

    await page.getByRole('navigation', { name: 'Administration' }).getByRole('link', { name: 'Groupes', exact: true }).click()
    await page.getByRole('button', { name: 'Nouveau groupe' }).click()
    await page.getByRole('dialog').getByLabel('Nom').fill('Équipe du Parc')
    // rule-foundation-group-needs-scope : au moins un périmètre
    await page.getByRole('dialog').getByRole('combobox', { name: 'Périmètres' }).click()
    await page.getByRole('option', { name: 'creche-parc — Crèche du Parc', exact: true }).click()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('listbox')).toHaveCount(0)
    await page.getByRole('dialog').getByRole('button', { name: 'Enregistrer' }).click()
    await expect(page.getByText('Groupe créé.')).toBeVisible()

    await page.getByRole('navigation', { name: 'Administration' }).getByRole('link', { name: 'Journal', exact: true }).click()
    await expect(page.getByRole('heading', { name: "Journal d'audit", exact: true })).toBeVisible()
    await expect(lignes(page)).toHaveCount(2)

    // la plus récente d'abord : le groupe, puis le périmètre
    const groupe = lignes(page).nth(0)
    await expect(groupe).toContainText(a.email)
    await expect(groupe.getByText('Création', { exact: true })).toBeVisible()
    await expect(groupe.getByText('groups:create', { exact: true })).toBeVisible()
    await expect(groupe.getByText('Groupe', { exact: true })).toBeVisible()
    await expect(groupe.getByText('—', { exact: true })).toBeVisible()
    await expect(groupe).toContainText('Création du groupe « Équipe du Parc »')
    const perimetre = lignes(page).nth(1)
    await expect(perimetre).toContainText(a.email)
    await expect(perimetre.getByText('scopes:create', { exact: true })).toBeVisible()
    await expect(perimetre.getByText('Périmètre', { exact: true })).toBeVisible()
    await expect(perimetre.getByText('creche-parc', { exact: true })).toHaveCount(1) // colonne « Périmètre » seule : le résumé est un texte plus long
    await expect(perimetre).toContainText('Création du périmètre « Crèche du Parc » (creche-parc)')

    // les nouvelles valeurs apparaissent dans les filtres, et le filtre par périmètre retrouve l'entrée
    await choisirOption(page, 'Périmètre', 'creche-parc')
    await expect(lignes(page)).toHaveCount(1)
    await expect(lignes(page).first()).toContainText('Crèche du Parc')
    const [{ n }] = await sql('select count(*)::int n from base.audit_logs')
    expect(n).toBe(2)
  })

  test("[rule-foundation-audit-trace-content] [rule-foundation-audit-no-op-traced] modifier un groupe depuis l'écran laisse une entrée « Modification » citant les noms des champs, jamais leurs valeurs", async ({ page }) => {
    await connecter(page, 'admin')
    // rule-foundation-group-needs-scope : le groupe est rattaché à un périmètre
    const [s] = await sql<{ id: string }>("insert into base.scopes (code, name) values ('site-a', 'Site A') returning id")
    const [g] = await sql<{ id: string }>("insert into base.groups (name) values ('Équipe A') returning id")
    await sql('insert into base.group_scopes (group_id, scope_id) values ($1, $2)', [g.id, s.id])
    await page.goto('/groupes')
    await page.getByRole('button', { name: 'Modifier le groupe Équipe A' }).click()
    await page.getByRole('dialog').getByLabel('Nom').fill('Équipe Renommée')
    await page.getByRole('dialog').getByRole('button', { name: 'Enregistrer' }).click()
    await expect(page.getByText('Groupe modifié.')).toBeVisible()
    await ouvrirJournal(page)
    await expect(lignes(page)).toHaveCount(1)
    const l = lignes(page).first()
    await expect(l.getByText('Modification', { exact: true })).toBeVisible()
    await expect(l.getByText('groups:update', { exact: true })).toBeVisible()
    // le résumé est construit à partir de la réponse (nom courant de l'objet) et des noms des champs envoyés, sans avant/après
    await expect(l).toContainText('Modification du groupe « Équipe Renommée » (nom)')
    await expect(l).not.toContainText('Équipe A')
  })

  test('[rule-foundation-audit-trace-content] deux administrateurs laissent chacun leur propre identité', async ({ page, browser }) => {
    const a1 = await connecter(page, 'admin')
    const a2 = await account('admin', 'second-admin@recette.test')
    const ctx = await browser.newContext({ locale: 'fr-FR', timezoneId: 'Europe/Paris', baseURL: process.env.STUDIO_URL ?? 'http://localhost:5173' })
    try {
      const p2 = await ctx.newPage()
      await p2.goto('/connexion')
      await p2.getByLabel('Adresse e-mail', { exact: true }).fill(a2.email)
      await p2.getByLabel('Mot de passe', { exact: true }).fill(a2.password)
      await p2.getByRole('button', { name: 'Se connecter' }).click()
      await expect(p2.getByRole('heading', { name: 'Bienvenue' })).toBeVisible()
      await p2.goto('/perimetres')
      await p2.getByRole('button', { name: 'Nouveau périmètre' }).click()
      await p2.getByRole('dialog').getByLabel('Code').fill('site-b')
      await p2.getByRole('dialog').getByLabel('Nom').fill('Site B')
      await p2.getByRole('dialog').getByRole('button', { name: 'Enregistrer' }).click()
      await expect(p2.getByText('Périmètre créé.')).toBeVisible()
    } finally {
      await ctx.close()
    }
    await page.goto('/perimetres')
    await page.getByRole('button', { name: 'Nouveau périmètre' }).click()
    await page.getByRole('dialog').getByLabel('Code').fill('site-a')
    await page.getByRole('dialog').getByLabel('Nom').fill('Site A')
    await page.getByRole('dialog').getByRole('button', { name: 'Enregistrer' }).click()
    await expect(page.getByText('Périmètre créé.')).toBeVisible()
    await ouvrirJournal(page)
    await expect(lignes(page)).toHaveCount(2)
    await expect(lignes(page).filter({ hasText: 'site-a' })).toContainText(a1.email)
    await expect(lignes(page).filter({ hasText: 'site-b' })).toContainText('second-admin@recette.test')
    await champ(page, 'Auteur').click()
    await expect(page.getByRole('option', { name: a1.email, exact: true })).toBeVisible()
    await expect(page.getByRole('option', { name: 'second-admin@recette.test', exact: true })).toBeVisible()
  })

  test("[rule-foundation-audit-reads-not-traced] [rule-foundation-audit-scope-of-trace] consulter le journal et les listes, se connecter et se déconnecter ne laissent aucune entrée", async ({ page }) => {
    await connecter(page, 'admin')
    await ouvrirJournal(page)
    await expect(page.getByText(VIDE_SANS_FILTRE)).toBeVisible()
    for (const [chemin, titre] of [
      ['/utilisateurs', 'Utilisateurs'],
      ['/groupes', 'Groupes'],
      ['/perimetres', 'Périmètres'],
    ] as const) {
      await page.goto(chemin)
      await expect(page.getByRole('heading', { name: titre, exact: true })).toBeVisible()
    }
    await ouvrirJournal(page)
    await page.reload()
    await expect(page.getByText(VIDE_SANS_FILTRE)).toBeVisible()
    await page.getByRole('button', { name: 'Se déconnecter' }).click()
    await expect(page.getByRole('heading', { name: 'Connexion' })).toBeVisible()
    const [{ n }] = await sql('select count(*)::int n from base.audit_logs')
    expect(n).toBe(0)
  })

  test("[rule-foundation-audit-trace-content] une écriture refusée depuis l'écran (code de périmètre déjà utilisé) ne laisse aucune entrée", async ({ page }) => {
    await connecter(page, 'admin')
    await sql("insert into base.scopes (code, name) values ('site-a', 'Site A')")
    await page.goto('/perimetres')
    await page.getByRole('button', { name: 'Nouveau périmètre' }).click()
    await page.getByRole('dialog').getByLabel('Code').fill('site-a')
    await page.getByRole('dialog').getByLabel('Nom').fill('Doublon')
    await page.getByRole('dialog').getByRole('button', { name: 'Enregistrer' }).click()
    await expect(page.getByText('Ce code est déjà utilisé.')).toBeVisible()
    await ouvrirJournal(page)
    await expect(page.getByText(VIDE_SANS_FILTRE)).toBeVisible()
  })
})

// ───────────────────────── présentation adaptative ─────────────────────────

test.describe('Petit écran', () => {
  test('[rule-foundation-audit-french-screen] sous 600 px : titre et « Copier le lien » accessibles, filtres en une colonne avec libellés visibles, tableau en défilement horizontal', async ({ page }) => {
    await poser({ at: '2026-03-01T10:00:00.000Z', summary: 'Entrée sur mobile ' + 'très longue '.repeat(10) })
    await page.setViewportSize({ width: 480, height: 900 })
    await admin(page)
    await expect(page.getByRole('button', { name: 'Copier le lien' })).toBeVisible()
    const titre = await page.getByRole('heading', { name: "Journal d'audit", exact: true }).boundingBox()
    const bouton = await page.getByRole('button', { name: 'Copier le lien' }).boundingBox()
    expect(bouton!.y).toBeGreaterThan(titre!.y + titre!.height - 1) // empilés
    const a = await champ(page, 'Action').boundingBox()
    const t = await champ(page, "Type d'objet").boundingBox()
    expect(t!.y).toBeGreaterThan(a!.y + a!.height - 1) // une colonne
    await expect(page.getByText('Action', { exact: true }).first()).toBeVisible()
    await expect(lignes(page)).toHaveCount(1)
    // la page elle-même ne défile pas horizontalement
    const debordement = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
    expect(debordement).toBe(false)
  })
})
