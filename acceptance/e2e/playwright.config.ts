import { defineConfig } from '@playwright/test'
import { existsSync } from 'node:fs'

// Navigateur : celui de la machine cloud s'il existe, sinon celui installé par `npx playwright install chromium`.
const candidates = [process.env.CUISINE_CHROMIUM, '/opt/pw-browsers/chromium'].filter(Boolean) as string[]
const executablePath = candidates.find((p) => existsSync(p))

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  reporter: [['list'], ['json', { outputFile: '../../.cuisine-run/e2e.json' }]],
  use: {
    baseURL: process.env.STUDIO_URL ?? 'http://localhost:5173',
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
    screenshot: 'only-on-failure',
    launchOptions: executablePath ? { executablePath } : {},
  },
  outputDir: '../../.cuisine-run/e2e-results',
})
