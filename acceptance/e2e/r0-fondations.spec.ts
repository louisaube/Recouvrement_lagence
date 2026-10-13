/**
 * Lot r0-fondations : connexion, mise en page protégée, accueil.
 * Spécification : specifications/socle/70-ecrans.md (§2, §3, §4, §5), 20-authentification-session.md, 98-arbitrages.md.
 * Sélection par rôle et nom accessible uniquement.
 */
import { test, expect, account, type Page } from './fixtures'

const ERREUR_IDENTIFIANTS = 'Identifiants incorrects.'

async function ouvrirConnexion(page: Page, query = '') {
  await page.goto(`/connexion${query}`)
  await expect(page.getByRole('heading', { name: 'Connexion' })).toBeVisible()
}

async function saisir(page: Page, email: string, password: string) {
  await page.getByLabel('Adresse e-mail', { exact: true }).fill(email)
  await page.getByLabel('Mot de passe', { exact: true }).fill(password)
}

async function seConnecter(page: Page, email: string, password: string, query = '') {
  await ouvrirConnexion(page, query)
  await saisir(page, email, password)
  await page.getByRole('button', { name: 'Se connecter' }).click()
}

async function connecte(page: Page, role: 'user' | 'admin') {
  const a = await account(role)
  await seConnecter(page, a.email, a.password)
  await expect(page.getByRole('heading', { name: 'Bienvenue' })).toBeVisible()
  return a
}

const cheminCourant = (page: Page) => {
  const u = new URL(page.url())
  return u.pathname + u.search
}

test.describe('Écran de connexion', () => {
  test('[rule-foundation-login-screen] [rule-foundation-french-ui] éléments de l\'écran de connexion, en français', async ({ page }) => {
    await ouvrirConnexion(page)
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr')
    await expect(page.getByText('Monappli', { exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Connexion' })).toBeVisible()
    await expect(page.getByLabel('Adresse e-mail', { exact: true })).toBeVisible()
    await expect(page.getByLabel('Mot de passe', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Se connecter' })).toBeEnabled()
    // pas de « se souvenir de moi »
    await expect(page.getByRole('checkbox')).toHaveCount(0)
    // Pas de menu ni d'en-tête de mise en page commune
    await expect(page.getByRole('button', { name: 'Se déconnecter' })).toHaveCount(0)
  })

  test('[rule-foundation-login-screen] focus initial sur l\'adresse e-mail, mot de passe masqué, saisie automatique', async ({ page }) => {
    await ouvrirConnexion(page)
    const email = page.getByLabel('Adresse e-mail', { exact: true })
    const mdp = page.getByLabel('Mot de passe', { exact: true })
    await expect(email).toBeFocused()
    await expect(email).toHaveAttribute('autocomplete', 'username')
    await expect(mdp).toHaveAttribute('type', 'password')
    await expect(mdp).toHaveAttribute('autocomplete', 'current-password')
  })

  test('[rule-foundation-no-self-signup] [rule-foundation-no-password-reset] aucun lien d\'inscription ni de mot de passe oublié', async ({ page }) => {
    await ouvrirConnexion(page)
    await expect(page.getByRole('link')).toHaveCount(0)
    await expect(page.getByText(/mot de passe oublié/i)).toHaveCount(0)
    await expect(page.getByText(/cr[ée]er un compte|inscri/i)).toHaveCount(0)
  })

  test('[rule-foundation-login-screen] [rule-foundation-login-redirect-home] [rule-foundation-home-welcome] connexion nominale d\'un utilisateur : arrivée sur l\'accueil', async ({ page }) => {
    const a = await account('user')
    await seConnecter(page, a.email, a.password)
    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByRole('heading', { name: 'Bienvenue' })).toBeVisible()
    await expect(page.getByRole('main').getByText(a.email, { exact: true })).toBeVisible()
  })

  test('[rule-foundation-login-redirect-home] connexion nominale d\'un administrateur : arrivée sur l\'accueil', async ({ page }) => {
    const a = await account('admin')
    await seConnecter(page, a.email, a.password)
    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByRole('heading', { name: 'Bienvenue' })).toBeVisible()
  })

  test('[rule-foundation-login-screen] la requête de connexion envoie l\'e-mail rogné, le mot de passe et returnToken: false', async ({ page }) => {
    const a = await account('user')
    await ouvrirConnexion(page)
    await saisir(page, `  ${a.email}  `, a.password)
    const requete = page.waitForRequest((r) => r.url().includes('/auth/login') && r.method() === 'POST')
    await page.getByRole('button', { name: 'Se connecter' }).click()
    const corps = (await requete).postDataJSON()
    expect(corps).toEqual({ email: a.email, password: a.password, returnToken: false })
    await expect(page.getByRole('heading', { name: 'Bienvenue' })).toBeVisible()
  })

  test('[rule-foundation-session-persists] la connexion pose un cookie de session HttpOnly SameSite=Strict, sans jeton accessible au script', async ({ page }) => {
    await connecte(page, 'user')
    const cookies = await page.context().cookies()
    const session = cookies.filter((c) => c.name === 'monappli-jwt-localhost')
    expect(session).toHaveLength(1)
    expect(session[0].httpOnly).toBe(true)
    expect(session[0].sameSite).toBe('Strict')
    expect(session[0].path).toBe('/')
    const visible = await page.evaluate(() => document.cookie)
    expect(visible).not.toContain('monappli-jwt')
  })

  test('[rule-foundation-login-single-error] mot de passe faux : « Identifiants incorrects. » et on reste sur la connexion', async ({ page }) => {
    const a = await account('user')
    await seConnecter(page, a.email, 'Mauvais-mdp-1!')
    await expect(page.getByRole('alert')).toContainText(ERREUR_IDENTIFIANTS)
    await expect(page).toHaveURL(/\/connexion/)
    await expect(page.getByRole('button', { name: 'Se connecter' })).toBeEnabled()
    const cookies = await page.context().cookies()
    expect(cookies.filter((c) => c.name.startsWith('monappli-jwt'))).toHaveLength(0)
  })

  test('[rule-foundation-login-single-error] e-mail inconnu : exactement le même message que pour un mot de passe faux', async ({ page }) => {
    await seConnecter(page, 'inconnu@recette.test', 'Recette-2026!')
    await expect(page.getByRole('alert')).toHaveText(new RegExp(ERREUR_IDENTIFIANTS.replace('.', '\\.')))
    await expect(page).toHaveURL(/\/connexion/)
  })

  test('[rule-foundation-login-single-error] un mot de passe à la casse différente est refusé', async ({ page }) => {
    const a = await account('user')
    await seConnecter(page, a.email, a.password.toUpperCase())
    await expect(page.getByRole('alert')).toContainText(ERREUR_IDENTIFIANTS)
  })

  test('[rule-foundation-login-single-error] un e-mail mal formé (400 de l\'API) donne le même message', async ({ page }) => {
    await seConnecter(page, 'pas-un-email', 'Recette-2026!')
    await expect(page.getByRole('alert')).toContainText(ERREUR_IDENTIFIANTS)
    await expect(page).toHaveURL(/\/connexion/)
  })

  test('[rule-foundation-login-single-error] une erreur 500 de l\'API donne le même message, sans détail technique', async ({ page }) => {
    const a = await account('user')
    await page.route('**/auth/login', (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ status: 500, code: 'api.unknown_error', message: 'boom SQL trace' }) }),
    )
    await seConnecter(page, a.email, a.password)
    await expect(page.getByRole('alert')).toContainText(ERREUR_IDENTIFIANTS)
    await expect(page.getByText(/boom|api\.unknown_error|SQL/)).toHaveCount(0)
  })

  test('[rule-foundation-login-single-error] une erreur réseau donne le même message', async ({ page }) => {
    const a = await account('user')
    await page.route('**/auth/login', (route) => route.abort('failed'))
    await seConnecter(page, a.email, a.password)
    await expect(page.getByRole('alert')).toContainText(ERREUR_IDENTIFIANTS)
    await expect(page).toHaveURL(/\/connexion/)
  })

  test('[rule-foundation-login-single-error] session non établie après la connexion (current-user vide) : même message', async ({ page }) => {
    const a = await account('user')
    await page.route('**/auth/current-user', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
    )
    await seConnecter(page, a.email, a.password)
    await expect(page.getByRole('alert')).toContainText(ERREUR_IDENTIFIANTS)
    await expect(page).toHaveURL(/\/connexion/)
  })

  test('[rule-foundation-login-single-error] le message reste quand on modifie un champ puis est remplacé à la soumission suivante', async ({ page }) => {
    const a = await account('user')
    await seConnecter(page, a.email, 'Mauvais-mdp-1!')
    await expect(page.getByRole('alert')).toContainText(ERREUR_IDENTIFIANTS)
    await page.getByLabel('Mot de passe', { exact: true }).fill(a.password)
    await expect(page.getByRole('alert')).toContainText(ERREUR_IDENTIFIANTS)
    await page.getByRole('button', { name: 'Se connecter' }).click()
    await expect(page.getByRole('heading', { name: 'Bienvenue' })).toBeVisible()
    await expect(page.getByText(ERREUR_IDENTIFIANTS)).toHaveCount(0)
  })

  test('[rule-foundation-login-submit-guard] e-mail et mot de passe vides : message, aucune requête', async ({ page }) => {
    let appels = 0
    await page.route('**/auth/login', (route) => {
      appels++
      return route.continue()
    })
    await ouvrirConnexion(page)
    await page.getByRole('button', { name: 'Se connecter' }).click()
    await expect(page.getByRole('alert')).toContainText(ERREUR_IDENTIFIANTS)
    expect(appels).toBe(0)
  })

  test('[rule-foundation-login-submit-guard] e-mail seul, ou mot de passe seul : message, aucune requête', async ({ page }) => {
    let appels = 0
    await page.route('**/auth/login', (route) => {
      appels++
      return route.continue()
    })
    await ouvrirConnexion(page)
    await page.getByLabel('Adresse e-mail', { exact: true }).fill('quelquun@recette.test')
    await page.getByRole('button', { name: 'Se connecter' }).click()
    await expect(page.getByRole('alert')).toContainText(ERREUR_IDENTIFIANTS)
    await page.getByLabel('Adresse e-mail', { exact: true }).fill('')
    await page.getByLabel('Mot de passe', { exact: true }).fill('Recette-2026!')
    await page.getByRole('button', { name: 'Se connecter' }).click()
    await expect(page.getByRole('alert')).toContainText(ERREUR_IDENTIFIANTS)
    expect(appels).toBe(0)
  })

  test('[rule-foundation-login-submit-guard] [rule-foundation-login-screen] pendant l\'envoi : « Connexion en cours… », bouton désactivé, une seule requête', async ({ page }) => {
    const a = await account('user')
    let appels = 0
    await page.route('**/auth/login', async (route) => {
      appels++
      await new Promise((r) => setTimeout(r, 1500))
      await route.continue()
    })
    await ouvrirConnexion(page)
    await saisir(page, a.email, a.password)
    await page.getByRole('button', { name: 'Se connecter' }).click()
    const enCours = page.getByRole('button', { name: 'Connexion en cours…' })
    await expect(enCours).toBeVisible()
    await expect(enCours).toBeDisabled()
    // Entrée dans un champ pendant l'envoi ne déclenche pas de seconde soumission
    await page.getByLabel('Mot de passe', { exact: true }).press('Enter')
    await expect(page.getByRole('heading', { name: 'Bienvenue' })).toBeVisible()
    expect(appels).toBe(1)
  })

  test('[rule-foundation-login-screen] la touche Entrée dans le champ mot de passe soumet le formulaire', async ({ page }) => {
    const a = await account('user')
    await ouvrirConnexion(page)
    await saisir(page, a.email, a.password)
    await page.getByLabel('Mot de passe', { exact: true }).press('Enter')
    await expect(page.getByRole('heading', { name: 'Bienvenue' })).toBeVisible()
  })
})

test.describe('Destination après connexion et redirection', () => {
  test('[rule-foundation-protected-redirect] [rule-foundation-no-protected-flash] sans session, « / » redirige vers /connexion?redirection=%2F', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Connexion' })).toBeVisible()
    expect(cheminCourant(page)).toBe('/connexion?redirection=%2F')
    await expect(page.getByRole('heading', { name: 'Bienvenue' })).toHaveCount(0)
  })

  test('[rule-foundation-protected-redirect] la redirection remplace l\'entrée d\'historique', async ({ page }) => {
    await page.goto('/connexion')
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Connexion' })).toBeVisible()
    expect(cheminCourant(page)).toBe('/connexion?redirection=%2F')
    // Retour : on ne retombe pas sur « / » (qui renverrait aussitôt à la connexion)
    await page.goBack()
    expect(cheminCourant(page)).toBe('/connexion')
  })

  test('[rule-foundation-protected-redirect] [rule-foundation-login-redirect-home] la destination (chemin + paramètres) est restaurée après connexion', async ({ page }) => {
    const a = await account('user')
    await seConnecter(page, a.email, a.password, `?redirection=${encodeURIComponent('/?exemple=1&autre=a b')}`)
    await expect(page.getByRole('heading', { name: 'Bienvenue' })).toBeVisible()
    expect(new URL(page.url()).pathname).toBe('/')
    expect(new URL(page.url()).searchParams.get('exemple')).toBe('1')
    expect(new URL(page.url()).searchParams.get('autre')).toBe('a b')
  })

  test('[rule-foundation-protected-redirect] [rule-foundation-login-redirect-home] ouvrir une page protégée avec paramètres sans session conserve la destination, puis connexion y ramène', async ({ page }) => {
    const a = await account('user')
    await page.goto('/?x=1')
    await expect(page.getByRole('heading', { name: 'Connexion' })).toBeVisible()
    expect(new URL(page.url()).searchParams.get('redirection')).toBe('/?x=1')
    await saisir(page, a.email, a.password)
    await page.getByRole('button', { name: 'Se connecter' }).click()
    await expect(page.getByRole('heading', { name: 'Bienvenue' })).toBeVisible()
    expect(cheminCourant(page)).toBe('/?x=1')
  })

  for (const dangereuse of ['//evil.example.com', '/\\evil.example.com', 'https://evil.example.com/', 'accueil', '/connexion', '/a\u0001b']) {
    test(`[rule-foundation-login-redirect-home] destination refusée « ${JSON.stringify(dangereuse)} » → accueil`, async ({ page }) => {
      const a = await account('user')
      await seConnecter(page, a.email, a.password, `?redirection=${encodeURIComponent(dangereuse)}`)
      await expect(page.getByRole('heading', { name: 'Bienvenue' })).toBeVisible()
      expect(new URL(page.url()).hostname).toBe('localhost')
      expect(new URL(page.url()).pathname).toBe('/')
    })
  }

  test('[rule-foundation-login-redirect-home] la connexion remplace l\'entrée d\'historique : retour arrière ne ramène pas à la connexion', async ({ page }) => {
    const a = await account('user')
    await seConnecter(page, a.email, a.password)
    await expect(page.getByRole('heading', { name: 'Bienvenue' })).toBeVisible()
    await page.goBack()
    await expect(page.getByRole('heading', { name: 'Connexion' })).toHaveCount(0)
  })

  test('[rule-foundation-login-already-connected] un utilisateur connecté qui ouvre /connexion est redirigé vers l\'accueil', async ({ page }) => {
    await connecte(page, 'user')
    await page.goto('/connexion')
    await expect(page.getByRole('heading', { name: 'Bienvenue' })).toBeVisible()
    expect(cheminCourant(page)).toBe('/')
  })

  test('[rule-foundation-login-already-connected] [rule-foundation-login-redirect-home] déjà connecté avec ?redirection= sûre : on va à cette destination', async ({ page }) => {
    await connecte(page, 'admin')
    await page.goto(`/connexion?redirection=${encodeURIComponent('/?z=9')}`)
    await expect(page.getByRole('heading', { name: 'Bienvenue' })).toBeVisible()
    expect(cheminCourant(page)).toBe('/?z=9')
  })

  test('[rule-foundation-login-already-connected] déjà connecté avec ?redirection=//evil : accueil', async ({ page }) => {
    await connecte(page, 'user')
    await page.goto(`/connexion?redirection=${encodeURIComponent('//evil.example.com')}`)
    await expect(page.getByRole('heading', { name: 'Bienvenue' })).toBeVisible()
    expect(new URL(page.url()).hostname).toBe('localhost')
    expect(new URL(page.url()).pathname).toBe('/')
  })

  test('[rule-foundation-home-welcome] (carte des écrans §1) tout autre chemin redirige vers « / » pour un utilisateur connecté', async ({ page }) => {
    await connecte(page, 'user')
    await page.goto('/ce-chemin-nexiste-pas')
    await expect(page.getByRole('heading', { name: 'Bienvenue' })).toBeVisible()
    expect(new URL(page.url()).pathname).toBe('/')
  })
})

test.describe('Vérification de session', () => {
  test('[rule-foundation-no-protected-flash] pendant la vérification de session : « Chargement… » seul, aucun contenu protégé', async ({ page }) => {
    await connecte(page, 'user')
    await page.route('**/auth/current-user', async (route) => {
      await new Promise((r) => setTimeout(r, 2000))
      await route.continue()
    })
    await page.goto('/')
    await expect(page.getByText('Chargement…')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Bienvenue' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Se déconnecter' })).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Bienvenue' })).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText('Chargement…')).toHaveCount(0)
  })

  test('[rule-foundation-no-protected-flash] sans session, aucun contenu protégé n\'est affiché pendant la vérification', async ({ page }) => {
    await page.route('**/auth/current-user', async (route) => {
      await new Promise((r) => setTimeout(r, 1500))
      await route.continue()
    })
    await page.goto('/')
    await expect(page.getByText('Chargement…')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Bienvenue' })).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Connexion' })).toBeVisible({ timeout: 10_000 })
  })

  test('[rule-foundation-login-already-connected] pendant la vérification de session, /connexion affiche aussi le chargement', async ({ page }) => {
    await page.route('**/auth/current-user', async (route) => {
      await new Promise((r) => setTimeout(r, 1500))
      await route.continue()
    })
    await page.goto('/connexion')
    await expect(page.getByText('Chargement…')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Connexion' })).toBeVisible({ timeout: 10_000 })
  })

  test('[rule-foundation-session-persists] la session survit au rechargement de la page', async ({ page }) => {
    const a = await connecte(page, 'user')
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Bienvenue' })).toBeVisible()
    await expect(page.getByRole('main').getByText(a.email, { exact: true })).toBeVisible()
    expect(new URL(page.url()).pathname).toBe('/')
  })

  test('[rule-foundation-session-persists] la session est partagée avec un nouvel onglet du même contexte', async ({ page }) => {
    await connecte(page, 'admin')
    const autre = await page.context().newPage()
    await autre.goto('/')
    await expect(autre.getByRole('heading', { name: 'Bienvenue' })).toBeVisible()
  })

  test('[rule-foundation-session-persists] chaque contexte de navigateur a sa propre session', async ({ page, browser }) => {
    const a = await connecte(page, 'user')
    const ctx2 = await browser.newContext({ locale: 'fr-FR' })
    const page2 = await ctx2.newPage()
    const baseURL = new URL(page.url()).origin
    await page2.goto(`${baseURL}/`)
    await expect(page2.getByRole('heading', { name: 'Connexion' })).toBeVisible()
    await expect(page2.getByText(a.email)).toHaveCount(0)
    await ctx2.close()
  })

  test('[rule-foundation-session-persists] deux comptes successifs : chacun voit sa propre identité', async ({ page }) => {
    const premier = await account('user', `premier-${Date.now()}@recette.test`)
    const second = await account('admin', `second-${Date.now()}@recette.test`)
    await seConnecter(page, premier.email, premier.password)
    await expect(page.getByRole('main').getByText(premier.email, { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Se déconnecter' }).click()
    await expect(page.getByRole('heading', { name: 'Connexion' })).toBeVisible()
    await saisir(page, second.email, second.password)
    await page.getByRole('button', { name: 'Se connecter' }).click()
    await expect(page.getByRole('main').getByText(second.email, { exact: true })).toBeVisible()
    await expect(page.getByText(premier.email)).toHaveCount(0)
  })

  test('[rule-foundation-session-expired] un 401 de current-user au chargement ramène à la connexion', async ({ page }) => {
    await connecte(page, 'user')
    await page.route('**/auth/current-user', (route) =>
      route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ status: 401, code: 'security.invalid_token', message: 'Jeton invalide' }) }),
    )
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Connexion' })).toBeVisible()
    expect(cheminCourant(page)).toBe('/connexion?redirection=%2F')
    await expect(page.getByText(/Jeton invalide|security\.invalid_token/)).toHaveCount(0)
  })

  test('[rule-foundation-session-expired] un cookie de session altéré ramène à la connexion', async ({ page }) => {
    await connecte(page, 'user')
    const ctx = page.context()
    const cookies = (await ctx.cookies()).filter((c) => c.name.startsWith('monappli-jwt'))
    expect(cookies.length).toBeGreaterThan(0)
    await ctx.clearCookies()
    await ctx.addCookies(cookies.map((c) => ({ ...c, value: 'invalid.token.value' })))
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Connexion' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Bienvenue' })).toHaveCount(0)
  })

  test('[rule-foundation-api-unreachable] API injoignable au chargement : redirection vers la connexion', async ({ page }) => {
    await page.route('**/auth/current-user', (route) => route.abort('connectionrefused'))
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Connexion' })).toBeVisible()
    expect(cheminCourant(page)).toBe('/connexion?redirection=%2F')
    await expect(page.getByRole('heading', { name: 'Bienvenue' })).toHaveCount(0)
  })

  test('[rule-foundation-api-failure-handling] un 401 en cours d\'utilisation (rechargement de session) ramène à la connexion, état effacé', async ({ page }) => {
    await connecte(page, 'admin')
    await page.context().clearCookies()
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Connexion' })).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Administration' })).toHaveCount(0)
  })
})

test.describe('Mise en page commune', () => {
  test('[rule-foundation-layout-header] [rule-foundation-role-label] en-tête d\'un utilisateur : nom, e-mail, pastille « Utilisateur », déconnexion', async ({ page }) => {
    const a = await connecte(page, 'user')
    const entete = page.getByRole('banner')
    await expect(entete.getByRole('link', { name: 'Monappli' })).toHaveAttribute('href', '/')
    await expect(entete.getByText(a.email, { exact: true })).toBeVisible()
    await expect(entete.getByText('Utilisateur', { exact: true })).toBeVisible()
    await expect(entete.getByText('Administrateur', { exact: true })).toHaveCount(0)
    await expect(entete.getByRole('button', { name: 'Se déconnecter' })).toBeVisible()
  })

  test('[rule-foundation-layout-header] [rule-foundation-role-label] en-tête d\'un administrateur : pastille « Administrateur »', async ({ page }) => {
    const a = await connecte(page, 'admin')
    const entete = page.getByRole('banner')
    await expect(entete.getByText(a.email, { exact: true })).toBeVisible()
    await expect(entete.getByText('Administrateur', { exact: true })).toBeVisible()
    await expect(entete.getByText('Utilisateur', { exact: true })).toHaveCount(0)
  })

  test('[rule-foundation-layout-header] le nom de l\'application ramène à l\'accueil', async ({ page }) => {
    await connecte(page, 'user')
    await page.getByRole('banner').getByRole('link', { name: 'Monappli' }).click()
    await expect(page.getByRole('heading', { name: 'Bienvenue' })).toBeVisible()
    expect(new URL(page.url()).pathname).toBe('/')
  })

  test('[rule-foundation-layout-header] sous 600 px, le bouton de déconnexion reste accessible par son nom', async ({ page }) => {
    await page.setViewportSize({ width: 480, height: 800 })
    await connecte(page, 'user')
    const bouton = page.getByRole('button', { name: 'Se déconnecter' })
    await expect(bouton).toBeVisible()
    const largeurPage = await page.evaluate(() => document.documentElement.scrollWidth)
    expect(largeurPage).toBeLessThanOrEqual(480)
    await bouton.click()
    await expect(page.getByRole('heading', { name: 'Connexion' })).toBeVisible()
  })

  test('[rule-foundation-layout-header] un e-mail très long est tronqué dans l\'en-tête sans casser la mise en page', async ({ page }) => {
    const long = `${'a'.repeat(60)}.${'b'.repeat(60)}.${'c'.repeat(60)}@recette.test`
    await page.setViewportSize({ width: 480, height: 800 })
    const a = await account('user', long)
    await seConnecter(page, a.email, a.password)
    await expect(page.getByRole('heading', { name: 'Bienvenue' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Se déconnecter' })).toBeVisible()
    const largeurPage = await page.evaluate(() => document.documentElement.scrollWidth)
    expect(largeurPage).toBeLessThanOrEqual(480)
  })

  test('[rule-foundation-admin-nav] [rule-foundation-layout-header] un administrateur voit la navigation « Administration » et ses quatre onglets', async ({ page }) => {
    await connecte(page, 'admin')
    const nav = page.getByRole('navigation', { name: 'Administration' })
    await expect(nav).toBeVisible()
    await expect(nav.getByRole('link', { name: 'Utilisateurs', exact: true })).toHaveAttribute('href', '/utilisateurs')
    await expect(nav.getByRole('link', { name: 'Groupes', exact: true })).toHaveAttribute('href', '/groupes')
    await expect(nav.getByRole('link', { name: 'Périmètres', exact: true })).toHaveAttribute('href', '/perimetres')
    await expect(nav.getByRole('link', { name: 'Journal', exact: true })).toHaveAttribute('href', '/journal')
  })

  test('[rule-foundation-admin-nav] sur l\'accueil, aucun onglet d\'administration n\'est actif', async ({ page }) => {
    await connecte(page, 'admin')
    const nav = page.getByRole('navigation', { name: 'Administration' })
    await expect(nav.locator('[aria-selected="true"], [aria-current]')).toHaveCount(0)
  })

  test('[rule-foundation-admin-nav] un utilisateur ordinaire a l\'en-tête sans onglets d\'administration', async ({ page }) => {
    await connecte(page, 'user')
    await expect(page.getByRole('navigation', { name: 'Administration' })).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Utilisateurs', exact: true })).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Groupes', exact: true })).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Périmètres', exact: true })).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Journal', exact: true })).toHaveCount(0)
  })

  test('[rule-foundation-layout-header] le contenu des pages est centré, de largeur maximale d\'environ 1 200 px', async ({ page }) => {
    await page.setViewportSize({ width: 1800, height: 900 })
    await connecte(page, 'user')
    const boite = await page.getByRole('main').boundingBox()
    expect(boite).not.toBeNull()
    expect(boite!.width).toBeLessThanOrEqual(1300)
    expect(boite!.width).toBeGreaterThan(300)
    const gauche = boite!.x
    const droite = 1800 - (boite!.x + boite!.width)
    expect(Math.abs(gauche - droite)).toBeLessThan(40)
  })
})

test.describe('Déconnexion', () => {
  test('[rule-foundation-logout] « Se déconnecter » ramène à /connexion et efface la session', async ({ page }) => {
    await connecte(page, 'user')
    await page.getByRole('button', { name: 'Se déconnecter' }).click()
    await expect(page.getByRole('heading', { name: 'Connexion' })).toBeVisible()
    expect(new URL(page.url()).pathname).toBe('/connexion')
    const cookies = await page.context().cookies()
    expect(cookies.filter((c) => c.name.startsWith('monappli-jwt') && c.value !== '')).toHaveLength(0)
  })

  test('[rule-foundation-logout] [rule-foundation-session-persists] après déconnexion, un rechargement ne restaure pas la session', async ({ page }) => {
    await connecte(page, 'user')
    await page.getByRole('button', { name: 'Se déconnecter' }).click()
    await expect(page.getByRole('heading', { name: 'Connexion' })).toBeVisible()
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Connexion' })).toBeVisible()
    expect(cheminCourant(page)).toBe('/connexion?redirection=%2F')
  })

  test('[rule-foundation-logout] l\'appel POST /auth/logout est émis', async ({ page }) => {
    await connecte(page, 'admin')
    const requete = page.waitForRequest((r) => r.url().includes('/auth/logout') && r.method() === 'POST')
    await page.getByRole('button', { name: 'Se déconnecter' }).click()
    await requete
    await expect(page.getByRole('heading', { name: 'Connexion' })).toBeVisible()
  })

  test('[rule-foundation-logout] la déconnexion aboutit même si l\'appel échoue', async ({ page }) => {
    await connecte(page, 'user')
    await page.route('**/auth/logout', (route) => route.abort('failed'))
    await page.getByRole('button', { name: 'Se déconnecter' }).click()
    await expect(page.getByRole('heading', { name: 'Connexion' })).toBeVisible()
    expect(new URL(page.url()).pathname).toBe('/connexion')
    // état local effacé : l'en-tête n'est plus rendu
    await expect(page.getByRole('button', { name: 'Se déconnecter' })).toHaveCount(0)
  })

  test('[rule-foundation-logout] la déconnexion aboutit même si l\'API répond 500', async ({ page }) => {
    await connecte(page, 'user')
    await page.route('**/auth/logout', (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ status: 500, code: 'api.unknown_error', message: 'x' }) }),
    )
    await page.getByRole('button', { name: 'Se déconnecter' }).click()
    await expect(page.getByRole('heading', { name: 'Connexion' })).toBeVisible()
  })

  test('[rule-foundation-logout] après déconnexion on peut se reconnecter avec le même compte', async ({ page }) => {
    const a = await connecte(page, 'user')
    await page.getByRole('button', { name: 'Se déconnecter' }).click()
    await expect(page.getByRole('heading', { name: 'Connexion' })).toBeVisible()
    await saisir(page, a.email, a.password)
    await page.getByRole('button', { name: 'Se connecter' }).click()
    await expect(page.getByRole('heading', { name: 'Bienvenue' })).toBeVisible()
  })

  test('[rule-foundation-logout] les champs de connexion sont vides après déconnexion', async ({ page }) => {
    await connecte(page, 'user')
    await page.getByRole('button', { name: 'Se déconnecter' }).click()
    await expect(page.getByRole('heading', { name: 'Connexion' })).toBeVisible()
    await expect(page.getByLabel('Adresse e-mail', { exact: true })).toHaveValue('')
    await expect(page.getByLabel('Mot de passe', { exact: true })).toHaveValue('')
    await expect(page.getByText(ERREUR_IDENTIFIANTS)).toHaveCount(0)
  })
})

test.describe('Accueil', () => {
  test('[rule-foundation-home-welcome] « Bienvenue » puis l\'e-mail sur une ligne séparée (aussi présent dans l\'en-tête)', async ({ page }) => {
    const a = await connecte(page, 'user')
    const titre = page.getByRole('heading', { name: 'Bienvenue' })
    await expect(titre).toBeVisible()
    const email = page.getByRole('main').getByText(a.email, { exact: true })
    await expect(email).toBeVisible()
    await expect(page.getByRole('banner').getByText(a.email, { exact: true })).toBeVisible()
    const bTitre = await titre.boundingBox()
    const bEmail = await email.boundingBox()
    expect(bEmail!.y).toBeGreaterThan(bTitre!.y + bTitre!.height - 2)
  })

  test('[rule-foundation-home-welcome] l\'accueil d\'un administrateur affiche aussi « Bienvenue » et son e-mail', async ({ page }) => {
    const a = await connecte(page, 'admin')
    await expect(page.getByRole('main').getByText(a.email, { exact: true })).toBeVisible()
  })

  test('[rule-foundation-home-replaceable] la page d\'accueil n\'a ni bouton, ni lien, ni champ, ni menu', async ({ page }) => {
    await connecte(page, 'user')
    const principal = page.getByRole('main')
    await expect(principal.getByRole('button')).toHaveCount(0)
    await expect(principal.getByRole('link')).toHaveCount(0)
    await expect(principal.getByRole('textbox')).toHaveCount(0)
    await expect(principal.getByRole('combobox')).toHaveCount(0)
    await expect(principal.getByRole('img')).toHaveCount(0)
  })

  test('[rule-foundation-home-replaceable] l\'accueil n\'appelle aucune route de l\'API (hors vérification de session) lors d\'une navigation interne', async ({ page }) => {
    await connecte(page, 'user')
    const appels: string[] = []
    page.on('request', (r) => {
      if (r.resourceType() === 'fetch' || r.resourceType() === 'xhr') appels.push(new URL(r.url()).pathname)
    })
    await page.getByRole('banner').getByRole('link', { name: 'Monappli' }).click()
    await expect(page.getByRole('heading', { name: 'Bienvenue' })).toBeVisible()
    await page.waitForTimeout(500)
    expect(appels).toEqual([])
  })
})
