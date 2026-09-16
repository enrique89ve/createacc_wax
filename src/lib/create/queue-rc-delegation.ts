import { logger } from '@/lib/logger'
import {
	delegateResourceCredits,
	simulateRcDelegation,
} from '@/lib/create/delegate-rc'
import {
	canDelegateResourceCredits,
	isBroadcastEnabled,
} from '@/lib/hive-execution-mode'
import { HiveBroadcastAttemptError } from '@/lib/hive-broadcaster'
import { RC_DELEGATION_AMOUNT, RC_DELEGATION_CONFIG } from '@/consts/constants'
import { db } from '@/lib/database'
import { BLOCKCHAIN_STATUS } from '@/consts/hive-execution'

const processedUsers = new Set<string>()

function scheduleUserCleanup(username: string): void {
	setTimeout(() => {
		processedUsers.delete(username)
	}, RC_DELEGATION_CONFIG.CACHE_CLEANUP_MS)
}

function scheduleRcDelegation(username: string): void {
	if (processedUsers.has(username)) return
	processedUsers.add(username)

	setTimeout(async () => {
		for (let attempt = 0; attempt <= RC_DELEGATION_CONFIG.MAX_RETRIES; attempt++) {
			try {
				const result = await delegateResourceCredits({
					delegatee: username,
					maxRc: RC_DELEGATION_AMOUNT,
				})
				logger.info(
					`[rc-delegation] Delegated RC to ${username} broadcast=${result.broadcasted} tx=${result.id}`
				)
				scheduleUserCleanup(username)
				return
			} catch (error) {
				const errMsg = error instanceof Error ? error.message : 'Unknown error'
				if (error instanceof HiveBroadcastAttemptError) {
					logger.warn(
						`[rc-delegation] Broadcast already attempted for ${username}: ${errMsg}. Not retrying.`
					)
					processedUsers.delete(username)
					return
				}
				if (attempt < RC_DELEGATION_CONFIG.MAX_RETRIES) {
					logger.warn(`[rc-delegation] Attempt ${attempt + 1} failed for ${username}: ${errMsg}. Retrying...`)
					await new Promise(resolve => setTimeout(resolve, RC_DELEGATION_CONFIG.RETRY_DELAY_MS))
				} else {
					logger.error(`[rc-delegation] All attempts failed for ${username}: ${errMsg}`)
					processedUsers.delete(username)
				}
			}
		}
	}, RC_DELEGATION_CONFIG.DELAY_MS)
}

export function queueRcDelegation(username: string): void {
	if (isBroadcastEnabled()) {
		scheduleRcDelegation(username)
		return
	}
	simulateRcDelegation(username, RC_DELEGATION_AMOUNT).catch((error) => {
		const errMsg = error instanceof Error ? error.message : 'Unknown error'
		logger.warn(`[rc-delegation] Unexpected simulation error for ${username}: ${errMsg}`)
	})
}

export async function claimAccountRcDelegation(username: string): Promise<boolean> {
	const result = await db.execute({
		sql: `UPDATE Accounts
			SET rc_delegated = 1
			WHERE username = ?
			  AND rc_delegated = 0
			  AND blockchain_status = ?
			RETURNING username`,
		args: [username, BLOCKCHAIN_STATUS.CONFIRMED],
	})
	return result.rows.length > 0
}

export async function claimAndQueueConfirmedRc(username: string): Promise<boolean> {
	const claimed = await claimAccountRcDelegation(username)
	if (!claimed) return false
	queueRcDelegation(username)
	return true
}

export function maybeQueueRcDelegation(username: string, chainConfirmed: boolean): void {
	if (!canDelegateResourceCredits(chainConfirmed)) return
	if (isBroadcastEnabled()) {
		claimAndQueueConfirmedRc(username).catch((error) => {
			const errMsg = error instanceof Error ? error.message : 'Unknown error'
			logger.warn(`[rc-delegation] Failed to claim RC for ${username}: ${errMsg}`)
		})
		return
	}
	queueRcDelegation(username)
}
