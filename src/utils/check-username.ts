import { getWaxFoundation } from '@/lib/wax-foundation'

export type HiveAccountCheckResult =
	| { valid: true }
	| { valid: false; reason: 'invalid_format' }
	| { valid: false; reason: 'infrastructure_error'; error: string }

export async function checkHiveAccount(account: string): Promise<HiveAccountCheckResult> {
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
