import { validateAccountName } from '@/utils/validate-username'
import { validateHiveAccountExists } from '@/utils/validate-hiveuser'
import type { HiveChain } from './hive-chain-client'

export type UsernameValidationResult =
  | { readonly status: 'empty' }
  | { readonly status: 'format_error'; readonly message: string }
  | { readonly status: 'suspicious' }
  | { readonly status: 'similar' }
  | { readonly status: 'chain_error' }
  | { readonly status: 'taken' }
  | { readonly status: 'available' }

async function checkSuspiciousUsername(username: string): Promise<boolean> {
  try {
    const response = await fetch('/api/validate/suspicious', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username }),
    })
    const result = await response.json()
    return result.isSuspicious === true
  } catch {
    return false
  }
}

async function checkSimilarUsername(username: string): Promise<boolean> {
  try {
    const response = await fetch('/api/validate/similarity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username }),
    })
    const result = await response.json()
    return result.isSimilar === true
  } catch {
    return false
  }
}

export async function validateUsername(
  username: string,
  getChain: () => Promise<HiveChain | null>
): Promise<UsernameValidationResult> {
  if (!username.trim()) return { status: 'empty' }

  const formatError = validateAccountName(username)
  if (formatError) return { status: 'format_error', message: formatError }

  const [isSuspicious, isSimilar] = await Promise.all([
    checkSuspiciousUsername(username),
    checkSimilarUsername(username),
  ])
  if (isSuspicious) return { status: 'suspicious' }
  if (isSimilar) return { status: 'similar' }

  const chain = await getChain()
  if (!chain) return { status: 'chain_error' }

  const chainResult = await validateHiveAccountExists({
    chain,
    accountName: username,
  })

  if (chainResult.status === 'error') return { status: 'chain_error' }
  if (chainResult.status === 'found') return { status: 'taken' }

  return { status: 'available' }
}
