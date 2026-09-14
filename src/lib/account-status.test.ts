import { describe, expect, it } from 'vitest'
import {
	BLOCKCHAIN_STATUS,
	HIVE_TX_MODE_VALUES,
	WAX_STATUS,
} from '@/consts/hive-execution'
import {
	creationFlagsFromPersistedAccount,
	toAccountStatusLabel,
	type PersistedAccountCreation,
} from '@/lib/account-status'

function persisted(
	overrides: Partial<PersistedAccountCreation> = {}
): PersistedAccountCreation {
	return {
		username: 'test123',
		executionMode: HIVE_TX_MODE_VALUES.SIMULATE,
		blockchainStatus: BLOCKCHAIN_STATUS.SIMULATED,
		transactionId: 'tx-1',
		waxStatus: WAX_STATUS.PASSED,
		...overrides,
	}
}

describe('account status mapping', () => {
	it('does not treat broadcasted as confirmed', () => {
		expect(toAccountStatusLabel(BLOCKCHAIN_STATUS.BROADCASTED)).toBe('BROADCASTED')
		expect(toAccountStatusLabel(BLOCKCHAIN_STATUS.CONFIRMED)).toBe('CONFIRMED')
	})

	it('idempotent flags come from the persisted row, not current server mode', () => {
		const flags = creationFlagsFromPersistedAccount(persisted())
		expect(flags.executionMode).toBe(HIVE_TX_MODE_VALUES.SIMULATE)
		expect(flags.broadcasted).toBe(false)
		expect(flags.chainConfirmed).toBe(false)
	})

	it('broadcasted rows are not chain-confirmed', () => {
		const flags = creationFlagsFromPersistedAccount(
			persisted({
				executionMode: HIVE_TX_MODE_VALUES.BROADCAST,
				blockchainStatus: BLOCKCHAIN_STATUS.BROADCASTED,
			})
		)
		expect(flags.broadcasted).toBe(true)
		expect(flags.chainConfirmed).toBe(false)
	})

	it('confirmed rows report both broadcasted and chainConfirmed', () => {
		const flags = creationFlagsFromPersistedAccount(
			persisted({
				executionMode: HIVE_TX_MODE_VALUES.BROADCAST,
				blockchainStatus: BLOCKCHAIN_STATUS.CONFIRMED,
			})
		)
		expect(flags.broadcasted).toBe(true)
		expect(flags.chainConfirmed).toBe(true)
	})
})
