/**
 * Integration tests for the reconciliation state machine.
 *
 * Tests the full lifecycle: enqueue -> claim -> resolve/fail/abandon,
 * stuck entry recovery, race condition guards, and illegal transitions.
 *
 * Usage: pnpm tsx scripts/test-reconciliation-state-machine.ts
 */

// --- Polyfill import.meta.env BEFORE any module loads ---
// Must be inline (not imported) because ESM hoists static imports.
if (typeof import.meta.env === 'undefined') {
	// @ts-expect-error — import.meta.env is read-only in Vite but writable in Node
	import.meta.env = { DEV: true, PROD: false, SSR: true, MODE: 'development' }
}

// --- Dynamic imports (execute AFTER polyfill) ---
const { db, initializeDatabase } = await import('@/lib/database')
const {
	enqueueReconciliation,
	getPendingReconciliations,
	claimReconciliationEntry,
	markReconciliationResolved,
	markReconciliationFailed,
	markReconciliationAbandoned,
	resetStuckProcessingEntries,
	resolveReconciliationEntry,
} = await import('@/utils/db-ticket-validator')
const { RECONCILIATION_STATUS } = await import('@/consts/constants')

// --- Test harness ---

let passed = 0
let failed = 0
const failures: string[] = []

function assert(condition: boolean, label: string): void {
	if (condition) {
		passed++
		console.log(`  PASS  ${label}`)
	} else {
		failed++
		failures.push(label)
		console.error(`  FAIL  ${label}`)
	}
}

function assertEqual<T>(actual: T, expected: T, label: string): void {
	if (actual === expected) {
		passed++
		console.log(`  PASS  ${label}`)
	} else {
		failed++
		failures.push(`${label} (expected=${String(expected)}, actual=${String(actual)})`)
		console.error(`  FAIL  ${label} — expected: ${String(expected)}, got: ${String(actual)}`)
	}
}

// --- Helper to read raw row by id ---

async function getRawEntry(entryId: number) {
	const result = await db.execute({
		sql: `SELECT * FROM ReconciliationQueue WHERE id = ?`,
		args: [entryId],
	})
	return result.rows[0] ?? null
}

// --- Helper to insert a test entry and return its id ---

let testCounter = 0
async function insertTestEntry(overrides: {
	username?: string
	ticketCode?: string
	reason?: 'ambiguous_chain_error' | 'db_completion_failed'
} = {}): Promise<number> {
	testCounter++
	const username = overrides.username ?? `testuser${testCounter}`
	const ticketCode = overrides.ticketCode ?? `TESTTICKET${String(testCounter).padStart(4, '0')}`
	const reason = overrides.reason ?? 'ambiguous_chain_error'

	await enqueueReconciliation({
		correlationId: `test-corr-${testCounter}`,
		username,
		ticketCode,
		reason,
		errorCategory: 'test',
		errorMessage: 'test error',
	})

	const result = await db.execute(
		`SELECT id FROM ReconciliationQueue ORDER BY id DESC LIMIT 1`
	)
	return result.rows[0].id as number
}

// --- Cleanup test data ---

async function cleanupTestData(): Promise<void> {
	await db.execute(`DELETE FROM ReconciliationQueue WHERE correlation_id LIKE 'test-corr-%'`)
}

// ============================================================
// TEST SUITES
// ============================================================

async function testEnqueueCreatesEntry() {
	console.log('\n--- T1: enqueueReconciliation creates a pending entry ---')

	const id = await insertTestEntry()
	const raw = await getRawEntry(id)

	assert(raw !== null, 'Entry exists after enqueue')
	assertEqual(raw!.status as string, RECONCILIATION_STATUS.PENDING, 'Initial status is pending')
	assertEqual(raw!.attempt_count as number, 0, 'Initial attempt_count is 0')
	assertEqual(raw!.resolved as number, 0, 'Initial resolved is FALSE')
	assert(raw!.processing_since === null, 'Initial processing_since is NULL')
	assert(raw!.last_error === null, 'Initial last_error is NULL')
}

async function testGetPendingReturnsPendingAndFailed() {
	console.log('\n--- T2: getPendingReconciliations returns pending + failed only ---')

	const id1 = await insertTestEntry()
	const id2 = await insertTestEntry()
	const id3 = await insertTestEntry()

	// Claim and resolve id2 -> should be excluded
	await claimReconciliationEntry(id2, 'test-worker')
	await markReconciliationResolved(id2, 'test-worker')

	// Claim and fail id3 -> should still appear
	await claimReconciliationEntry(id3, 'test-worker')
	await markReconciliationFailed(id3, 'simulated failure')

	const pending = await getPendingReconciliations()
	const pendingIds = pending.map(e => e.id)

	assert(pendingIds.includes(id1), 'Pending entry id1 is returned')
	assert(!pendingIds.includes(id2), 'Resolved entry id2 is excluded')
	assert(pendingIds.includes(id3), 'Failed entry id3 is returned')
}

async function testClaimTransitionsPendingToProcessing() {
	console.log('\n--- T3: claimReconciliationEntry: pending -> processing ---')

	const id = await insertTestEntry()

	const claimed = await claimReconciliationEntry(id, 'worker-A')
	assert(claimed, 'Claim succeeds on pending entry')

	const raw = await getRawEntry(id)
	assertEqual(raw!.status as string, RECONCILIATION_STATUS.PROCESSING, 'Status is processing')
	assertEqual(raw!.attempt_count as number, 1, 'attempt_count incremented to 1')
	assert(raw!.processing_since !== null, 'processing_since is set')
	assertEqual(raw!.resolved_by as string, 'worker-A', 'resolved_by records claimer')
}

async function testClaimTransitionsFailedToProcessing() {
	console.log('\n--- T4: claimReconciliationEntry: failed -> processing ---')

	const id = await insertTestEntry()

	// First cycle: claim -> fail
	await claimReconciliationEntry(id, 'worker-A')
	await markReconciliationFailed(id, 'first failure')

	// Second cycle: re-claim from failed state
	const reclaimed = await claimReconciliationEntry(id, 'worker-B')
	assert(reclaimed, 'Re-claim succeeds on failed entry')

	const raw = await getRawEntry(id)
	assertEqual(raw!.status as string, RECONCILIATION_STATUS.PROCESSING, 'Status is processing after re-claim')
	assertEqual(raw!.attempt_count as number, 2, 'attempt_count incremented to 2')
}

async function testDoubleClaimRejected() {
	console.log('\n--- T5: Double claim is rejected (race condition guard) ---')

	const id = await insertTestEntry()

	const first = await claimReconciliationEntry(id, 'worker-A')
	const second = await claimReconciliationEntry(id, 'worker-B')

	assert(first, 'First claim succeeds')
	assert(!second, 'Second claim is rejected')

	const raw = await getRawEntry(id)
	assertEqual(raw!.resolved_by as string, 'worker-A', 'First claimer preserved')
	assertEqual(raw!.attempt_count as number, 1, 'attempt_count only incremented once')
}

async function testResolveAfterClaim() {
	console.log('\n--- T6: markReconciliationResolved: processing -> resolved ---')

	const id = await insertTestEntry()
	await claimReconciliationEntry(id, 'worker-A')

	const resolved = await markReconciliationResolved(id, 'worker-A')
	assert(resolved, 'Resolve succeeds on processing entry')

	const raw = await getRawEntry(id)
	assertEqual(raw!.status as string, RECONCILIATION_STATUS.RESOLVED, 'Status is resolved')
	assertEqual(raw!.resolved as number, 1, 'Legacy resolved=TRUE set for compat')
	assert(raw!.resolved_at !== null, 'resolved_at is set')
	assert(raw!.processing_since === null, 'processing_since is cleared')
	assert(raw!.last_error === null, 'last_error is cleared')
}

async function testFailAfterClaim() {
	console.log('\n--- T7: markReconciliationFailed: processing -> failed ---')

	const id = await insertTestEntry()
	await claimReconciliationEntry(id, 'worker-A')

	const marked = await markReconciliationFailed(id, 'DB timeout')
	assert(marked, 'Fail marking succeeds on processing entry')

	const raw = await getRawEntry(id)
	assertEqual(raw!.status as string, RECONCILIATION_STATUS.FAILED, 'Status is failed')
	assertEqual(raw!.last_error as string, 'DB timeout', 'last_error records the message')
	assert(raw!.processing_since === null, 'processing_since is cleared')
	assertEqual(raw!.resolved as number, 0, 'resolved still FALSE (retryable)')
}

async function testAbandonAfterClaim() {
	console.log('\n--- T8: markReconciliationAbandoned: processing -> abandoned ---')

	const id = await insertTestEntry()
	await claimReconciliationEntry(id, 'worker-A')

	const abandoned = await markReconciliationAbandoned(id, 'Exceeded MAX_ATTEMPTS')
	assert(abandoned, 'Abandon succeeds on processing entry')

	const raw = await getRawEntry(id)
	assertEqual(raw!.status as string, RECONCILIATION_STATUS.ABANDONED, 'Status is abandoned')
	assertEqual(raw!.resolved as number, 1, 'Legacy resolved=TRUE set (terminal)')
	assert(raw!.resolved_at !== null, 'resolved_at is set')
	assert(raw!.processing_since === null, 'processing_since is cleared')

	// Abandoned entries must NOT appear in getPendingReconciliations
	const pending = await getPendingReconciliations()
	assert(!pending.some(e => e.id === id), 'Abandoned entry excluded from pending list')
}

async function testIllegalTransitions() {
	console.log('\n--- T9: Illegal state transitions are rejected ---')

	const id = await insertTestEntry()

	// Cannot resolve from pending (must claim first)
	const resolvedFromPending = await markReconciliationResolved(id, 'attacker')
	assert(!resolvedFromPending, 'Cannot resolve directly from pending')

	// Cannot fail from pending
	const failedFromPending = await markReconciliationFailed(id, 'attack')
	assert(!failedFromPending, 'Cannot fail directly from pending')

	// Cannot abandon from pending
	const abandonedFromPending = await markReconciliationAbandoned(id, 'attack')
	assert(!abandonedFromPending, 'Cannot abandon directly from pending')

	// Claim it, then resolve it
	await claimReconciliationEntry(id, 'worker')
	await markReconciliationResolved(id, 'worker')

	// Cannot claim a resolved entry
	const claimResolved = await claimReconciliationEntry(id, 'worker')
	assert(!claimResolved, 'Cannot claim a resolved entry')

	// Cannot fail a resolved entry
	const failResolved = await markReconciliationFailed(id, 'too late')
	assert(!failResolved, 'Cannot fail a resolved entry')
}

async function testDeprecatedResolveWithoutClaim() {
	console.log('\n--- T10: Deprecated resolveReconciliationEntry without prior claim ---')

	const id = await insertTestEntry()

	// Old API call without claim — should always return false
	const result = await resolveReconciliationEntry(id, 'old-caller')
	assert(!result, 'Deprecated resolve returns false without prior claim')

	const raw = await getRawEntry(id)
	assertEqual(raw!.status as string, RECONCILIATION_STATUS.PENDING, 'Entry still pending')
}

async function testStuckEntryRecovery() {
	console.log('\n--- T11: resetStuckProcessingEntries recovers stuck entries ---')

	const id = await insertTestEntry()
	await claimReconciliationEntry(id, 'crashed-worker')

	// Simulate stuck by backdating processing_since
	await db.execute({
		sql: `UPDATE ReconciliationQueue SET processing_since = datetime('now', '-10 minutes') WHERE id = ?`,
		args: [id],
	})

	const resetCount = await resetStuckProcessingEntries(5 * 60 * 1000) // 5 min timeout
	assert(resetCount >= 1, 'At least 1 stuck entry was reset')

	const raw = await getRawEntry(id)
	assertEqual(raw!.status as string, RECONCILIATION_STATUS.FAILED, 'Stuck entry reset to failed')
	assertEqual(raw!.last_error as string, 'Stuck in processing (timeout)', 'Timeout error message recorded')
	assert(raw!.processing_since === null, 'processing_since cleared')

	// Now it should be claimable again
	const reclaimed = await claimReconciliationEntry(id, 'recovery-worker')
	assert(reclaimed, 'Reset entry can be re-claimed')
}

async function testRecentProcessingNotReset() {
	console.log('\n--- T12: Recently claimed entries are NOT reset ---')

	const id = await insertTestEntry()
	await claimReconciliationEntry(id, 'active-worker')

	// processing_since is NOW — should NOT be reset with 5min timeout
	await resetStuckProcessingEntries(5 * 60 * 1000)

	const raw = await getRawEntry(id)
	assertEqual(raw!.status as string, RECONCILIATION_STATUS.PROCESSING, 'Recent entry stays in processing')

	// Cleanup: resolve so it doesn't interfere
	await markReconciliationResolved(id, 'active-worker')
}

async function testAttemptCountAccumulates() {
	console.log('\n--- T13: attempt_count accumulates across claim/fail cycles ---')

	const id = await insertTestEntry()

	for (let i = 1; i <= 3; i++) {
		await claimReconciliationEntry(id, `worker-cycle-${i}`)
		await markReconciliationFailed(id, `failure #${i}`)
	}

	const raw = await getRawEntry(id)
	assertEqual(raw!.attempt_count as number, 3, 'attempt_count is 3 after 3 cycles')
	assertEqual(raw!.last_error as string, 'failure #3', 'last_error shows most recent failure')
}

async function testErrorMessageTruncation() {
	console.log('\n--- T14: Error messages are truncated at 512 chars ---')

	const id = await insertTestEntry()
	await claimReconciliationEntry(id, 'worker')

	const longMessage = 'X'.repeat(1000)
	await markReconciliationFailed(id, longMessage)

	const raw = await getRawEntry(id)
	assertEqual((raw!.last_error as string).length, 512, 'Error message truncated to 512')
}

async function testCheckConstraintOnNewDb() {
	console.log('\n--- T15: CHECK constraint rejects invalid status on new databases ---')

	// This test only works on databases created with the new schema.
	// Try to insert an invalid status directly.
	let rejected = false
	try {
		await db.execute({
			sql: `INSERT INTO ReconciliationQueue
				(correlation_id, username, ticket_code, reason, status)
				VALUES (?, ?, ?, ?, ?)`,
			args: ['check-test', 'checkuser', 'CHECKTICKET01', 'ambiguous_chain_error', 'INVALID_STATUS'],
		})
		// If we get here, the CHECK constraint didn't fire (old schema)
		// Clean up the invalid row
		await db.execute({ sql: `DELETE FROM ReconciliationQueue WHERE correlation_id = ?`, args: ['check-test'] })
	} catch {
		rejected = true
	}

	if (rejected) {
		assert(true, 'CHECK constraint rejected invalid status')
	} else {
		console.log('  SKIP  CHECK constraint not enforced (existing DB without constraint)')
	}
}

async function testFullLifecycleHappyPath() {
	console.log('\n--- T16: Full lifecycle: enqueue -> claim -> resolve ---')

	const id = await insertTestEntry({ username: 'lifecycleuser', ticketCode: 'LIFECYCLE00001' })

	// Verify appears in pending
	let pending = await getPendingReconciliations()
	assert(pending.some(e => e.id === id), 'Entry appears in pending after enqueue')

	// Claim
	const claimed = await claimReconciliationEntry(id, 'lifecycle-worker')
	assert(claimed, 'Claim succeeds')

	// Should no longer appear in pending (status = processing)
	pending = await getPendingReconciliations()
	assert(!pending.some(e => e.id === id), 'Processing entry excluded from pending')

	// Resolve
	const resolved = await markReconciliationResolved(id, 'lifecycle-worker')
	assert(resolved, 'Resolve succeeds')

	// Should not appear in pending
	pending = await getPendingReconciliations()
	assert(!pending.some(e => e.id === id), 'Resolved entry excluded from pending')

	// Final state check
	const raw = await getRawEntry(id)
	assertEqual(raw!.status as string, RECONCILIATION_STATUS.RESOLVED, 'Final status is resolved')
	assertEqual(raw!.resolved as number, 1, 'Legacy resolved flag is TRUE')
	assertEqual(raw!.attempt_count as number, 1, 'Single attempt recorded')
}

async function testFullLifecycleRetryPath() {
	console.log('\n--- T17: Full lifecycle: enqueue -> claim -> fail -> re-claim -> resolve ---')

	const id = await insertTestEntry({ username: 'retryuser', ticketCode: 'RETRYTICKET001' })

	// First attempt: claim -> fail
	await claimReconciliationEntry(id, 'worker-1')
	await markReconciliationFailed(id, 'network timeout')

	// Verify it reappears in pending
	let pending = await getPendingReconciliations()
	assert(pending.some(e => e.id === id), 'Failed entry reappears in pending')

	// Second attempt: re-claim -> resolve
	const reclaimed = await claimReconciliationEntry(id, 'worker-2')
	assert(reclaimed, 'Re-claim succeeds')

	const resolved = await markReconciliationResolved(id, 'worker-2')
	assert(resolved, 'Resolve succeeds on second attempt')

	const raw = await getRawEntry(id)
	assertEqual(raw!.status as string, RECONCILIATION_STATUS.RESOLVED, 'Final status is resolved')
	assertEqual(raw!.attempt_count as number, 2, 'Two attempts recorded')
	assert(raw!.last_error === null, 'last_error cleared on resolve')
}

// ============================================================
// RUNNER
// ============================================================

async function main() {
	console.log('=== Reconciliation State Machine Integration Tests ===\n')
	console.log('Initializing database...')
	await initializeDatabase()

	// Clean slate
	await cleanupTestData()

	try {
		await testEnqueueCreatesEntry()
		await testGetPendingReturnsPendingAndFailed()
		await testClaimTransitionsPendingToProcessing()
		await testClaimTransitionsFailedToProcessing()
		await testDoubleClaimRejected()
		await testResolveAfterClaim()
		await testFailAfterClaim()
		await testAbandonAfterClaim()
		await testIllegalTransitions()
		await testDeprecatedResolveWithoutClaim()
		await testStuckEntryRecovery()
		await testRecentProcessingNotReset()
		await testAttemptCountAccumulates()
		await testErrorMessageTruncation()
		await testCheckConstraintOnNewDb()
		await testFullLifecycleHappyPath()
		await testFullLifecycleRetryPath()
	} finally {
		// Cleanup test data regardless of outcome
		await cleanupTestData()
	}

	console.log('\n=== Results ===')
	console.log(`Passed: ${passed}`)
	console.log(`Failed: ${failed}`)

	if (failures.length > 0) {
		console.error('\nFailed tests:')
		for (const f of failures) {
			console.error(`  - ${f}`)
		}
		process.exit(1)
	}

	console.log('\nAll tests passed.')
}

main().catch(error => {
	console.error('Test runner failed:', error)
	process.exit(1)
})
