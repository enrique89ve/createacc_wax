import './test-setup-env.ts'
import { parseArgs } from 'node:util'
import { mkdirSync, writeFileSync } from 'node:fs'
import { EManabarType } from '@hiveio/wax'
import { initializeDatabase, db } from '@/lib/database'
import { hiveAuthEmail } from '@/lib/auth-user'
import { ENV_KEYS } from '@/consts/constants'
import { getRequiredEnvString } from '@/lib/env'
import {
	BLOCKCHAIN_STATUS,
	CREATION_ATTEMPT_STATUS,
	HIVE_TX_MODE_VALUES,
} from '@/consts/hive-execution'
import { hiveChain } from '@/lib/hiveservice'
import { checkHiveAccountFormat } from '@/utils/check-username'
import { safeCheckAccountOnChain, validateHiveAccountExistsWithPolling } from '@/utils/validate-hiveuser'
import {
	completeAccountCreationInDB,
	enqueueReconciliation,
	reserveTicketCredit,
	updateAccountBlockchainStatus,
} from '@/utils/db-ticket-validator'
import {
	getCreationAttempt,
	markAttemptBroadcasting,
	markAttemptRecoveredOnChain,
	persistAttemptBroadcastOutcome,
	persistAttemptPreparation,
	type CreationAttemptKeys,
} from '@/lib/creation-attempts'
import { HiveKeys } from '@/lib/create/get-keys'
import { createAccount, type ICreateAccountParams } from '@/lib/create/create-account'
import {
	broadcastHiveTransaction,
	HiveBroadcastAttemptError,
	type HiveBroadcaster,
} from '@/lib/hive-broadcaster'
import {
	isBroadcastEnabled,
	isSimulationMode,
} from '@/lib/hive-execution-mode'
import {
	fetchHiveAccountAuthorities,
	hiveAuthoritiesMatchExpected,
} from '@/lib/hive-account-authorities'
import { recoverOwnedAccount } from '@/lib/recover-owned-account'
import type { HiveTransactionResult } from '@/types/hive-transaction'

interface LiveFixture {
	readonly ticket: string
	readonly username: string
	readonly builderId: string
	readonly builderUsername: string
	readonly builderEmail: string
	readonly correlationId: string
}

function assert(condition: boolean, message: string): asserts condition {
	if (!condition) throw new Error(message)
}

function readConfirmLive(): boolean {
	const { values } = parseArgs({
		options: { confirmLive: { type: 'boolean', default: false } },
		strict: true,
	})
	return values.confirmLive === true
}

function enableLiveBroadcast(): void {
	process.env.HIVE_TX_MODE = HIVE_TX_MODE_VALUES.BROADCAST
	assert(!isSimulationMode() && isBroadcastEnabled(), 'Live mode did not enable the gateway')
}

function isolationIds(): LiveFixture {
	const suffix = crypto.randomUUID().replace(/-/g, '').slice(0, 8)
	const builderUsername = `livb${suffix}`
	const username = `hhlv${suffix}`
	return {
		ticket: `LIVE${suffix.toUpperCase()}`,
		username,
		builderId: crypto.randomUUID(),
		builderUsername,
		builderEmail: hiveAuthEmail(builderUsername),
		correlationId: `live-${username}`,
	}
}

function keysFromParams(params: ICreateAccountParams): CreationAttemptKeys {
	return {
		ownerPublicKey: params.ownerPublicKey,
		activePublicKey: params.activePublicKey,
		postingPublicKey: params.postingPublicKey,
		memoPublicKey: params.memoPublicKey,
	}
}

function oneBroadcast(): HiveBroadcaster {
	let attempts = 0
	return async (chain, tx) => {
		attempts += 1
		if (attempts > 1) {
			throw new Error('Live shot refused a second chain.broadcast')
		}
		return broadcastHiveTransaction(chain, tx)
	}
}

function writeAccountKeys(username: string, keys: HiveKeys): string {
	const dir = '/root/.claude/sessions'
	mkdirSync(dir, { recursive: true })
	const path = `${dir}/live-account-${username}.json`
	const body = JSON.stringify(
		{
			username,
			masterPrivateKey: keys.masterPrivateKey,
			public: keys.getAllPublicKeys(),
			private: keys.getAllPrivateKeys(),
		},
		null,
		2
	)
	writeFileSync(path, body, { mode: 0o600 })
	return path
}

async function insertFixture(fixture: LiveFixture): Promise<void> {
	await db.execute({
		sql: `INSERT INTO "user" (
			id, name, email, email_verified, username, role, auth_method, is_active
		) VALUES (?, ?, ?, 1, ?, 'builder', 'keychain', 1)`,
		args: [fixture.builderId, fixture.builderUsername, fixture.builderEmail, fixture.builderUsername],
	})
	await db.execute({
		sql: `INSERT INTO Credits (builder_id, pending_amount, available_amount, total_assigned, total_consumed)
			VALUES (?, 0, 1, 1, 0)`,
		args: [fixture.builderId],
	})
	await db.execute({
		sql: `INSERT INTO Tickets (code, description, original_credits, credits, created_by)
			VALUES (?, 'live once', 1, 1, ?)`,
		args: [fixture.ticket, fixture.builderId],
	})
}

async function preflightCreator(username: string): Promise<void> {
	const creator = getRequiredEnvString(ENV_KEYS.HIVE_CREATOR_ACCOUNT)
	const format = await checkHiveAccountFormat(username)
	assert(format.valid, `Username ${username} failed Hive format check`)

	const chain = await hiveChain()
	const creatorLookup = await chain.api.database_api.find_accounts({
		accounts: [creator],
		delayed_votes_active: true,
	})
	const creatorAccount = creatorLookup.accounts[0]
	assert(Boolean(creatorAccount), `Creator ${creator} not found on Hive`)
	const claimed = Number(creatorAccount.pending_claimed_accounts)
	assert(claimed > 0, `Creator has no pending claimed accounts (${claimed})`)

	const existing = await safeCheckAccountOnChain({ chain, accountName: username })
	assert(existing.status === 'not_found', `Username ${username} already exists on Hive (${existing.status})`)

	let rc = 'n/a'
	try {
		const manabar = await chain.calculateCurrentManabarValueForAccount(creator, EManabarType.RC)
		rc = `${manabar.percent}%`
	} catch {
		rc = 'n/a'
	}

	console.log(`creator=${creator} claimed=${claimed} rc=${rc} endpoint=${chain.endpointUrl}`)
	console.log(`username=${username} hive=absent`)
}

async function confirmOnHive(
	fixture: LiveFixture,
	params: ICreateAccountParams
): Promise<'confirmed' | 'pending'> {
	const chain = await hiveChain()
	const poll = await validateHiveAccountExistsWithPolling({
		chain,
		accountName: fixture.username,
		config: {
			initialDelayMs: 2000,
			maxDelayMs: 8000,
			maxAttempts: 10,
			timeoutMs: 60_000,
		},
	})
	if (poll.status !== 'found') {
		console.log(`hive lookup after broadcast: ${poll.status}`)
		return 'pending'
	}

	const authorities = await fetchHiveAccountAuthorities(fixture.username, chain)
	if (authorities.status !== 'found') {
		console.log(`hive authorities: ${authorities.status}`)
		return 'pending'
	}
	assert(
		hiveAuthoritiesMatchExpected(authorities.authorities, keysFromParams(params)),
		'Hive account exists with different authorities'
	)

	const confirmed = await updateAccountBlockchainStatus(
		fixture.username,
		BLOCKCHAIN_STATUS.CONFIRMED
	)
	assert(confirmed, 'Failed to persist confirmed status')
	await markAttemptRecoveredOnChain(fixture.correlationId)
	return 'confirmed'
}

async function completeAfterBroadcast(
	fixture: LiveFixture,
	tx: HiveTransactionResult | undefined,
	hiveMatched: boolean
): Promise<void> {
	const dbResult = await completeAccountCreationInDB(
		fixture.username,
		fixture.ticket,
		fixture.correlationId,
		tx,
		hiveMatched ? { hiveMatched: true } : undefined
	)
	if (dbResult.success) return
	await enqueueReconciliation({
		correlationId: fixture.correlationId,
		username: fixture.username,
		ticketCode: fixture.ticket,
		reason: 'db_completion_failed',
		errorMessage: dbResult.error,
		transactionId: tx?.id,
	})
	throw new Error(dbResult.error ?? 'DB complete failed after live broadcast')
}

async function recoverAfterBroadcastError(
	fixture: LiveFixture,
	params: ICreateAccountParams,
	error: unknown
): Promise<HiveTransactionResult> {
	const recovered = await recoverOwnedAccount({
		username: fixture.username,
		ticket: fixture.ticket,
		keys: keysFromParams(params),
		correlationId: fixture.correlationId,
	})
	if (recovered.kind === 'recovered') {
		assert(recovered.tx !== null, 'Recovered on Hive without a prepared tx id')
		await completeAfterBroadcast(fixture, recovered.tx, true)
		console.log('LIVE BROADCAST UNCERTAIN→RECOVERED on Hive')
		return recovered.tx
	}
	await enqueueReconciliation({
		correlationId: fixture.correlationId,
		username: fixture.username,
		ticketCode: fixture.ticket,
		reason: 'ambiguous_chain_error',
		errorMessage: error instanceof Error ? error.message : 'broadcast failed',
	})
	throw new Error(
		`Broadcast attempted and Hive recovery is ${recovered.kind}. Attempt left open.`
	)
}

async function broadcastOnce(
	fixture: LiveFixture,
	params: ICreateAccountParams
): Promise<{ tx: HiveTransactionResult; dbCompleted: boolean }> {
	const reserved = await reserveTicketCredit({
		ticketCode: fixture.ticket,
		correlationId: fixture.correlationId,
		username: fixture.username,
		keys: keysFromParams(params),
	})
	assert(reserved.success, reserved.error ?? 'reserve failed')

	try {
		const tx = await createAccount(
			params,
			{ broadcast: oneBroadcast() },
			async (snapshot) => {
				const persisted = await persistAttemptPreparation(fixture.correlationId, snapshot)
				assert(persisted, 'Failed to persist prepared snapshot')
				const marked = await markAttemptBroadcasting(fixture.correlationId)
				assert(marked, 'CAS broadcasting failed; refusing live broadcast')
			}
		)
		await persistAttemptBroadcastOutcome(fixture.correlationId, tx)
		assert(tx.broadcasted, 'Gateway returned broadcasted=false in live mode')
		assert(tx.mode === HIVE_TX_MODE_VALUES.BROADCAST, `Expected broadcast mode, got ${tx.mode}`)
		return { tx, dbCompleted: false }
	} catch (error) {
		if (error instanceof HiveBroadcastAttemptError) {
			const tx = await recoverAfterBroadcastError(fixture, params, error)
			return { tx, dbCompleted: true }
		}
		throw error
	}
}

async function runLiveOnce(): Promise<void> {
	enableLiveBroadcast()
	const ok = await initializeDatabase()
	assert(ok, 'DB init failed')

	const fixture = isolationIds()
	await preflightCreator(fixture.username)

	const keys = await HiveKeys.generate(fixture.username)
	const params = keys.toCreateAccountParams(fixture.username)
	const keysPath = writeAccountKeys(fixture.username, keys)
	await insertFixture(fixture)

	const { tx, dbCompleted } = await broadcastOnce(fixture, params)
	if (!dbCompleted) {
		await completeAfterBroadcast(fixture, tx, false)
	}

	const hiveStatus = await confirmOnHive(fixture, params)
	const attempt = await getCreationAttempt(fixture.correlationId)

	console.log(`ticket=${fixture.ticket}`)
	console.log(`tx=${tx.id}`)
	console.log(`attempt=${attempt?.status ?? 'missing'}`)
	console.log(`hive=${hiveStatus}`)
	console.log(`keys=${keysPath}`)
	console.log(`explorer=https://hivehub.dev/tx/${tx.id}`)
	assert(
		attempt?.status === CREATION_ATTEMPT_STATUS.COMPLETED,
		`attempt should be completed, got ${attempt?.status}`
	)
	if (hiveStatus === 'confirmed') {
		console.log('LIVE BROADCAST CONFIRMED')
		return
	}
	console.log('LIVE BROADCAST SENT — Hive confirm pending (reconciler can finish)')
}

async function printPreflightOnly(): Promise<void> {
	process.env.HIVE_TX_MODE = HIVE_TX_MODE_VALUES.SIMULATE
	const fixture = isolationIds()
	const ok = await initializeDatabase()
	assert(ok, 'DB init failed')
	await preflightCreator(fixture.username)
	console.log('Pass --confirmLive to broadcast one mainnet account. RC is not sent.')
}

async function main(): Promise<void> {
	if (!readConfirmLive()) {
		await printPreflightOnly()
		process.exit(2)
	}
	await runLiveOnce()
}

main().catch((error) => {
	const message = error instanceof Error ? error.message : 'Unknown error'
	console.error(message)
	process.exit(1)
})
