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
import { BLOCKCHAIN_STATUS, RC_STATUS } from '@/consts/hive-execution'
import { analyzeWaxError } from '@/lib/wax-error-utils'
import { AppErrorCode } from '@/consts/errors'
import { fetchRcDelegationExists } from '@/lib/hive-rc-lookup'

const processedUsers = new Set<string>()

function scheduleUserCleanup(username: string): void {
	setTimeout(() => {
		processedUsers.delete(username)
	}, RC_DELEGATION_CONFIG.CACHE_CLEANUP_MS)
}

async function markRcDelegated(username: string): Promise<void> {
	await db.execute({
		sql: `UPDATE Accounts
			SET rc_status = ?, rc_delegated = 1
			WHERE username = ?`,
		args: [RC_STATUS.DELEGATED, username],
	})
}

async function releaseRcProcessing(username: string): Promise<void> {
	await db.execute({
		sql: `UPDATE Accounts
			SET rc_status = ?
			WHERE username = ? AND rc_status = ?`,
		args: [RC_STATUS.PENDING, username, RC_STATUS.PROCESSING],
	})
}

async function markRcUncertain(username: string): Promise<void> {
	await db.execute({
		sql: `UPDATE Accounts
			SET rc_status = ?
			WHERE username = ? AND rc_status = ?`,
		args: [RC_STATUS.UNCERTAIN, username, RC_STATUS.PROCESSING],
	})
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
				await markRcDelegated(username)
				logger.info(
					`[rc-delegation] Delegated RC to ${username} broadcast=${result.broadcasted} tx=${result.id}`
				)
				scheduleUserCleanup(username)
				return
			} catch (error) {
				const errMsg = error instanceof Error ? error.message : 'Unknown error'
				const analyzed = analyzeWaxError(error)
				if (analyzed.code === AppErrorCode.RC_DELEGATION_EXISTS) {
					await markRcDelegated(username)
					logger.info(`[rc-delegation] RC already present for ${username}`)
					scheduleUserCleanup(username)
					return
				}
				if (error instanceof HiveBroadcastAttemptError) {
					await markRcUncertain(username)
					logger.warn(
						`[rc-delegation] Broadcast already attempted for ${username}: ${errMsg}. Marked uncertain.`
					)
					processedUsers.delete(username)
					return
				}
				if (attempt < RC_DELEGATION_CONFIG.MAX_RETRIES) {
					logger.warn(`[rc-delegation] Attempt ${attempt + 1} failed for ${username}: ${errMsg}. Retrying...`)
					await new Promise(resolve => setTimeout(resolve, RC_DELEGATION_CONFIG.RETRY_DELAY_MS))
				} else {
					logger.error(`[rc-delegation] All attempts failed for ${username}: ${errMsg}`)
					await releaseRcProcessing(username)
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
			SET rc_status = ?
			WHERE username = ?
			  AND rc_status = ?
			  AND blockchain_status = ?
			RETURNING username`,
		args: [RC_STATUS.PROCESSING, username, RC_STATUS.PENDING, BLOCKCHAIN_STATUS.CONFIRMED],
	})
	return result.rows.length > 0
}

export async function claimAndQueueConfirmedRc(username: string): Promise<boolean> {
	const claimed = await claimAccountRcDelegation(username)
	if (!claimed) return false
	queueRcDelegation(username)
	return true
}

export async function listUncertainRcUsernames(): Promise<string[]> {
	const result = await db.execute({
		sql: `SELECT username FROM Accounts
			WHERE rc_status = ? AND blockchain_status = ?`,
		args: [RC_STATUS.UNCERTAIN, BLOCKCHAIN_STATUS.CONFIRMED],
	})
	return result.rows.map((row) => String(row.username))
}

export async function reconcileUncertainRcDelegations(): Promise<number> {
	const usernames = await listUncertainRcUsernames()
	let resolved = 0
	for (const username of usernames) {
		const lookup = await fetchRcDelegationExists(username)
		if (lookup.status === 'found') {
			await markRcDelegated(username)
			resolved += 1
			continue
		}
		if (lookup.status === 'not_found') {
			await db.execute({
				sql: `UPDATE Accounts SET rc_status = ? WHERE username = ? AND rc_status = ?`,
				args: [RC_STATUS.PENDING, username, RC_STATUS.UNCERTAIN],
			})
			await claimAndQueueConfirmedRc(username)
			resolved += 1
		}
	}
	return resolved
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
