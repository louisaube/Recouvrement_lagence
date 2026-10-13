// Captures d'écran pour la recette en session cloud (aucun navigateur côté humain).
// Usage : node shots.mjs /chemin1 /chemin2 ...   (SHOT_EMAIL / SHOT_PASSWORD : connexion par /login)
import { createRequire } from 'node:module'
import { existsSync, mkdirSync } from 'node:fs'
const require = createRequire(process.env.NODE_PATH + '/')
const { chromium } = require('playwright-core')
const candidates = [process.env.CUISINE_CHROMIUM, '/opt/pw-browsers/chromium', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'].filter(Boolean)
const executablePath = candidates.find((p) => existsSync(p))
if (!executablePath) { console.error('Chromium introuvable : définir CUISINE_CHROMIUM'); process.exit(1) }
const base = process.env.SHOT_BASE ?? 'http://localhost:5173'
const out = '.cuisine-run/shots'; mkdirSync(out, { recursive: true })
const browser = await chromium.launch({ executablePath })
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
if (process.env.SHOT_EMAIL) {
  // The login page is wherever the application redirects an anonymous visitor.
  await page.goto(base + (process.env.SHOT_LOGIN_PATH ?? '/'), { waitUntil: 'networkidle' })
  await page.locator('input[type=email], input[name=email]').first().fill(process.env.SHOT_EMAIL)
  await page.locator('input[type=password]').first().fill(process.env.SHOT_PASSWORD)
  await page.keyboard.press('Enter'); await page.waitForTimeout(1500)
}
for (const path of process.argv.slice(2)) {
  await page.goto(base + path, { waitUntil: 'networkidle' }); await page.waitForTimeout(800)
  const file = `${out}/${(process.env.SHOT_EMAIL ? process.env.SHOT_EMAIL.split('@')[0] + '-' : '')}${path.replace(/[^a-z0-9]+/gi, '_') || 'root'}.png`
  await page.screenshot({ path: file, fullPage: true }); console.log(file)
}
console.log(errors.length ? 'Erreurs navigateur : ' + JSON.stringify(errors.slice(0, 5)) : 'Aucune erreur navigateur')
await browser.close()
