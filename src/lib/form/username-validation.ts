import {
  validateAccountName,
  type UsernameFormatCode,
} from '@/utils/validate-username'
import { validateHiveAccountExists } from '@/utils/validate-hiveuser'
import type { HiveChain } from './hive-chain-client'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export type UsernameValidationResult =
  | { readonly status: 'empty' }
  | { readonly status: 'format_error'; readonly code: UsernameFormatCode }
  | { readonly status: 'suspicious' }
  | { readonly status: 'similar' }
  | { readonly status: 'chain_error' }
  | {
      readonly status: 'check_unavailable'
      readonly retryAfterSeconds?: number
    }
  | { readonly status: 'taken' }
  | { readonly status: 'available' }

async function checkUsernamePolicy(
  username: string
): Promise<UsernameValidationResult | null> {
  try {
    const response = await fetch('/api/validate/username', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username }),
    })
    if (!response.ok) {
      const retryAfter = Number(response.headers.get('Retry-After'))
      return {
        status: 'check_unavailable',
        ...(Number.isFinite(retryAfter) && retryAfter > 0
          ? { retryAfterSeconds: retryAfter }
          : {}),
      }
    }

    const result: unknown = await response.json()
    if (!isRecord(result)) return { status: 'check_unavailable' }
    if (result.status === 'suspicious') return { status: 'suspicious' }
    if (result.status === 'similar') return { status: 'similar' }
    if (result.status === 'allowed') return null
    return { status: 'check_unavailable' }
  } catch {
    return { status: 'check_unavailable' }
  }
}

export async function validateUsername(
  username: string,
  getChain: () => Promise<HiveChain | null>
): Promise<UsernameValidationResult> {
  if (!username.trim()) return { status: 'empty' }

  const formatError = validateAccountName(username)
  if (formatError) return { status: 'format_error', code: formatError }

  const policyResult = await checkUsernamePolicy(username)
  if (policyResult) return policyResult

  let chain: HiveChain | null
  try {
    chain = await getChain()
  } catch {
    return { status: 'chain_error' }
  }
  if (!chain) return { status: 'chain_error' }

  let chainResult
  try {
    chainResult = await validateHiveAccountExists({
      chain,
      accountName: username,
    })
  } catch {
    return { status: 'chain_error' }
  }

  if (chainResult.status === 'error') return { status: 'chain_error' }
  if (chainResult.status === 'found') return { status: 'taken' }

  return { status: 'available' }
}
