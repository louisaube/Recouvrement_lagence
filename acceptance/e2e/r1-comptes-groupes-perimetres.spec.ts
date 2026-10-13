/**
 * Lot r1-comptes-groupes-perimetres : écrans Utilisateurs, Groupes, Périmètres (administration).
 * Spécification : specifications/socle/70-ecrans.md (§2, §4, §6, §8, §9), 30-comptes.md, 40-groupes-perimetres.md, 98-arbitrages.md.
 * Sélection par rôle et nom accessible uniquement ; les données de départ sont posées par SQL (contrat de données).
 */
import { test, expect, account, type Page } from './fixtures'
import { sql } from '../harness'

const ADMIN_EMAIL = 'admin@recette.test'
const GENERIQUE = 'Une erreur est survenue. Veuillez réessayer.'
const INVALIDE = 'Données invalides. Vérifiez les champs.'
const NON_AUTORISE = 'Action non autorisée.'

// ───────────────────────── aides ─────────────────────────

async function connecter(page: Page, role: 'user' | 'admin', email?: string) {
  const a = await account(role, email ?? (role === 'admin' ? ADMIN_EMAIL : undefined))
  await page.goto('/connexion')
  await page.getByLabel('Adresse e-mail', { exact: true }).fill(a.email)
  await page.getByLabel('Mot de passe', { exact: true }).fill(a.password)
  await page.getByRole('button', { name: 'Se connecter' }).click()
  await expect(page.getByRole('heading', { name: 'Bienvenue' })).toBeVisible()
  return a
}

async function ouvrir(page: Page, chemin: string, titre: string) {
  await page.goto(chemin)
  await expect(page.getByRole('heading', { name: titre, exact: true })).toBeVisible()
}

async function admin(page: Page, chemin: string, titre: string) {
  const a = await connecter(page, 'admin')
  await ouvrir(page, chemin, titre)
  return a
}

async function creerPerimetre(code: string, name: string): Promise<string> {
  const [r] = await sql<{ id: string }>('insert into base.scopes (code, name) values ($1, $2) returning id', [code, name])
  return r.id
}

async function creerGroupe(name: string, scopeIds: string[], userIds: string[] = []): Promise<string> {
  const [g] = await sql<{ id: string }>('insert into base.groups (name) values ($1) returning id', [name])
  for (const s of scopeIds) await sql('insert into base.group_scopes (group_id, scope_id) values ($1, $2)', [g.id, s])
  for (const u of userIds) await sql('insert into base.group_users (group_id, user_id) values ($1, $2)', [g.id, u])
  return g.id
}

async function creerCompte(email: string, role: 'user' | 'admin' = 'user'): Promise<string> {
  const [u] = await sql<{ id: string }>('insert into base.users (email, role) values ($1, $2) returning id', [email, role])
  return u.id
}

/** Remplace un point d'accès de l'API par une réponse fixe (avec les en-têtes CORS nécessaires au studio). */
async function simuler(page: Page, methode: string, motif: RegExp, status: number, body?: unknown) {
  await page.route(motif, async (route) => {
    if (route.request().method() !== methode) return route.fallback()
    const origine = await route.request().headerValue('origin')
    await route.fulfill({
      status,
      contentType: 'application/json',
      headers: origine ? { 'access-control-allow-origin': origine, 'access-control-allow-credentials': 'true' } : {},
      body: JSON.stringify(body ?? { status, code: 'api.unknown_error', message: 'détail technique SQL stack' }),
    })
  })
}

/** Compte les appels réels d'une méthode sur un motif. */
function compter(page: Page, methode: string, motif: RegExp) {
  const etat = { n: 0 }
  page.on('request', (r) => {
    if (r.method() === methode && motif.test(r.url())) etat.n++
  })
  return etat
}

const USERS = /\/users(\?.*)?$/
const USER_ID = /\/users\/[0-9a-f-]{36}$/
const GROUPS = /\/groups(\?.*)?$/
const GROUP_ID = /\/groups\/[0-9a-f-]{36}$/
const SCOPES = /\/scopes(\?.*)?$/
const SCOPE_ID = /\/scopes\/[0-9a-f-]{36}$/

/** Ouvre une liste à choix multiple (ou unique) du dialogue et coche les options, puis referme la liste. */
async function choisir(page: Page, label: string, options: string[]) {
  const dialogue = page.getByRole('dialog')
  await dialogue.getByRole('combobox', { name: label }).click()
  for (const o of options) await page.getByRole('option', { name: o, exact: true }).click()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('listbox')).toHaveCount(0)
  await expect(dialogue).toBeVisible()
}

const premiereColonne = async (page: Page) => {
  const cellules = page.getByRole('row').filter({ has: page.getByRole('cell') }).locator('td:first-child, [role="cell"]:first-child')
  return (await cellules.allInnerTexts()).map((t) => t.trim())
}

const boutonPageSuivante = (page: Page) => page.getByRole('button', { name: /page suivante|next page/i })

// ───────────────────────── garde et navigation ─────────────────────────

test.describe('Garde des écrans d\'administration et onglets', () => {
  for (const chemin of ['/utilisateurs', '/groupes', '/perimetres']) {
    test(`[rule-foundation-admin-screens-guard] un utilisateur ordinaire ouvrant ${chemin} voit « Accès refusé », sans changement d'adresse ni appel d'administration`, async ({ page }) => {
      await connecter(page, 'user')
      const appels: string[] = []
      page.on('request', (r) => {
        const p = new URL(r.url()).pathname
        if ((r.resourceType() === 'fetch' || r.resourceType() === 'xhr') && /^\/(users|groups|scopes)(\/|$)/.test(p)) appels.push(`${r.method()} ${p}`)
      })
      await page.goto(chemin)
      await expect(page.getByRole('heading', { name: 'Accès refusé' })).toBeVisible()
      await expect(page.getByText('Vous n\'avez pas les droits nécessaires pour consulter cette page.')).toBeVisible()
      expect(new URL(page.url()).pathname).toBe(chemin)
      // mise en page commune conservée, mais pas d'onglets
      await expect(page.getByRole('banner').getByRole('button', { name: 'Se déconnecter' })).toBeVisible()
      await expect(page.getByRole('navigation', { name: 'Administration' })).toHaveCount(0)
      await page.waitForTimeout(500)
      expect(appels).toEqual([])
    })
  }

  test('[rule-foundation-admin-screens-guard] « Retour à l\'accueil » ramène à « / »', async ({ page }) => {
    await connecter(page, 'user')
    await page.goto('/groupes')
    await page.getByRole('button', { name: 'Retour à l\'accueil' }).or(page.getByRole('link', { name: 'Retour à l\'accueil' })).click()
    await expect(page.getByRole('heading', { name: 'Bienvenue' })).toBeVisible()
    expect(new URL(page.url()).pathname).toBe('/')
  })

  test('[rule-foundation-protected-redirect] sans session, /groupes redirige vers la connexion et la destination est restaurée après connexion d\'un administrateur', async ({ page }) => {
    const a = await account('admin', ADMIN_EMAIL)
    await page.goto('/groupes')
    await expect(page.getByRole('heading', { name: 'Connexion' })).toBeVisible()
    const u = new URL(page.url())
    expect(u.pathname).toBe('/connexion')
    expect(u.searchParams.get('redirection')).toBe('/groupes')
    await page.getByLabel('Adresse e-mail', { exact: true }).fill(a.email)
    await page.getByLabel('Mot de passe', { exact: true }).fill(a.password)
    await page.getByRole('button', { name: 'Se connecter' }).click()
    await expect(page.getByRole('heading', { name: 'Groupes', exact: true })).toBeVisible()
    expect(new URL(page.url()).pathname).toBe('/groupes')
  })

  test('[rule-foundation-protected-redirect] sans session, /utilisateurs et /perimetres redirigent aussi vers la connexion', async ({ page }) => {
    for (const [chemin, enc] of [['/utilisateurs', '%2Futilisateurs'], ['/perimetres', '%2Fperimetres']]) {
      await page.goto(chemin)
      await expect(page.getByRole('heading', { name: 'Connexion' })).toBeVisible()
      expect(new URL(page.url()).pathname + new URL(page.url()).search).toBe(`/connexion?redirection=${enc}`)
    }
  })

  test('[rule-foundation-admin-nav] les onglets mènent aux écrans et l\'onglet actif suit le chemin', async ({ page }) => {
    await connecter(page, 'admin')
    const nav = page.getByRole('navigation', { name: 'Administration' })
    const actif = nav.locator('[aria-selected="true"], [aria-current]')
    await nav.getByRole('link', { name: 'Utilisateurs', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Utilisateurs', exact: true })).toBeVisible()
    expect(new URL(page.url()).pathname).toBe('/utilisateurs')
    await expect(actif).toHaveCount(1)
    await expect(actif).toContainText('Utilisateurs')
    await nav.getByRole('link', { name: 'Groupes', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Groupes', exact: true })).toBeVisible()
    expect(new URL(page.url()).pathname).toBe('/groupes')
    await expect(actif).toHaveCount(1)
    await expect(actif).toContainText('Groupes')
    await nav.getByRole('link', { name: 'Périmètres', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Périmètres', exact: true })).toBeVisible()
    expect(new URL(page.url()).pathname).toBe('/perimetres')
    await expect(actif).toHaveCount(1)
    await expect(actif).toContainText('Périmètres')
  })

  test('[rule-foundation-admin-nav] « Utilisateurs » reste l\'onglet actif sur /utilisateurs/import', async ({ page }) => {
    await connecter(page, 'admin')
    await page.goto('/utilisateurs/import')
    const nav = page.getByRole('navigation', { name: 'Administration' })
    await expect(nav.locator('[aria-selected="true"], [aria-current]')).toContainText('Utilisateurs')
  })
})

// ───────────────────────── Utilisateurs ─────────────────────────

test.describe('Utilisateurs — liste', () => {
  test('[rule-foundation-users-admin-screen] [rule-foundation-role-label] [rule-foundation-french-ui] éléments de l\'écran, colonnes, rôles et groupes en pastilles', async ({ page }) => {
    await connecter(page, 'admin')
    const s = await creerPerimetre('site-a', 'Site A')
    const bob = await creerCompte('bob@recette.test', 'user')
    const claire = await creerCompte('claire@recette.test', 'user')
    await creerGroupe('Équipe A', [s], [bob, claire])
    await creerGroupe('équipe B', [s], [bob])
    await ouvrir(page, '/utilisateurs', 'Utilisateurs')

    await expect(page.getByRole('link', { name: 'Importer des utilisateurs' })).toHaveAttribute('href', '/utilisateurs/import')
    await expect(page.getByRole('button', { name: 'Nouvel utilisateur' })).toBeVisible()
    for (const col of ['Adresse e-mail', 'Rôle', 'Groupes', 'Actions']) {
      await expect(page.getByRole('columnheader', { name: col, exact: true })).toBeVisible()
    }
    // tri par e-mail : admin, bob, claire
    expect(await premiereColonne(page)).toEqual([ADMIN_EMAIL, 'bob@recette.test', 'claire@recette.test'])

    const ligneAdmin = page.getByRole('row').filter({ hasText: ADMIN_EMAIL })
    await expect(ligneAdmin.getByText('Administrateur', { exact: true })).toBeVisible()
    await expect(ligneAdmin.getByText('Aucun groupe', { exact: true })).toBeVisible()
    const ligneBob = page.getByRole('row').filter({ hasText: 'bob@recette.test' })
    await expect(ligneBob.getByText('Utilisateur', { exact: true })).toBeVisible()
    await expect(ligneBob.getByText('Équipe A', { exact: true })).toBeVisible()
    await expect(ligneBob.getByText('équipe B', { exact: true })).toBeVisible()
    await expect(ligneBob.getByText('Aucun groupe')).toHaveCount(0)
    // groupes triés par nom sans tenir compte de la casse
    const texte = await ligneBob.innerText()
    expect(texte.indexOf('Équipe A')).toBeLessThan(texte.indexOf('équipe B'))
    await expect(page.getByRole('button', { name: `Modifier l'utilisateur bob@recette.test` })).toBeVisible()
    await expect(page.getByRole('button', { name: `Modifier l'utilisateur ${ADMIN_EMAIL}` })).toBeVisible()
  })

  test('[rule-foundation-users-admin-screen] aucune suppression, désactivation ni recherche', async ({ page }) => {
    await connecter(page, 'admin')
    await creerCompte('bob@recette.test')
    await ouvrir(page, '/utilisateurs', 'Utilisateurs')
    await expect(page.getByRole('row').filter({ hasText: 'bob@recette.test' })).toBeVisible()
    await expect(page.getByRole('button', { name: /supprimer|désactiver/i })).toHaveCount(0)
    await expect(page.getByRole('searchbox')).toHaveCount(0)
    await expect(page.getByRole('textbox')).toHaveCount(0)
  })

  test('[rule-foundation-users-admin-screen] liste vide : « Aucun utilisateur. »', async ({ page }) => {
    await connecter(page, 'admin')
    await simuler(page, 'GET', USERS, 200, { users: [], total: 0 })
    await ouvrir(page, '/utilisateurs', 'Utilisateurs')
    await expect(page.getByText('Aucun utilisateur.', { exact: true })).toBeVisible()
  })

  test('[rule-foundation-list-pagination] [rule-foundation-french-ui] pagination serveur : 10 par défaut, libellés français, changement de taille et de page', async ({ page }) => {
    await connecter(page, 'admin') // aaa : admin@recette.test est le premier par e-mail
    await sql(
      `insert into base.users (email, role) select 'u' || lpad(i::text, 2, '0') || '@recette.test', 'user' from generate_series(1, 26) i`,
    )
    await ouvrir(page, '/utilisateurs', 'Utilisateurs')
    await expect(page.getByText('Lignes par page :')).toBeVisible()
    await expect(page.getByText('1–10 sur 27')).toBeVisible()
    await expect(page.getByRole('row').filter({ has: page.getByRole('cell') })).toHaveCount(10)
    await boutonPageSuivante(page).click()
    await expect(page.getByText('11–20 sur 27')).toBeVisible()
    expect((await premiereColonne(page))[0]).toBe('u10@recette.test')
    await page.getByRole('combobox', { name: /Lignes par page/ }).click()
    await expect(page.getByRole('option', { name: '10', exact: true })).toBeVisible()
    await expect(page.getByRole('option', { name: '25', exact: true })).toBeVisible()
    await expect(page.getByRole('option', { name: '50', exact: true })).toBeVisible()
    await page.getByRole('option', { name: '25', exact: true }).click()
    await expect(page.getByText('1–25 sur 27')).toBeVisible()
    await expect(page.getByRole('row').filter({ has: page.getByRole('cell') })).toHaveCount(25)
  })

  test('[rule-foundation-api-failure-handling] échec de chargement de la liste : message générique, « Réessayer » recharge', async ({ page }) => {
    await connecter(page, 'admin')
    await simuler(page, 'GET', USERS, 500)
    await ouvrir(page, '/utilisateurs', 'Utilisateurs')
    await expect(page.getByText(GENERIQUE)).toBeVisible()
    await expect(page.getByText(/SQL|stack|api\.unknown_error/)).toHaveCount(0)
    await page.unroute(USERS)
    await page.getByRole('button', { name: 'Réessayer' }).click()
    await expect(page.getByRole('row').filter({ hasText: ADMIN_EMAIL })).toBeVisible()
    await expect(page.getByText(GENERIQUE)).toHaveCount(0)
  })

  test('[rule-foundation-api-failure-handling] liste des utilisateurs : 403 → « Action non autorisée. »', async ({ page }) => {
    await connecter(page, 'admin')
    await simuler(page, 'GET', USERS, 403, { status: 403, code: 'security.access_denied', message: 'interdit' })
    await ouvrir(page, '/utilisateurs', 'Utilisateurs')
    await expect(page.getByText(NON_AUTORISE)).toBeVisible()
  })

  test('[rule-foundation-api-failure-handling] 401 en cours d\'utilisation : retour à l\'écran de connexion', async ({ page }) => {
    await connecter(page, 'admin')
    await simuler(page, 'GET', USERS, 401, { status: 401, code: 'security.invalid_token', message: 'x' })
    await page.goto('/utilisateurs')
    await expect(page.getByRole('heading', { name: 'Connexion' })).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Administration' })).toHaveCount(0)
  })
})

test.describe('Utilisateurs — création', () => {
  test('[rule-foundation-users-admin-screen] [rule-foundation-user-no-group-no-data] contenu du dialogue de création', async ({ page }) => {
    await admin(page, '/utilisateurs', 'Utilisateurs')
    await page.getByRole('button', { name: 'Nouvel utilisateur' }).click()
    const d = page.getByRole('dialog')
    await expect(d.getByLabel('Adresse e-mail')).toHaveValue('')
    const mdp = d.getByLabel('Mot de passe')
    await expect(mdp).toHaveAttribute('type', 'password')
    await expect(d.getByText('8 caractères minimum.')).toBeVisible()
    await expect(d.getByRole('combobox', { name: 'Rôle' })).toContainText('Utilisateur')
    await expect(d.getByRole('combobox', { name: 'Groupes' })).toBeVisible()
    await expect(d.getByText('Un utilisateur sans groupe ne voit aucune donnée rattachée à un périmètre.')).toBeVisible()
    await expect(d.getByRole('button', { name: 'Annuler' })).toBeVisible()
    await expect(d.getByRole('button', { name: 'Enregistrer' })).toBeVisible()
  })

  test('[rule-foundation-users-admin-screen] [rule-foundation-user-create-fields] [rule-foundation-user-groups-membership] création nominale avec groupes : notification, ligne dans la liste, compte utilisable', async ({ page, browser }) => {
    await connecter(page, 'admin')
    const s = await creerPerimetre('site-a', 'Site A')
    await creerGroupe('Équipe A', [s])
    await creerGroupe('Équipe B', [s])
    await ouvrir(page, '/utilisateurs', 'Utilisateurs')
    await page.getByRole('button', { name: 'Nouvel utilisateur' }).click()
    const d = page.getByRole('dialog')
    await d.getByLabel('Adresse e-mail').fill('nouveau@recette.test')
    await d.getByLabel('Mot de passe').fill('Secret-2026!')
    await choisir(page, 'Groupes', ['Équipe A', 'Équipe B'])
    const requete = page.waitForRequest((r) => r.method() === 'POST' && USERS.test(r.url()))
    await d.getByRole('button', { name: 'Enregistrer' }).click()
    const corps = (await requete).postDataJSON()
    expect(corps.email).toBe('nouveau@recette.test')
    expect(corps.password).toBe('Secret-2026!')
    expect(corps.role).toBe('user')
    expect(corps.groupIds).toHaveLength(2)
    await expect(page.getByText('Utilisateur créé.')).toBeVisible()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    const ligne = page.getByRole('row').filter({ hasText: 'nouveau@recette.test' })
    await expect(ligne.getByText('Utilisateur', { exact: true })).toBeVisible()
    await expect(ligne.getByText('Équipe A', { exact: true })).toBeVisible()
    await expect(ligne.getByText('Équipe B', { exact: true })).toBeVisible()

    const [u] = await sql("select u.role, c.password from base.users u join base.credentials c on c.user_id = u.id where u.email = 'nouveau@recette.test'")
    expect(u.role).toBe('user')
    expect(u.password).toMatch(/^\$2[aby]\$10\$/)
    const [{ n }] = await sql("select count(*)::int n from base.group_users gu join base.users u on u.id = gu.user_id where u.email = 'nouveau@recette.test'")
    expect(n).toBe(2)

    // le compte créé se connecte avec le mot de passe saisi
    const origine = new URL(page.url()).origin
    const ctx = await browser.newContext({ baseURL: origine, locale: 'fr-FR' })
    const p2 = await ctx.newPage()
    await p2.goto('/connexion')
    await p2.getByLabel('Adresse e-mail', { exact: true }).fill('nouveau@recette.test')
    await p2.getByLabel('Mot de passe', { exact: true }).fill('Secret-2026!')
    await p2.getByRole('button', { name: 'Se connecter' }).click()
    await expect(p2.getByRole('heading', { name: 'Bienvenue' })).toBeVisible()
    await ctx.close()
  })

  test('[rule-foundation-users-admin-screen] [rule-foundation-user-create-fields] création d\'un administrateur sans groupe', async ({ page }) => {
    await admin(page, '/utilisateurs', 'Utilisateurs')
    await page.getByRole('button', { name: 'Nouvel utilisateur' }).click()
    const d = page.getByRole('dialog')
    await d.getByLabel('Adresse e-mail').fill('chef@recette.test')
    await d.getByLabel('Mot de passe').fill('Secret-2026!')
    await choisir(page, 'Rôle', ['Administrateur'])
    const requete = page.waitForRequest((r) => r.method() === 'POST' && USERS.test(r.url()))
    await d.getByRole('button', { name: 'Enregistrer' }).click()
    const corps = (await requete).postDataJSON()
    expect(corps.role).toBe('admin')
    expect(corps.groupIds).toEqual([])
    await expect(page.getByText('Utilisateur créé.')).toBeVisible()
    const ligne = page.getByRole('row').filter({ hasText: 'chef@recette.test' })
    await expect(ligne.getByText('Administrateur', { exact: true })).toBeVisible()
    await expect(ligne.getByText('Aucun groupe', { exact: true })).toBeVisible()
  })

  test('[rule-foundation-users-admin-screen] [rule-foundation-list-pagination] après une création, la liste revient à la première page', async ({ page }) => {
    await connecter(page, 'admin')
    await sql(`insert into base.users (email, role) select 'u' || lpad(i::text, 2, '0') || '@recette.test', 'user' from generate_series(1, 14) i`)
    await ouvrir(page, '/utilisateurs', 'Utilisateurs')
    await boutonPageSuivante(page).click()
    await expect(page.getByText('11–15 sur 15')).toBeVisible()
    await page.getByRole('button', { name: 'Nouvel utilisateur' }).click()
    const d = page.getByRole('dialog')
    await d.getByLabel('Adresse e-mail').fill('zz@recette.test')
    await d.getByLabel('Mot de passe').fill('Secret-2026!')
    await d.getByRole('button', { name: 'Enregistrer' }).click()
    await expect(page.getByText('Utilisateur créé.')).toBeVisible()
    await expect(page.getByText('1–10 sur 16')).toBeVisible()
  })

  test('[rule-foundation-users-admin-screen] [rule-foundation-user-create-fields] validation locale : champs invalides, aucune requête, dialogue ouvert', async ({ page }) => {
    await admin(page, '/utilisateurs', 'Utilisateurs')
    const posts = compter(page, 'POST', USERS)
    await page.getByRole('button', { name: 'Nouvel utilisateur' }).click()
    const d = page.getByRole('dialog')
    const email = d.getByLabel('Adresse e-mail')
    const mdp = d.getByLabel('Mot de passe')
    const enregistrer = d.getByRole('button', { name: 'Enregistrer' })

    // tout vide
    await enregistrer.click()
    await expect(email).toHaveAttribute('aria-invalid', 'true')
    await expect(mdp).toHaveAttribute('aria-invalid', 'true')

    const cas: Array<[string, string, string]> = [
      ['e-mail sans arobase', 'pas-un-email', 'Secret-2026!'],
      ['e-mail sans domaine', 'nom@', 'Secret-2026!'],
      ['e-mail sans partie locale', '@recette.test', 'Secret-2026!'],
      ['e-mail de 255 caractères', `${'a'.repeat(242)}@recette.test`, 'Secret-2026!'],
      ['mot de passe de 7 caractères', 'ok@recette.test', '1234567'],
      ['mot de passe de 73 caractères', 'ok@recette.test', 'x'.repeat(73)],
    ]
    for (const [, e, m] of cas) {
      await email.fill(e)
      await mdp.fill(m)
      await enregistrer.click()
      await expect(d).toBeVisible()
    }
    await page.waitForTimeout(300)
    expect(posts.n).toBe(0)
    await expect(page.getByText('Utilisateur créé.')).toHaveCount(0)
  })

  test('[rule-foundation-user-create-fields] bornes acceptées : e-mail de 254 caractères et mot de passe de 8 ou 72 caractères', async ({ page }) => {
    await admin(page, '/utilisateurs', 'Utilisateurs')
    const email254 = `${'a'.repeat(241)}@recette.test`
    expect(email254).toHaveLength(254)
    for (const [e, m] of [[email254, '12345678'], ['borne72@recette.test', 'y'.repeat(72)]]) {
      await page.getByRole('button', { name: 'Nouvel utilisateur' }).click()
      const d = page.getByRole('dialog')
      await d.getByLabel('Adresse e-mail').fill(e)
      await d.getByLabel('Mot de passe').fill(m)
      await d.getByRole('button', { name: 'Enregistrer' }).click()
      await expect(page.getByRole('dialog')).toHaveCount(0)
    }
    const [{ n }] = await sql('select count(*)::int n from base.users')
    expect(n).toBe(3)
  })

  test('[rule-foundation-user-email-unique] e-mail déjà utilisé : message sous le champ, dialogue ouvert, saisies conservées', async ({ page }) => {
    await connecter(page, 'admin')
    await creerCompte('existant@recette.test')
    await ouvrir(page, '/utilisateurs', 'Utilisateurs')
    await page.getByRole('button', { name: 'Nouvel utilisateur' }).click()
    const d = page.getByRole('dialog')
    await d.getByLabel('Adresse e-mail').fill('existant@recette.test')
    await d.getByLabel('Mot de passe').fill('Secret-2026!')
    await d.getByRole('button', { name: 'Enregistrer' }).click()
    await expect(d.getByText('Cette adresse e-mail est déjà utilisée.')).toBeVisible()
    await expect(d.getByLabel('Adresse e-mail')).toHaveValue('existant@recette.test')
    await expect(d.getByLabel('Mot de passe')).toHaveValue('Secret-2026!')
    const [{ n }] = await sql("select count(*)::int n from base.users where email = 'existant@recette.test'")
    expect(n).toBe(1)
  })

  test('[rule-foundation-api-failure-handling] création : 400 → « Données invalides. Vérifiez les champs. », saisies conservées', async ({ page }) => {
    await admin(page, '/utilisateurs', 'Utilisateurs')
    await simuler(page, 'POST', USERS, 400, { status: 400, code: 'api.validation.incoming_failed', message: 'x', details: [] })
    await page.getByRole('button', { name: 'Nouvel utilisateur' }).click()
    const d = page.getByRole('dialog')
    await d.getByLabel('Adresse e-mail').fill('x@recette.test')
    await d.getByLabel('Mot de passe').fill('Secret-2026!')
    await d.getByRole('button', { name: 'Enregistrer' }).click()
    await expect(d.getByText(INVALIDE)).toBeVisible()
    await expect(d.getByLabel('Mot de passe')).toHaveValue('Secret-2026!')
  })

  test('[rule-foundation-api-failure-handling] création : 403 → « Action non autorisée. », 500 → message générique sans détail technique', async ({ page }) => {
    await admin(page, '/utilisateurs', 'Utilisateurs')
    await simuler(page, 'POST', USERS, 403, { status: 403, code: 'security.access_denied', message: 'interdit' })
    await page.getByRole('button', { name: 'Nouvel utilisateur' }).click()
    const d = page.getByRole('dialog')
    await d.getByLabel('Adresse e-mail').fill('x@recette.test')
    await d.getByLabel('Mot de passe').fill('Secret-2026!')
    await d.getByRole('button', { name: 'Enregistrer' }).click()
    await expect(d.getByText(NON_AUTORISE)).toBeVisible()
    await page.unroute(USERS)
    await simuler(page, 'POST', USERS, 500)
    await d.getByRole('button', { name: 'Enregistrer' }).click()
    await expect(d.getByText(GENERIQUE)).toBeVisible()
    await expect(page.getByText(/SQL|stack|api\.unknown_error/)).toHaveCount(0)
    await expect(d).toBeVisible()
  })

  test('[rule-foundation-api-failure-handling] création : 401 en cours d\'utilisation → écran de connexion', async ({ page }) => {
    await admin(page, '/utilisateurs', 'Utilisateurs')
    await simuler(page, 'POST', USERS, 401, { status: 401, code: 'security.invalid_token', message: 'x' })
    await page.getByRole('button', { name: 'Nouvel utilisateur' }).click()
    const d = page.getByRole('dialog')
    await d.getByLabel('Adresse e-mail').fill('x@recette.test')
    await d.getByLabel('Mot de passe').fill('Secret-2026!')
    await d.getByRole('button', { name: 'Enregistrer' }).click()
    await expect(page.getByRole('heading', { name: 'Connexion' })).toBeVisible()
  })

  test('[rule-foundation-users-admin-screen] « Annuler » et Échap ferment le dialogue sans appel', async ({ page }) => {
    await admin(page, '/utilisateurs', 'Utilisateurs')
    const posts = compter(page, 'POST', USERS)
    await page.getByRole('button', { name: 'Nouvel utilisateur' }).click()
    await page.getByRole('dialog').getByLabel('Adresse e-mail').fill('abandon@recette.test')
    await page.getByRole('dialog').getByRole('button', { name: 'Annuler' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.getByRole('button', { name: 'Nouvel utilisateur' }).click()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    expect(posts.n).toBe(0)
    const [{ n }] = await sql("select count(*)::int n from base.users where email = 'abandon@recette.test'")
    expect(n).toBe(0)
  })

  test('[rule-foundation-users-admin-screen] tous les groupes sont proposés dans le formulaire, au-delà de la taille de page', async ({ page }) => {
    await connecter(page, 'admin')
    const s = await creerPerimetre('site-a', 'Site A')
    for (let i = 1; i <= 12; i++) await creerGroupe(`Groupe ${String(i).padStart(2, '0')}`, [s])
    await ouvrir(page, '/utilisateurs', 'Utilisateurs')
    await page.getByRole('button', { name: 'Nouvel utilisateur' }).click()
    await page.getByRole('dialog').getByRole('combobox', { name: 'Groupes' }).click()
    await expect(page.getByRole('option')).toHaveCount(12)
    await expect(page.getByRole('option', { name: 'Groupe 12', exact: true })).toBeVisible()
  })

  test('[rule-foundation-users-admin-screen] échec du chargement des groupes : alerte, « Réessayer », « Enregistrer » désactivé', async ({ page }) => {
    await admin(page, '/utilisateurs', 'Utilisateurs')
    await simuler(page, 'GET', GROUPS, 500)
    await page.getByRole('button', { name: 'Nouvel utilisateur' }).click()
    const d = page.getByRole('dialog')
    await expect(d.getByText('Impossible de charger les groupes.')).toBeVisible()
    await expect(d.getByRole('button', { name: 'Enregistrer' })).toBeDisabled()
    await page.unroute(GROUPS)
    await d.getByRole('button', { name: 'Réessayer' }).click()
    await expect(d.getByText('Impossible de charger les groupes.')).toHaveCount(0)
    await expect(d.getByRole('button', { name: 'Enregistrer' })).toBeEnabled()
  })
})

test.describe('Utilisateurs — modification', () => {
  test('[rule-foundation-user-edit-scope] dialogue de modification : e-mail en lecture seule, pas de mot de passe, rôle et groupes préremplis', async ({ page }) => {
    await connecter(page, 'admin')
    const s = await creerPerimetre('site-a', 'Site A')
    const bob = await creerCompte('bob@recette.test', 'user')
    await creerGroupe('Équipe A', [s], [bob])
    await ouvrir(page, '/utilisateurs', 'Utilisateurs')
    await page.getByRole('button', { name: `Modifier l'utilisateur bob@recette.test` }).click()
    const d = page.getByRole('dialog')
    await expect(d.getByLabel('Adresse e-mail')).toHaveValue('bob@recette.test')
    await expect(d.getByLabel('Adresse e-mail')).toHaveJSProperty('readOnly', true)
    await expect(d.getByLabel('Mot de passe')).toHaveCount(0)
    await expect(d.getByRole('combobox', { name: 'Rôle' })).toContainText('Utilisateur')
    await expect(d.getByRole('combobox', { name: 'Rôle' })).toBeEnabled()
    await expect(d.getByRole('combobox', { name: 'Groupes' })).toContainText('Équipe A')
  })

  test('[rule-foundation-user-edit-scope] [rule-foundation-user-groups-membership] modification du rôle et des groupes : seuls role et groupIds sont envoyés', async ({ page }) => {
    await connecter(page, 'admin')
    const s = await creerPerimetre('site-a', 'Site A')
    const bob = await creerCompte('bob@recette.test', 'user')
    await creerGroupe('Équipe A', [s], [bob])
    await creerGroupe('Équipe B', [s])
    await ouvrir(page, '/utilisateurs', 'Utilisateurs')
    await page.getByRole('button', { name: `Modifier l'utilisateur bob@recette.test` }).click()
    const d = page.getByRole('dialog')
    await choisir(page, 'Rôle', ['Administrateur'])
    // retire « Équipe A », ajoute « Équipe B »
    await choisir(page, 'Groupes', ['Équipe A', 'Équipe B'])
    const requete = page.waitForRequest((r) => r.method() === 'PATCH' && USER_ID.test(r.url()))
    await d.getByRole('button', { name: 'Enregistrer' }).click()
    const corps = (await requete).postDataJSON()
    expect(Object.keys(corps).sort()).toEqual(['groupIds', 'role'])
    expect(corps.role).toBe('admin')
    expect(corps.groupIds).toHaveLength(1)
    await expect(page.getByText('Utilisateur modifié.')).toBeVisible()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    const ligne = page.getByRole('row').filter({ hasText: 'bob@recette.test' })
    await expect(ligne.getByText('Administrateur', { exact: true })).toBeVisible()
    await expect(ligne.getByText('Équipe B', { exact: true })).toBeVisible()
    await expect(ligne.getByText('Équipe A', { exact: true })).toHaveCount(0)
    const lignes = await sql("select g.name from base.group_users gu join base.groups g on g.id = gu.group_id join base.users u on u.id = gu.user_id where u.email = 'bob@recette.test'")
    expect(lignes.map((l) => l.name)).toEqual(['Équipe B'])
  })

  test('[rule-foundation-user-groups-membership] retirer tous les groupes : « Aucun groupe »', async ({ page }) => {
    await connecter(page, 'admin')
    const s = await creerPerimetre('site-a', 'Site A')
    const bob = await creerCompte('bob@recette.test', 'user')
    await creerGroupe('Équipe A', [s], [bob])
    await ouvrir(page, '/utilisateurs', 'Utilisateurs')
    await page.getByRole('button', { name: `Modifier l'utilisateur bob@recette.test` }).click()
    await choisir(page, 'Groupes', ['Équipe A'])
    await page.getByRole('dialog').getByRole('button', { name: 'Enregistrer' }).click()
    await expect(page.getByText('Utilisateur modifié.')).toBeVisible()
    await expect(page.getByRole('row').filter({ hasText: 'bob@recette.test' }).getByText('Aucun groupe', { exact: true })).toBeVisible()
    const [{ n }] = await sql('select count(*)::int n from base.group_users')
    expect(n).toBe(0)
  })

  test('[rule-foundation-user-own-role-locked] sur sa propre ligne, le champ « Rôle » est désactivé avec son explication ; les groupes restent modifiables', async ({ page }) => {
    await connecter(page, 'admin')
    const s = await creerPerimetre('site-a', 'Site A')
    await creerGroupe('Équipe A', [s])
    await ouvrir(page, '/utilisateurs', 'Utilisateurs')
    await page.getByRole('button', { name: `Modifier l'utilisateur ${ADMIN_EMAIL}` }).click()
    const d = page.getByRole('dialog')
    await expect(d.getByRole('combobox', { name: 'Rôle' })).toBeDisabled()
    await expect(d.getByText('Vous ne pouvez pas modifier votre propre rôle.')).toBeVisible()
    await choisir(page, 'Groupes', ['Équipe A'])
    await d.getByRole('button', { name: 'Enregistrer' }).click()
    await expect(page.getByText('Utilisateur modifié.')).toBeVisible()
    const ligne = page.getByRole('row').filter({ hasText: ADMIN_EMAIL })
    await expect(ligne.getByText('Administrateur', { exact: true })).toBeVisible()
    await expect(ligne.getByText('Équipe A', { exact: true })).toBeVisible()
  })

  test('[rule-foundation-user-own-role-locked] le champ « Rôle » reste actif sur la ligne d\'un autre administrateur', async ({ page }) => {
    await connecter(page, 'admin')
    await creerCompte('autre-admin@recette.test', 'admin')
    await ouvrir(page, '/utilisateurs', 'Utilisateurs')
    await page.getByRole('button', { name: `Modifier l'utilisateur autre-admin@recette.test` }).click()
    await expect(page.getByRole('dialog').getByRole('combobox', { name: 'Rôle' })).toBeEnabled()
    await expect(page.getByRole('dialog').getByText('Vous ne pouvez pas modifier votre propre rôle.')).toHaveCount(0)
  })

  test('[rule-foundation-user-own-role-locked] 409 users.cannot_change_own_role → « Vous ne pouvez pas modifier votre propre rôle. », dialogue ouvert', async ({ page }) => {
    await connecter(page, 'admin')
    await creerCompte('bob@recette.test')
    await ouvrir(page, '/utilisateurs', 'Utilisateurs')
    await simuler(page, 'PATCH', USER_ID, 409, { status: 409, code: 'users.cannot_change_own_role', message: 'x' })
    await page.getByRole('button', { name: `Modifier l'utilisateur bob@recette.test` }).click()
    const d = page.getByRole('dialog')
    await choisir(page, 'Rôle', ['Administrateur'])
    await d.getByRole('button', { name: 'Enregistrer' }).click()
    await expect(d.getByText('Vous ne pouvez pas modifier votre propre rôle.')).toBeVisible()
    await expect(d).toBeVisible()
  })

  test('[rule-foundation-api-failure-handling] modification : 400 → « Données invalides. Vérifiez les champs. » ; 500 → message générique', async ({ page }) => {
    await connecter(page, 'admin')
    await creerCompte('bob@recette.test')
    await ouvrir(page, '/utilisateurs', 'Utilisateurs')
    await page.getByRole('button', { name: `Modifier l'utilisateur bob@recette.test` }).click()
    const d = page.getByRole('dialog')
    await simuler(page, 'PATCH', USER_ID, 400, { status: 400, code: 'api.validation.incoming_failed', message: 'x', details: [] })
    await d.getByRole('button', { name: 'Enregistrer' }).click()
    await expect(d.getByText(INVALIDE)).toBeVisible()
    await page.unroute(USER_ID)
    await simuler(page, 'PATCH', USER_ID, 500)
    await d.getByRole('button', { name: 'Enregistrer' }).click()
    await expect(d.getByText(GENERIQUE)).toBeVisible()
  })

  test('[rule-foundation-users-admin-screen] « Annuler » ferme la modification sans appel', async ({ page }) => {
    await connecter(page, 'admin')
    await creerCompte('bob@recette.test')
    await ouvrir(page, '/utilisateurs', 'Utilisateurs')
    const patchs = compter(page, 'PATCH', USER_ID)
    await page.getByRole('button', { name: `Modifier l'utilisateur bob@recette.test` }).click()
    await choisir(page, 'Rôle', ['Administrateur'])
    await page.getByRole('dialog').getByRole('button', { name: 'Annuler' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    expect(patchs.n).toBe(0)
    await expect(page.getByRole('row').filter({ hasText: 'bob@recette.test' }).getByText('Utilisateur', { exact: true })).toBeVisible()
  })
})

// ───────────────────────── Groupes ─────────────────────────

test.describe('Groupes — liste', () => {
  test('[rule-foundation-groups-admin-screen] liste vide : « Aucun groupe pour le moment. Créez le premier groupe. »', async ({ page }) => {
    await admin(page, '/groupes', 'Groupes')
    await expect(page.getByText('Aucun groupe pour le moment. Créez le premier groupe.', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Nouveau groupe' })).toBeVisible()
  })

  test('[rule-foundation-groups-admin-screen] [rule-foundation-french-ui] colonnes, membres (aucun / 1 / N), périmètres en pastilles avec nom en infobulle, tri sans tenir compte de la casse', async ({ page }) => {
    await connecter(page, 'admin')
    const sa = await creerPerimetre('site-a', 'Crèche du Parc')
    const sb = await creerPerimetre('site-b', 'Crèche du Lac')
    const u1 = await creerCompte('un@recette.test')
    const u2 = await creerCompte('deux@recette.test')
    await creerGroupe('charlie', [sa])
    await creerGroupe('Alpha', [sa, sb], [u1])
    await creerGroupe('bravo', [sb], [u1, u2])
    await ouvrir(page, '/groupes', 'Groupes')
    for (const col of ['Nom', 'Membres', 'Périmètres', 'Actions']) {
      await expect(page.getByRole('columnheader', { name: col, exact: true })).toBeVisible()
    }
    expect(await premiereColonne(page)).toEqual(['Alpha', 'bravo', 'charlie'])
    const alpha = page.getByRole('row').filter({ hasText: 'Alpha' })
    await expect(alpha.getByText('1 membre', { exact: true })).toBeVisible()
    await expect(alpha.getByText('site-a', { exact: true })).toBeVisible()
    await expect(alpha.getByText('site-b', { exact: true })).toBeVisible()
    await expect(page.getByRole('row').filter({ hasText: 'bravo' }).getByText('2 membres', { exact: true })).toBeVisible()
    await expect(page.getByRole('row').filter({ hasText: 'charlie' }).getByText('Aucun membre', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Modifier le groupe Alpha' })).toBeVisible()
    await expect(page.getByRole('button', { name: /supprimer/i })).toHaveCount(0)
    // infobulle : nom du périmètre
    await alpha.getByText('site-a', { exact: true }).hover()
    await expect(page.getByRole('tooltip')).toContainText('Crèche du Parc')
  })

  test('[rule-foundation-list-pagination] pagination des groupes : 10 par défaut, « 1–10 sur 12 »', async ({ page }) => {
    await connecter(page, 'admin')
    const s = await creerPerimetre('site-a', 'Site A')
    for (let i = 1; i <= 12; i++) await creerGroupe(`Groupe ${String(i).padStart(2, '0')}`, [s])
    await ouvrir(page, '/groupes', 'Groupes')
    await expect(page.getByText('Lignes par page :')).toBeVisible()
    await expect(page.getByText('1–10 sur 12')).toBeVisible()
    await boutonPageSuivante(page).click()
    await expect(page.getByText('11–12 sur 12')).toBeVisible()
    expect(await premiereColonne(page)).toEqual(['Groupe 11', 'Groupe 12'])
  })

  test('[rule-foundation-groups-admin-screen] les noms sont affichés comme du texte, jamais interprétés (balises échappées)', async ({ page }) => {
    await connecter(page, 'admin')
    const s = await creerPerimetre('site-a', 'Site A')
    await creerGroupe('<img src=x onerror="window.__xss=1"> <b>gras</b>', [s])
    await ouvrir(page, '/groupes', 'Groupes')
    await expect(page.getByText('<b>gras</b>', { exact: false })).toBeVisible()
    await expect(page.locator('main img')).toHaveCount(0)
    expect(await page.evaluate(() => (window as any).__xss)).toBeUndefined()
  })

  test('[rule-foundation-api-failure-handling] liste des groupes en échec : message générique et « Réessayer »', async ({ page }) => {
    await connecter(page, 'admin')
    await simuler(page, 'GET', GROUPS, 500)
    await ouvrir(page, '/groupes', 'Groupes')
    await expect(page.getByText(GENERIQUE)).toBeVisible()
    await page.unroute(GROUPS)
    await creerGroupe('Alpha', [await creerPerimetre('site-a', 'Site A')])
    await page.getByRole('button', { name: 'Réessayer' }).click()
    await expect(page.getByRole('row').filter({ hasText: 'Alpha' })).toBeVisible()
  })
})

test.describe('Groupes — création et modification', () => {
  test('[rule-foundation-group-definition] contenu du dialogue de création', async ({ page }) => {
    await connecter(page, 'admin')
    await creerPerimetre('site-a', 'Site A')
    await ouvrir(page, '/groupes', 'Groupes')
    await page.getByRole('button', { name: 'Nouveau groupe' }).click()
    const d = page.getByRole('dialog')
    await expect(d.getByLabel('Nom')).toHaveValue('')
    await expect(d.getByRole('combobox', { name: 'Membres' })).toBeVisible()
    await expect(d.getByRole('combobox', { name: 'Périmètres' })).toBeVisible()
    await expect(d.getByText('Au moins un périmètre.')).toBeVisible()
    await expect(d.getByRole('button', { name: 'Annuler' })).toBeVisible()
    await expect(d.getByRole('button', { name: 'Enregistrer' })).toBeEnabled()
  })

  test('[rule-foundation-group-definition] création nominale : membres et périmètres, notification, ligne dans la liste, base à jour', async ({ page }) => {
    await connecter(page, 'admin')
    await creerPerimetre('site-a', 'Site A')
    await creerPerimetre('site-b', 'Site B')
    await creerCompte('bob@recette.test')
    await creerCompte('claire@recette.test')
    await ouvrir(page, '/groupes', 'Groupes')
    await page.getByRole('button', { name: 'Nouveau groupe' }).click()
    const d = page.getByRole('dialog')
    await d.getByLabel('Nom').fill('  Équipe Z  ')
    await choisir(page, 'Membres', ['bob@recette.test', 'claire@recette.test'])
    await choisir(page, 'Périmètres', ['site-a — Site A', 'site-b — Site B'])
    // pastille = code
    await expect(d.getByText('site-a', { exact: true })).toBeVisible()
    const requete = page.waitForRequest((r) => r.method() === 'POST' && GROUPS.test(r.url()))
    await d.getByRole('button', { name: 'Enregistrer' }).click()
    const corps = (await requete).postDataJSON()
    expect(corps.name).toBe('Équipe Z')
    expect(corps.userIds).toHaveLength(2)
    expect(corps.scopeIds).toHaveLength(2)
    await expect(page.getByText('Groupe créé.')).toBeVisible()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    const ligne = page.getByRole('row').filter({ hasText: 'Équipe Z' })
    await expect(ligne.getByText('2 membres', { exact: true })).toBeVisible()
    await expect(ligne.getByText('site-a', { exact: true })).toBeVisible()
    await expect(ligne.getByText('site-b', { exact: true })).toBeVisible()
    const [{ m }] = await sql("select count(*)::int m from base.group_users gu join base.groups g on g.id = gu.group_id where g.name = 'Équipe Z'")
    const [{ s }] = await sql("select count(*)::int s from base.group_scopes gs join base.groups g on g.id = gs.group_id where g.name = 'Équipe Z'")
    expect([m, s]).toEqual([2, 2])
  })

  test('[rule-foundation-group-definition] création sans membre : « Aucun membre »', async ({ page }) => {
    await connecter(page, 'admin')
    await creerPerimetre('site-a', 'Site A')
    await ouvrir(page, '/groupes', 'Groupes')
    await page.getByRole('button', { name: 'Nouveau groupe' }).click()
    await page.getByRole('dialog').getByLabel('Nom').fill('Solo')
    await choisir(page, 'Périmètres', ['site-a — Site A'])
    await page.getByRole('dialog').getByRole('button', { name: 'Enregistrer' }).click()
    await expect(page.getByText('Groupe créé.')).toBeVisible()
    await expect(page.getByRole('row').filter({ hasText: 'Solo' }).getByText('Aucun membre', { exact: true })).toBeVisible()
  })

  test('[rule-foundation-group-definition] « Aucun utilisateur » quand la saisie ne correspond à aucun membre possible', async ({ page }) => {
    await connecter(page, 'admin')
    await creerPerimetre('site-a', 'Site A')
    await creerCompte('bob@recette.test')
    await ouvrir(page, '/groupes', 'Groupes')
    await page.getByRole('button', { name: 'Nouveau groupe' }).click()
    const membres = page.getByRole('dialog').getByRole('combobox', { name: 'Membres' })
    await membres.click()
    await membres.fill('zzzz-introuvable')
    await expect(page.getByText('Aucun utilisateur', { exact: true })).toBeVisible()
  })

  test('[rule-foundation-group-needs-scope] validation locale : nom vide, nom de 101 caractères, aucun périmètre → aucune requête', async ({ page }) => {
    await connecter(page, 'admin')
    await creerPerimetre('site-a', 'Site A')
    await ouvrir(page, '/groupes', 'Groupes')
    const posts = compter(page, 'POST', GROUPS)
    await page.getByRole('button', { name: 'Nouveau groupe' }).click()
    const d = page.getByRole('dialog')
    const enregistrer = d.getByRole('button', { name: 'Enregistrer' })
    await enregistrer.click() // tout vide
    await expect(d.getByLabel('Nom')).toHaveAttribute('aria-invalid', 'true')
    await d.getByLabel('Nom').fill('   ') // blanc
    await choisir(page, 'Périmètres', ['site-a — Site A'])
    await enregistrer.click()
    await expect(d.getByLabel('Nom')).toHaveAttribute('aria-invalid', 'true')
    await d.getByLabel('Nom').fill('x'.repeat(101))
    await enregistrer.click()
    await expect(d.getByLabel('Nom')).toHaveAttribute('aria-invalid', 'true')
    // nom valide mais aucun périmètre
    await choisir(page, 'Périmètres', ['site-a — Site A']) // décoche
    await d.getByLabel('Nom').fill('Valide')
    await enregistrer.click()
    await expect(d).toBeVisible()
    await page.waitForTimeout(300)
    expect(posts.n).toBe(0)
    await expect(page.getByText('Groupe créé.')).toHaveCount(0)
  })

  test('[rule-foundation-group-needs-scope] un nom de 100 caractères est accepté', async ({ page }) => {
    await connecter(page, 'admin')
    await creerPerimetre('site-a', 'Site A')
    await ouvrir(page, '/groupes', 'Groupes')
    await page.getByRole('button', { name: 'Nouveau groupe' }).click()
    await page.getByRole('dialog').getByLabel('Nom').fill('n'.repeat(100))
    await choisir(page, 'Périmètres', ['site-a — Site A'])
    await page.getByRole('dialog').getByRole('button', { name: 'Enregistrer' }).click()
    await expect(page.getByText('Groupe créé.')).toBeVisible()
  })

  test('[rule-foundation-group-needs-scope] sans aucun périmètre existant : message et lien vers /perimetres', async ({ page }) => {
    await admin(page, '/groupes', 'Groupes')
    await page.getByRole('button', { name: 'Nouveau groupe' }).click()
    const d = page.getByRole('dialog')
    await expect(d.getByText('Aucun périmètre n\'existe encore. Créez-en depuis l\'écran Périmètres.')).toBeVisible()
    await expect(d.getByRole('link')).toHaveAttribute('href', '/perimetres')
  })

  test('[rule-foundation-group-name-unique] nom déjà utilisé, sans tenir compte de la casse : message sous le nom, dialogue ouvert', async ({ page }) => {
    await connecter(page, 'admin')
    const s = await creerPerimetre('site-a', 'Site A')
    await creerGroupe('Équipe A', [s])
    await ouvrir(page, '/groupes', 'Groupes')
    await page.getByRole('button', { name: 'Nouveau groupe' }).click()
    const d = page.getByRole('dialog')
    await d.getByLabel('Nom').fill('équipe a')
    await choisir(page, 'Périmètres', ['site-a — Site A'])
    await d.getByRole('button', { name: 'Enregistrer' }).click()
    await expect(d.getByText('Ce nom de groupe est déjà utilisé.')).toBeVisible()
    await expect(d.getByLabel('Nom')).toHaveValue('équipe a')
    const [{ n }] = await sql('select count(*)::int n from base.groups')
    expect(n).toBe(1)
  })

  test('[rule-foundation-api-failure-handling] création de groupe : 400, 403, 500', async ({ page }) => {
    await connecter(page, 'admin')
    await creerPerimetre('site-a', 'Site A')
    await ouvrir(page, '/groupes', 'Groupes')
    await page.getByRole('button', { name: 'Nouveau groupe' }).click()
    const d = page.getByRole('dialog')
    await d.getByLabel('Nom').fill('Test')
    await choisir(page, 'Périmètres', ['site-a — Site A'])
    for (const [status, texte] of [[400, INVALIDE], [403, NON_AUTORISE], [500, GENERIQUE]] as const) {
      await simuler(page, 'POST', GROUPS, status, { status, code: 'x.y', message: 'détail technique SQL' })
      await d.getByRole('button', { name: 'Enregistrer' }).click()
      await expect(d.getByText(texte)).toBeVisible()
      await expect(page.getByText(/SQL|x\.y/)).toHaveCount(0)
      await expect(d.getByLabel('Nom')).toHaveValue('Test')
      await page.unroute(GROUPS)
    }
  })

  test('[rule-foundation-group-definition] échec du chargement des comptes et périmètres : alerte, « Réessayer », « Enregistrer » désactivé', async ({ page }) => {
    await connecter(page, 'admin')
    await creerPerimetre('site-a', 'Site A')
    await ouvrir(page, '/groupes', 'Groupes')
    await simuler(page, 'GET', USERS, 500)
    await page.getByRole('button', { name: 'Nouveau groupe' }).click()
    const d = page.getByRole('dialog')
    await expect(d.getByText('Impossible de charger les utilisateurs et les périmètres.')).toBeVisible()
    await expect(d.getByRole('button', { name: 'Enregistrer' })).toBeDisabled()
    await page.unroute(USERS)
    await d.getByRole('button', { name: 'Réessayer' }).click()
    await expect(d.getByText('Impossible de charger les utilisateurs et les périmètres.')).toHaveCount(0)
    await expect(d.getByRole('button', { name: 'Enregistrer' })).toBeEnabled()
  })

  test('[rule-foundation-group-definition] dialogue de modification prérempli ; PATCH avec les trois champs qui remplacent les valeurs', async ({ page }) => {
    await connecter(page, 'admin')
    const sa = await creerPerimetre('site-a', 'Site A')
    await creerPerimetre('site-b', 'Site B')
    const bob = await creerCompte('bob@recette.test')
    await creerCompte('claire@recette.test')
    await creerGroupe('Équipe A', [sa], [bob])
    await ouvrir(page, '/groupes', 'Groupes')
    await page.getByRole('button', { name: 'Modifier le groupe Équipe A' }).click()
    const d = page.getByRole('dialog')
    await expect(d.getByLabel('Nom')).toHaveValue('Équipe A')
    await expect(d.getByText('bob@recette.test', { exact: true })).toBeVisible()
    await expect(d.getByText('site-a', { exact: true })).toBeVisible()
    await d.getByLabel('Nom').fill('Équipe Renommée')
    await choisir(page, 'Membres', ['bob@recette.test', 'claire@recette.test']) // bob retiré, claire ajoutée
    await choisir(page, 'Périmètres', ['site-b — Site B'])
    const requete = page.waitForRequest((r) => r.method() === 'PATCH' && GROUP_ID.test(r.url()))
    await d.getByRole('button', { name: 'Enregistrer' }).click()
    const corps = (await requete).postDataJSON()
    expect(Object.keys(corps).sort()).toEqual(['name', 'scopeIds', 'userIds'])
    expect(corps.name).toBe('Équipe Renommée')
    expect(corps.userIds).toHaveLength(1)
    expect(corps.scopeIds).toHaveLength(2)
    await expect(page.getByText('Groupe modifié.')).toBeVisible()
    const ligne = page.getByRole('row').filter({ hasText: 'Équipe Renommée' })
    await expect(ligne.getByText('1 membre', { exact: true })).toBeVisible()
    await expect(ligne.getByText('site-a', { exact: true })).toBeVisible()
    await expect(ligne.getByText('site-b', { exact: true })).toBeVisible()
    const membres = await sql('select u.email from base.group_users gu join base.users u on u.id = gu.user_id')
    expect(membres.map((m) => m.email)).toEqual(['claire@recette.test'])
  })

  test('[rule-foundation-group-definition] retirer tous les membres : « Aucun membre »', async ({ page }) => {
    await connecter(page, 'admin')
    const s = await creerPerimetre('site-a', 'Site A')
    const bob = await creerCompte('bob@recette.test')
    await creerGroupe('Équipe A', [s], [bob])
    await ouvrir(page, '/groupes', 'Groupes')
    await page.getByRole('button', { name: 'Modifier le groupe Équipe A' }).click()
    await choisir(page, 'Membres', ['bob@recette.test'])
    await page.getByRole('dialog').getByRole('button', { name: 'Enregistrer' }).click()
    await expect(page.getByText('Groupe modifié.')).toBeVisible()
    await expect(page.getByRole('row').filter({ hasText: 'Équipe A' }).getByText('Aucun membre', { exact: true })).toBeVisible()
  })

  test('[rule-foundation-group-name-unique] renommer un groupe avec la casse d\'un autre nom : refusé ; changer la casse de son propre nom : accepté', async ({ page }) => {
    await connecter(page, 'admin')
    const s = await creerPerimetre('site-a', 'Site A')
    await creerGroupe('Alpha', [s])
    await creerGroupe('Bravo', [s])
    await ouvrir(page, '/groupes', 'Groupes')
    await page.getByRole('button', { name: 'Modifier le groupe Bravo' }).click()
    const d = page.getByRole('dialog')
    await d.getByLabel('Nom').fill('ALPHA')
    await d.getByRole('button', { name: 'Enregistrer' }).click()
    await expect(d.getByText('Ce nom de groupe est déjà utilisé.')).toBeVisible()
    await d.getByLabel('Nom').fill('BRAVO')
    await d.getByRole('button', { name: 'Enregistrer' }).click()
    await expect(page.getByText('Groupe modifié.')).toBeVisible()
    await expect(page.getByRole('row').filter({ hasText: 'BRAVO' })).toBeVisible()
  })

  test('[rule-foundation-group-definition] « Annuler » et Échap ferment le dialogue de modification sans appel ni confirmation', async ({ page }) => {
    await connecter(page, 'admin')
    const s = await creerPerimetre('site-a', 'Site A')
    await creerGroupe('Équipe A', [s])
    await ouvrir(page, '/groupes', 'Groupes')
    const patchs = compter(page, 'PATCH', GROUP_ID)
    await page.getByRole('button', { name: 'Modifier le groupe Équipe A' }).click()
    await page.getByRole('dialog').getByLabel('Nom').fill('Autre nom')
    await page.getByRole('dialog').getByRole('button', { name: 'Annuler' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.getByRole('button', { name: 'Modifier le groupe Équipe A' }).click()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    expect(patchs.n).toBe(0)
    await expect(page.getByRole('row').filter({ hasText: 'Équipe A' })).toBeVisible()
  })

  test('[rule-foundation-group-definition] les listes de choix du dialogue chargent tous les comptes et tous les périmètres (au-delà d\'une page)', async ({ page }) => {
    await connecter(page, 'admin')
    for (let i = 1; i <= 12; i++) await creerPerimetre(`site-${String(i).padStart(2, '0')}`, `Site ${i}`)
    await sql(`insert into base.users (email, role) select 'u' || lpad(i::text, 2, '0') || '@recette.test', 'user' from generate_series(1, 12) i`)
    await ouvrir(page, '/groupes', 'Groupes')
    await page.getByRole('button', { name: 'Nouveau groupe' }).click()
    const d = page.getByRole('dialog')
    await d.getByRole('combobox', { name: 'Périmètres' }).click()
    await expect(page.getByRole('option')).toHaveCount(12)
    await page.keyboard.press('Escape')
    await d.getByRole('combobox', { name: 'Membres' }).click()
    await expect(page.getByRole('option')).toHaveCount(13) // 12 comptes + l'administrateur
  })
})

// ───────────────────────── Périmètres ─────────────────────────

test.describe('Périmètres — liste', () => {
  test('[rule-foundation-scopes-admin-screen] liste vide : « Aucun périmètre pour le moment. Créez le premier périmètre. »', async ({ page }) => {
    await admin(page, '/perimetres', 'Périmètres')
    await expect(page.getByText('Aucun périmètre pour le moment. Créez le premier périmètre.', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Nouveau périmètre' })).toBeVisible()
  })

  test('[rule-foundation-scopes-admin-screen] [rule-foundation-french-ui] colonnes, tri par code, bouton « Modifier le périmètre <code> », aucune suppression', async ({ page }) => {
    await connecter(page, 'admin')
    await creerPerimetre('site-c', 'Site C')
    await creerPerimetre('site-a', 'Site A')
    await creerPerimetre('site-b', 'Site B')
    await ouvrir(page, '/perimetres', 'Périmètres')
    for (const col of ['Code', 'Nom', 'Actions']) {
      await expect(page.getByRole('columnheader', { name: col, exact: true })).toBeVisible()
    }
    expect(await premiereColonne(page)).toEqual(['site-a', 'site-b', 'site-c'])
    await expect(page.getByRole('row').filter({ hasText: 'site-b' }).getByText('Site B', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Modifier le périmètre site-a' })).toBeVisible()
    await expect(page.getByRole('button', { name: /supprimer/i })).toHaveCount(0)
  })

  test('[rule-foundation-list-pagination] pagination des périmètres : « 1–10 sur 12 » puis page suivante', async ({ page }) => {
    await connecter(page, 'admin')
    for (let i = 1; i <= 12; i++) await creerPerimetre(`site-${String(i).padStart(2, '0')}`, `Site ${i}`)
    await ouvrir(page, '/perimetres', 'Périmètres')
    await expect(page.getByText('Lignes par page :')).toBeVisible()
    await expect(page.getByText('1–10 sur 12')).toBeVisible()
    await boutonPageSuivante(page).click()
    await expect(page.getByText('11–12 sur 12')).toBeVisible()
    expect(await premiereColonne(page)).toEqual(['site-11', 'site-12'])
  })

  test('[rule-foundation-scopes-admin-screen] les noms sont affichés comme du texte, jamais interprétés', async ({ page }) => {
    await connecter(page, 'admin')
    await creerPerimetre('xss', '<img src=x onerror="window.__xss=1"><b>gras</b>')
    await ouvrir(page, '/perimetres', 'Périmètres')
    await expect(page.getByText('<b>gras</b>', { exact: false })).toBeVisible()
    await expect(page.locator('main img')).toHaveCount(0)
    expect(await page.evaluate(() => (window as any).__xss)).toBeUndefined()
  })

  test('[rule-foundation-api-failure-handling] liste des périmètres en échec : message générique et « Réessayer »', async ({ page }) => {
    await connecter(page, 'admin')
    await simuler(page, 'GET', SCOPES, 500)
    await ouvrir(page, '/perimetres', 'Périmètres')
    await expect(page.getByText(GENERIQUE)).toBeVisible()
    await page.unroute(SCOPES)
    await creerPerimetre('site-a', 'Site A')
    await page.getByRole('button', { name: 'Réessayer' }).click()
    await expect(page.getByRole('row').filter({ hasText: 'site-a' })).toBeVisible()
  })
})

test.describe('Périmètres — création et modification', () => {
  test('[rule-foundation-scopes-admin-screen] contenu du dialogue de création, aide sous « Code »', async ({ page }) => {
    await admin(page, '/perimetres', 'Périmètres')
    await page.getByRole('button', { name: 'Nouveau périmètre' }).click()
    const d = page.getByRole('dialog')
    await expect(d.getByLabel('Code')).toHaveValue('')
    await expect(d.getByLabel('Nom')).toHaveValue('')
    await expect(d.getByText('Lettres minuscules, chiffres, tirets et tirets bas (50 caractères maximum). Le code ne pourra plus être modifié.')).toBeVisible()
    await expect(d.getByRole('button', { name: 'Annuler' })).toBeVisible()
    await expect(d.getByRole('button', { name: 'Enregistrer' })).toBeVisible()
  })

  test('[rule-foundation-scope-definition] création nominale : valeurs rognées envoyées, notification, ligne dans la liste, base à jour', async ({ page }) => {
    await admin(page, '/perimetres', 'Périmètres')
    await page.getByRole('button', { name: 'Nouveau périmètre' }).click()
    const d = page.getByRole('dialog')
    await d.getByLabel('Code').fill('  creche-1  ')
    await d.getByLabel('Nom').fill('  Crèche des Lilas  ')
    const requete = page.waitForRequest((r) => r.method() === 'POST' && SCOPES.test(r.url()))
    await d.getByRole('button', { name: 'Enregistrer' }).click()
    expect((await requete).postDataJSON()).toEqual({ code: 'creche-1', name: 'Crèche des Lilas' })
    await expect(page.getByText('Périmètre créé.')).toBeVisible()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    const ligne = page.getByRole('row').filter({ hasText: 'creche-1' })
    await expect(ligne.getByText('Crèche des Lilas', { exact: true })).toBeVisible()
    const [s] = await sql("select code, name from base.scopes where code = 'creche-1'")
    expect(s).toEqual({ code: 'creche-1', name: 'Crèche des Lilas' })
  })

  test('[rule-foundation-scope-code-format] [rule-foundation-scope-definition] bornes acceptées : code de 1 et de 50 caractères, avec tirets et tirets bas, nom de 100 caractères', async ({ page }) => {
    await admin(page, '/perimetres', 'Périmètres')
    const cas: Array<[string, string]> = [
      ['a', 'Un'],
      ['a' + '-_0'.repeat(16) + 'z', 'x'.repeat(100)],
      ['0abc', 'Chiffre en tête'],
    ]
    expect(cas[1][0]).toHaveLength(50)
    for (const [code, nom] of cas) {
      await page.getByRole('button', { name: 'Nouveau périmètre' }).click()
      const d = page.getByRole('dialog')
      await d.getByLabel('Code').fill(code)
      await d.getByLabel('Nom').fill(nom)
      await d.getByRole('button', { name: 'Enregistrer' }).click()
      await expect(page.getByRole('dialog')).toHaveCount(0)
    }
    const [{ n }] = await sql('select count(*)::int n from base.scopes')
    expect(n).toBe(3)
  })

  test('[rule-foundation-scope-code-format] code invalide : message du format, aucune requête, aucune mise en minuscules automatique', async ({ page }) => {
    await admin(page, '/perimetres', 'Périmètres')
    const posts = compter(page, 'POST', SCOPES)
    await page.getByRole('button', { name: 'Nouveau périmètre' }).click()
    const d = page.getByRole('dialog')
    const message = 'Le code ne doit contenir que des lettres minuscules, chiffres, tirets et tirets bas.'
    await d.getByLabel('Nom').fill('Nom valide')
    for (const mauvais of ['Majuscule', 'avec espace', 'accentué-é', '-tiret', '_bas', 'point.final', 'a'.repeat(51)]) {
      await d.getByLabel('Code').fill(mauvais)
      await d.getByRole('button', { name: 'Enregistrer' }).click()
      await expect(d.getByText(message)).toBeVisible()
      await expect(d.getByLabel('Code')).toHaveValue(mauvais)
    }
    await page.waitForTimeout(300)
    expect(posts.n).toBe(0)
  })

  test('[rule-foundation-scope-code-format] code ou nom vide (ou blanc), nom de 101 caractères : aucune requête, dialogue ouvert', async ({ page }) => {
    await admin(page, '/perimetres', 'Périmètres')
    const posts = compter(page, 'POST', SCOPES)
    await page.getByRole('button', { name: 'Nouveau périmètre' }).click()
    const d = page.getByRole('dialog')
    const enregistrer = d.getByRole('button', { name: 'Enregistrer' })
    await enregistrer.click()
    await expect(d.getByLabel('Code')).toHaveAttribute('aria-invalid', 'true')
    await expect(d.getByLabel('Nom')).toHaveAttribute('aria-invalid', 'true')
    await d.getByLabel('Code').fill('   ')
    await d.getByLabel('Nom').fill('Nom')
    await enregistrer.click()
    await expect(d.getByLabel('Code')).toHaveAttribute('aria-invalid', 'true')
    await d.getByLabel('Code').fill('code-ok')
    await d.getByLabel('Nom').fill('   ')
    await enregistrer.click()
    await expect(d.getByLabel('Nom')).toHaveAttribute('aria-invalid', 'true')
    await d.getByLabel('Nom').fill('x'.repeat(101))
    await enregistrer.click()
    await expect(d.getByLabel('Nom')).toHaveAttribute('aria-invalid', 'true')
    await expect(d).toBeVisible()
    await page.waitForTimeout(300)
    expect(posts.n).toBe(0)
  })

  test('[rule-foundation-scope-code-unique] code déjà utilisé : « Ce code est déjà utilisé. » sous le champ, dialogue ouvert, saisies conservées', async ({ page }) => {
    await connecter(page, 'admin')
    await creerPerimetre('site-a', 'Site A')
    await ouvrir(page, '/perimetres', 'Périmètres')
    await page.getByRole('button', { name: 'Nouveau périmètre' }).click()
    const d = page.getByRole('dialog')
    await d.getByLabel('Code').fill('site-a')
    await d.getByLabel('Nom').fill('Autre nom')
    await d.getByRole('button', { name: 'Enregistrer' }).click()
    await expect(d.getByText('Ce code est déjà utilisé.')).toBeVisible()
    await expect(d.getByLabel('Code')).toHaveValue('site-a')
    await expect(d.getByLabel('Nom')).toHaveValue('Autre nom')
    const [{ n }] = await sql('select count(*)::int n from base.scopes')
    expect(n).toBe(1)
  })

  test('[rule-foundation-scopes-admin-screen] pendant l\'envoi : « Enregistrement… », bouton désactivé, une seule requête', async ({ page }) => {
    await admin(page, '/perimetres', 'Périmètres')
    let appels = 0
    await page.route(SCOPES, async (route) => {
      if (route.request().method() !== 'POST') return route.fallback()
      appels++
      await new Promise((r) => setTimeout(r, 1500))
      await route.continue()
    })
    await page.getByRole('button', { name: 'Nouveau périmètre' }).click()
    const d = page.getByRole('dialog')
    await d.getByLabel('Code').fill('lent')
    await d.getByLabel('Nom').fill('Lent')
    await d.getByRole('button', { name: 'Enregistrer' }).click()
    const enCours = d.getByRole('button', { name: 'Enregistrement…' })
    await expect(enCours).toBeVisible()
    await expect(enCours).toBeDisabled()
    await expect(page.getByText('Périmètre créé.')).toBeVisible()
    expect(appels).toBe(1)
  })

  test('[rule-foundation-scopes-admin-screen] [rule-foundation-list-pagination] après une création, la liste revient à la première page', async ({ page }) => {
    await connecter(page, 'admin')
    for (let i = 1; i <= 12; i++) await creerPerimetre(`site-${String(i).padStart(2, '0')}`, `Site ${i}`)
    await ouvrir(page, '/perimetres', 'Périmètres')
    await boutonPageSuivante(page).click()
    await expect(page.getByText('11–12 sur 12')).toBeVisible()
    await page.getByRole('button', { name: 'Nouveau périmètre' }).click()
    const d = page.getByRole('dialog')
    await d.getByLabel('Code').fill('zz')
    await d.getByLabel('Nom').fill('Dernier')
    await d.getByRole('button', { name: 'Enregistrer' }).click()
    await expect(page.getByText('Périmètre créé.')).toBeVisible()
    await expect(page.getByText('1–10 sur 13')).toBeVisible()
  })

  test('[rule-foundation-scope-code-immutable] modification : code en lecture seule avec son aide, seul « name » est envoyé', async ({ page }) => {
    await connecter(page, 'admin')
    await creerPerimetre('site-a', 'Site A')
    await ouvrir(page, '/perimetres', 'Périmètres')
    await page.getByRole('button', { name: 'Modifier le périmètre site-a' }).click()
    const d = page.getByRole('dialog')
    await expect(d.getByLabel('Code')).toHaveValue('site-a')
    await expect(d.getByLabel('Code')).toHaveJSProperty('readOnly', true)
    await expect(d.getByText('Le code ne peut pas être modifié.')).toBeVisible()
    await expect(d.getByLabel('Nom')).toHaveValue('Site A')
    await d.getByLabel('Nom').fill('  Site A renommé  ')
    const requete = page.waitForRequest((r) => r.method() === 'PATCH' && SCOPE_ID.test(r.url()))
    await d.getByRole('button', { name: 'Enregistrer' }).click()
    expect((await requete).postDataJSON()).toEqual({ name: 'Site A renommé' })
    await expect(page.getByText('Périmètre modifié.')).toBeVisible()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByRole('row').filter({ hasText: 'site-a' }).getByText('Site A renommé', { exact: true })).toBeVisible()
    const [s] = await sql("select code, name from base.scopes where code = 'site-a'")
    expect(s.name).toBe('Site A renommé')
  })

  test('[rule-foundation-scope-code-format] modification : nom vide ou de 101 caractères refusé localement, aucun appel', async ({ page }) => {
    await connecter(page, 'admin')
    await creerPerimetre('site-a', 'Site A')
    await ouvrir(page, '/perimetres', 'Périmètres')
    const patchs = compter(page, 'PATCH', SCOPE_ID)
    await page.getByRole('button', { name: 'Modifier le périmètre site-a' }).click()
    const d = page.getByRole('dialog')
    await d.getByLabel('Nom').fill('   ')
    await d.getByRole('button', { name: 'Enregistrer' }).click()
    await expect(d.getByLabel('Nom')).toHaveAttribute('aria-invalid', 'true')
    await d.getByLabel('Nom').fill('x'.repeat(101))
    await d.getByRole('button', { name: 'Enregistrer' }).click()
    await expect(d.getByLabel('Nom')).toHaveAttribute('aria-invalid', 'true')
    await page.waitForTimeout(300)
    expect(patchs.n).toBe(0)
    await expect(d).toBeVisible()
  })

  test('[rule-foundation-api-failure-handling] périmètres : 400, 403, 500 à la création → messages français sans détail technique', async ({ page }) => {
    await admin(page, '/perimetres', 'Périmètres')
    await page.getByRole('button', { name: 'Nouveau périmètre' }).click()
    const d = page.getByRole('dialog')
    await d.getByLabel('Code').fill('site-x')
    await d.getByLabel('Nom').fill('Site X')
    for (const [status, texte] of [[400, INVALIDE], [403, NON_AUTORISE], [500, GENERIQUE]] as const) {
      await simuler(page, 'POST', SCOPES, status, { status, code: 'x.y', message: 'détail technique SQL' })
      await d.getByRole('button', { name: 'Enregistrer' }).click()
      await expect(d.getByText(texte)).toBeVisible()
      await expect(page.getByText(/SQL|x\.y/)).toHaveCount(0)
      await expect(d.getByLabel('Code')).toHaveValue('site-x')
      await page.unroute(SCOPES)
    }
  })

  test('[rule-foundation-api-failure-handling] périmètres : 401 à l\'enregistrement → écran de connexion', async ({ page }) => {
    await connecter(page, 'admin')
    await creerPerimetre('site-a', 'Site A')
    await ouvrir(page, '/perimetres', 'Périmètres')
    await simuler(page, 'PATCH', SCOPE_ID, 401, { status: 401, code: 'security.invalid_token', message: 'x' })
    await page.getByRole('button', { name: 'Modifier le périmètre site-a' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Enregistrer' }).click()
    await expect(page.getByRole('heading', { name: 'Connexion' })).toBeVisible()
  })

  test('[rule-foundation-scopes-admin-screen] « Annuler » et Échap ferment le dialogue sans appel', async ({ page }) => {
    await admin(page, '/perimetres', 'Périmètres')
    const posts = compter(page, 'POST', SCOPES)
    await page.getByRole('button', { name: 'Nouveau périmètre' }).click()
    await page.getByRole('dialog').getByLabel('Code').fill('abandon')
    await page.getByRole('dialog').getByRole('button', { name: 'Annuler' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.getByRole('button', { name: 'Nouveau périmètre' }).click()
    await expect(page.getByRole('dialog').getByLabel('Code')).toHaveValue('')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    expect(posts.n).toBe(0)
  })

  test('[rule-foundation-scopes-admin-screen] sous 600 px, le dialogue occupe tout l\'écran', async ({ page }) => {
    await page.setViewportSize({ width: 480, height: 800 })
    await admin(page, '/perimetres', 'Périmètres')
    await page.getByRole('button', { name: 'Nouveau périmètre' }).click()
    const boite = await page.getByRole('dialog').boundingBox()
    expect(boite).not.toBeNull()
    expect(boite!.width).toBeGreaterThanOrEqual(470)
    expect(boite!.height).toBeGreaterThanOrEqual(780)
    const largeurPage = await page.evaluate(() => document.documentElement.scrollWidth)
    expect(largeurPage).toBeLessThanOrEqual(480)
  })
})

// ───────────────────────── parcours de bout en bout ─────────────────────────

test.describe('Parcours d\'administration', () => {
  test('[rule-foundation-scope-definition] [rule-foundation-group-definition] [rule-foundation-user-groups-membership] périmètre → groupe → compte, puis cohérence entre les trois écrans', async ({ page }) => {
    await connecter(page, 'admin')
    // 1. périmètre
    await ouvrir(page, '/perimetres', 'Périmètres')
    await page.getByRole('button', { name: 'Nouveau périmètre' }).click()
    await page.getByRole('dialog').getByLabel('Code').fill('creche-nord')
    await page.getByRole('dialog').getByLabel('Nom').fill('Crèche Nord')
    await page.getByRole('dialog').getByRole('button', { name: 'Enregistrer' }).click()
    await expect(page.getByText('Périmètre créé.')).toBeVisible()

    // 2. groupe rattaché à ce périmètre (via l'onglet)
    await page.getByRole('navigation', { name: 'Administration' }).getByRole('link', { name: 'Groupes', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Groupes', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Nouveau groupe' }).click()
    await page.getByRole('dialog').getByLabel('Nom').fill('Équipe Nord')
    await choisir(page, 'Périmètres', ['creche-nord — Crèche Nord'])
    await page.getByRole('dialog').getByRole('button', { name: 'Enregistrer' }).click()
    await expect(page.getByText('Groupe créé.')).toBeVisible()
    await expect(page.getByRole('row').filter({ hasText: 'Équipe Nord' }).getByText('Aucun membre', { exact: true })).toBeVisible()

    // 3. compte membre de ce groupe
    await page.getByRole('navigation', { name: 'Administration' }).getByRole('link', { name: 'Utilisateurs', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Utilisateurs', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Nouvel utilisateur' }).click()
    await page.getByRole('dialog').getByLabel('Adresse e-mail').fill('agent@recette.test')
    await page.getByRole('dialog').getByLabel('Mot de passe').fill('Secret-2026!')
    await choisir(page, 'Groupes', ['Équipe Nord'])
    await page.getByRole('dialog').getByRole('button', { name: 'Enregistrer' }).click()
    await expect(page.getByText('Utilisateur créé.')).toBeVisible()
    await expect(page.getByRole('row').filter({ hasText: 'agent@recette.test' }).getByText('Équipe Nord', { exact: true })).toBeVisible()

    // 4. l'appartenance créée depuis le compte apparaît dans le groupe
    await page.getByRole('navigation', { name: 'Administration' }).getByRole('link', { name: 'Groupes', exact: true }).click()
    const ligne = page.getByRole('row').filter({ hasText: 'Équipe Nord' })
    await expect(ligne.getByText('1 membre', { exact: true })).toBeVisible()
    await expect(ligne.getByText('creche-nord', { exact: true })).toBeVisible()
  })

  test('[rule-foundation-user-groups-membership] un membre ajouté depuis le groupe apparaît dans les groupes du compte', async ({ page }) => {
    await connecter(page, 'admin')
    const s = await creerPerimetre('site-a', 'Site A')
    await creerCompte('bob@recette.test')
    await creerGroupe('Équipe A', [s])
    await ouvrir(page, '/groupes', 'Groupes')
    await page.getByRole('button', { name: 'Modifier le groupe Équipe A' }).click()
    await choisir(page, 'Membres', ['bob@recette.test'])
    await page.getByRole('dialog').getByRole('button', { name: 'Enregistrer' }).click()
    await expect(page.getByText('Groupe modifié.')).toBeVisible()
    await page.getByRole('navigation', { name: 'Administration' }).getByRole('link', { name: 'Utilisateurs', exact: true }).click()
    await expect(page.getByRole('row').filter({ hasText: 'bob@recette.test' }).getByText('Équipe A', { exact: true })).toBeVisible()
  })

  test('[rule-foundation-logout] après déconnexion, les écrans d\'administration ne sont plus accessibles', async ({ page }) => {
    await admin(page, '/groupes', 'Groupes')
    await page.getByRole('button', { name: 'Se déconnecter' }).click()
    await expect(page.getByRole('heading', { name: 'Connexion' })).toBeVisible()
    await page.goto('/perimetres')
    await expect(page.getByRole('heading', { name: 'Connexion' })).toBeVisible()
    expect(new URL(page.url()).searchParams.get('redirection')).toBe('/perimetres')
  })
})
