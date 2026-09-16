import { describe, expect, it } from 'vitest'
import {
	authoritiesFromHiveAccount,
	hiveAuthoritiesMatchExpected,
} from '@/lib/hive-account-authorities'
import { hiveTransactionFromAttempt } from '@/lib/creation-attempts'
import { CREATION_ATTEMPT_STATUS, HIVE_TX_MODE_VALUES } from '@/consts/hive-execution'
import type { CreationAttempt } from '@/lib/creation-attempts'

const KEYS = {
	ownerPublicKey: 'STM7owner',
	activePublicKey: 'STM7active',
	postingPublicKey: 'STM7posting',
	memoPublicKey: 'STM7memo',
}

describe('hive account authorities', () => {
	it('extracts sole keys from array and object auths', () => {
		const fromArrays = authoritiesFromHiveAccount({
			owner: { key_auths: [['STM7owner', 1]] },
			active: { key_auths: [['STM7active', 1]] },
			posting: { key_auths: [['STM7posting', 1]] },
			memo_key: 'STM7memo',
		})
		expect(fromArrays).toEqual({
			ownerKey: 'STM7owner',
			activeKey: 'STM7active',
			postingKey: 'STM7posting',
			memoKey: 'STM7memo',
		})

		const fromObjects = authoritiesFromHiveAccount({
			owner: { key_auths: { STM7owner: 1 } },
			active: { key_auths: { STM7active: 1 } },
			posting: { key_auths: { STM7posting: 1 } },
			memo_key: 'STM7memo',
		})
		expect(fromObjects?.ownerKey).toBe('STM7owner')
	})

	it('rejects multi-key authorities as ambiguous', () => {
		expect(
			authoritiesFromHiveAccount({
				owner: { key_auths: [['STM7owner', 1], ['STM7other', 1]] },
				active: { key_auths: [['STM7active', 1]] },
				posting: { key_auths: [['STM7posting', 1]] },
				memo_key: 'STM7memo',
			})
		).toBeNull()
	})

	it('matches only when all four expected keys equal Hive authorities', () => {
		const authorities = {
			ownerKey: KEYS.ownerPublicKey,
			activeKey: KEYS.activePublicKey,
			postingKey: KEYS.postingPublicKey,
			memoKey: KEYS.memoPublicKey,
		}
		expect(hiveAuthoritiesMatchExpected(authorities, KEYS)).toBe(true)
		expect(
			hiveAuthoritiesMatchExpected(authorities, { ...KEYS, ownerPublicKey: 'STM7other' })
		).toBe(false)
	})
})

describe('hiveTransactionFromAttempt', () => {
	it('returns null without a persisted transaction id', () => {
		const attempt: CreationAttempt = {
			correlationId: 'corr-1',
			username: 'alice',
			ticket: 'TICKET01ABCDEF',
			status: CREATION_ATTEMPT_STATUS.RESERVED,
			keys: KEYS,
			transactionId: null,
			executionMode: HIVE_TX_MODE_VALUES.BROADCAST,
			broadcasted: false,
			wax: {
				validated: false,
				onChainVerified: false,
				signed: false,
				authorityVerified: false,
			},
		}
		expect(hiveTransactionFromAttempt(attempt)).toBeNull()
	})

	it('replays persisted tx id and wax flags instead of inventing a result', () => {
		const attempt: CreationAttempt = {
			correlationId: 'corr-1',
			username: 'alice',
			ticket: 'TICKET01ABCDEF',
			status: CREATION_ATTEMPT_STATUS.PREPARED,
			keys: KEYS,
			transactionId: 'real-tx-id',
			executionMode: HIVE_TX_MODE_VALUES.BROADCAST,
			broadcasted: true,
			wax: {
				validated: true,
				onChainVerified: true,
				signed: true,
				authorityVerified: false,
			},
		}
		const tx = hiveTransactionFromAttempt(attempt)
		expect(tx?.id).toBe('real-tx-id')
		expect(tx?.broadcasted).toBe(true)
		expect(tx?.wax.authorityVerified).toBe(false)
		expect(tx?.id.startsWith('recovered-')).toBe(false)
	})
})
