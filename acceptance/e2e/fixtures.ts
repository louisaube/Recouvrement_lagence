/**
 * Aides des tests de navigateur (cuisine). Les comptes sont créés par SQL selon le contrat de données ;
 * la connexion passe par l'écran, comme un utilisateur.
 */
import { test as base, expect, type Page } from '@playwright/test'
import { createUser, resetData, closePool } from '../harness'

export const PASSWORD = 'Recette-2026!'

export async function account(role: 'user' | 'admin', email = `${role}-${Date.now()}@recette.test`) {
  await createUser({ email, password: PASSWORD, role })
  return { email, password: PASSWORD, role }
}

// Les crochets de module (`test.beforeEach` ici) ne s'attachent qu'au premier fichier qui importe ce module ;
// des fixtures automatiques s'appliquent à chaque test, quel que soit le fichier.
export const test = base.extend<{ freshData: void }, { poolLifecycle: void }>({
  freshData: [
    async ({}, use) => {
      await resetData()
      await use()
    },
    { auto: true },
  ],
  poolLifecycle: [
    async ({}, use) => {
      await use()
      await closePool()
    },
    { auto: true, scope: 'worker' },
  ],
})

export { expect, type Page }
