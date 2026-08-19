import { getWaxFoundation } from '@/lib/wax-foundation'

export type HiveAccountFormatCheckResult =
	| { valid: true }
	| { valid: false; reason: 'invalid_format' }
	| { valid: false; reason: 'infrastructure_error'; error: string }

/**
 * Protocol-level username format check (characters, length, segments).
 * Does not query Hive for existence — use safeCheckAccountOnChain() for that.
 */
export async function checkHiveAccountFormat(
	account: string
): Promise<HiveAccountFormatCheckResult> {
	try {
		const hive = await getWaxFoundation()
		return hive.isValidAccountName(account) === true
			? { valid: true }
			: { valid: false, reason: 'invalid_format' }
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Wax initialization failed'
		return { valid: false, reason: 'infrastructure_error', error: message }
	}
}
