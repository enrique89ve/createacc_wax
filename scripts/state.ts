import './test-setup-env.ts'
import { initializeDatabase, db } from '@/lib/database'
import { RECONCILIATION_CONFIG, RECONCILIATION_STATUS } from '@/consts/constants'
import {
	BLOCKCHAIN_STATUS,
	OPEN_CREATION_ATTEMPT_STATUSES,
	RC_STATUS,
} from '@/consts/hive-execution'
import { isAttemptStale } from '@/lib/creation-attempts'

interface SystemState {
	openAttempts: number
	staleAttempts: number
	broadcastedAccounts: number
	uncertainRc: number
	pendingReconciliations: number
	failedReconciliations: number
	abandonedReconciliations: number
}

interface OpenAttemptRow {
	readonly username: string
	readonly status: string
	readonly updatedAt: string
	readonly stale: boolean
}

interface ObservedState {
	readonly totals: SystemState
	readonly openAttempts: readonly OpenAttemptRow[]
	readonly broadcastedAccounts: readonly string[]
	readonly uncertainRc: readonly string[]
	readonly pendingReconciliations: readonly string[]
	readonly failedReconciliations: readonly string[]
	readonly abandonedReconciliations: readonly string[]
}

function formatAge(updatedAt: string): string {
	const normalized = updatedAt.includes('T') ? updatedAt : updatedAt.replace(' ', 'T')
	const timestamp = Date.parse(normalized.endsWith('Z') ? normalized : `${normalized}Z`)
	if (!Number.isFinite(timestamp)) return '?'
	const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000))
	if (minutes < 60) return `${minutes}m`
	return `${Math.floor(minutes / 60)}h${minutes % 60}m`
}

function padLabel(label: string): string {
	return label.padEnd(22, ' ')
}

async function usernamesWhere(
	table: string,
	column: string,
	value: string
): Promise<string[]> {
	const result = await db.execute({
		sql: `SELECT username FROM ${table} WHERE ${column} = ? ORDER BY username`,
		args: [value],
	})
	return result.rows.map(row => String(row.username))
}

async function readOpenAttempts(): Promise<OpenAttemptRow[]> {
	const result = await db.execute({
		sql: `SELECT username, status, updated_at
			FROM CreationAttempts
			WHERE status IN (?, ?, ?)
			ORDER BY updated_at ASC`,
		args: [...OPEN_CREATION_ATTEMPT_STATUSES],
	})
	return result.rows.map((row) => {
		const updatedAt = String(row.updated_at)
		return {
			username: String(row.username),
			status: String(row.status),
			updatedAt,
			stale: isAttemptStale(updatedAt, RECONCILIATION_CONFIG.ATTEMPT_STALE_MS),
		}
	})
}

async function readState(): Promise<ObservedState> {
	const openAttempts = await readOpenAttempts()
	const pendingReconciliations = await usernamesWhere(
		'ReconciliationQueue',
		'status',
		RECONCILIATION_STATUS.PENDING
	)
	const failedReconciliations = await usernamesWhere(
		'ReconciliationQueue',
		'status',
		RECONCILIATION_STATUS.FAILED
	)
	const abandonedReconciliations = await usernamesWhere(
		'ReconciliationQueue',
		'status',
		RECONCILIATION_STATUS.ABANDONED
	)
	const uncertainRc = await usernamesWhere('Accounts', 'rc_status', RC_STATUS.UNCERTAIN)
	const broadcastedAccounts = await usernamesWhere(
		'Accounts',
		'blockchain_status',
		BLOCKCHAIN_STATUS.BROADCASTED
	)

	return {
		totals: {
			openAttempts: openAttempts.length,
			staleAttempts: openAttempts.filter(row => row.stale).length,
			broadcastedAccounts: broadcastedAccounts.length,
			uncertainRc: uncertainRc.length,
			pendingReconciliations: pendingReconciliations.length,
			failedReconciliations: failedReconciliations.length,
			abandonedReconciliations: abandonedReconciliations.length,
		},
		openAttempts,
		broadcastedAccounts,
		uncertainRc,
		pendingReconciliations,
		failedReconciliations,
		abandonedReconciliations,
	}
}

function isClean(totals: SystemState): boolean {
	return Object.values(totals).every(value => value === 0)
}

function printUsernames(usernames: readonly string[]): void {
	for (const username of usernames) {
		console.log(`  @${username}`)
	}
}

function printOpenAttempts(rows: readonly OpenAttemptRow[]): void {
	for (const row of rows) {
		console.log(`  @${row.username}`)
		console.log(`  status: ${row.status}`)
		console.log(`  age: ${formatAge(row.updatedAt)}`)
	}
}

function printState(state: ObservedState): void {
	const { totals } = state
	console.log('HolaHive state')
	console.log('────────────────────────')
	console.log('')
	console.log('Creation')
	console.log(`${padLabel('Open attempts')}${totals.openAttempts}`)
	console.log(`${padLabel('Stale attempts')}${totals.staleAttempts}`)
	console.log(`${padLabel('Broadcasted')}${totals.broadcastedAccounts}`)
	console.log('')
	console.log('RC')
	console.log(`${padLabel('Uncertain')}${totals.uncertainRc}`)
	console.log('')
	console.log('Reconciliation')
	console.log(`${padLabel('Pending')}${totals.pendingReconciliations}`)
	console.log(`${padLabel('Failed')}${totals.failedReconciliations}`)
	console.log(`${padLabel('Abandoned')}${totals.abandonedReconciliations}`)
	console.log('')

	if (totals.openAttempts > 0) {
		console.log(`Open attempts: ${totals.openAttempts}`)
		printOpenAttempts(state.openAttempts)
		console.log('')
	}
	if (totals.broadcastedAccounts > 0) {
		console.log(`Broadcasted: ${totals.broadcastedAccounts}`)
		printUsernames(state.broadcastedAccounts)
		console.log('')
	}
	if (totals.uncertainRc > 0) {
		console.log(`RC uncertain: ${totals.uncertainRc}`)
		printUsernames(state.uncertainRc)
		console.log('')
	}
	if (totals.pendingReconciliations > 0) {
		console.log(`Pending reconcile: ${totals.pendingReconciliations}`)
		printUsernames(state.pendingReconciliations)
		console.log('')
	}
	if (totals.failedReconciliations > 0) {
		console.log(`Failed reconcile: ${totals.failedReconciliations}`)
		printUsernames(state.failedReconciliations)
		console.log('')
	}
	if (totals.abandonedReconciliations > 0) {
		console.log(`Abandoned: ${totals.abandonedReconciliations}`)
		printUsernames(state.abandonedReconciliations)
		console.log('')
	}

	console.log(isClean(totals) ? 'State clean.' : 'Attention required.')
}

async function main(): Promise<void> {
	const ok = await initializeDatabase()
	if (!ok) throw new Error('DB init failed')
	printState(await readState())
}

main().catch((error) => {
	const message = error instanceof Error ? error.message : 'Unknown error'
	console.error(message)
	process.exit(1)
})
