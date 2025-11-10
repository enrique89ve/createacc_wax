import { createWaxFoundation } from '@hiveio/wax'

const hivePromise = createWaxFoundation()

export async function checkHiveAccount(account: string): Promise<boolean> {
  try {
    const hive = await hivePromise
    const result = hive.isValidAccountName(account)
    return result === true
  } catch (error) {
    return false
  }
}

// Nota: la ejecución de prueba se movió a scripts/check-hive-account.ts
