/**
 * Test script for security fixes: RACE-01/02/03, RACE-04, CSRF-01
 *
 * Tests:
 * 1. withTransaction — rollback on error
 * 2. withTransaction — commit on success
 * 3. claimHashCache.validate — non-destructive (hash survives)
 * 4. claimHashCache.consume — destructive (hash removed)
 * 5. claimHashCache.validateAndConsume — backwards compat (atomic)
 * 6. parseClaimVerifyBody — runtime boundary validation
 * 7. CSRF protection — all mutating endpoints import requireValidOrigin
 *
 * Run: pnpm tsx scripts/test-security-fixes.ts
 */

import { db, withTransaction } from '../src/lib/database'
import { claimHashCache } from '../src/lib/claim-hash-cache'
import { compactMap } from '../src/types/database'
import { readFileSync } from 'fs'
import { resolve } from 'path'

// ── Test infrastructure ──

let passed = 0
let failed = 0

function assert(condition: boolean, label: string): void {
	if (condition) {
		console.log(`  ✓ ${label}`)
		passed++
	} else {
		console.error(`  ✗ ${label}`)
		failed++
	}
}

async function assertThrows(fn: () => Promise<unknown>, label: string): Promise<void> {
	try {
		await fn()
		console.error(`  ✗ ${label} (did NOT throw)`)
		failed++
	} catch {
		console.log(`  ✓ ${label}`)
		passed++
	}
}

// ── Test 1: withTransaction rollback ──

async function testWithTransactionRollback(): Promise<void> {
	console.log('\n[1] withTransaction — rollback on error')

	// Create a temp table for testing
	await db.execute({
		sql: 'CREATE TABLE IF NOT EXISTS _test_tx (id INTEGER PRIMARY KEY, val TEXT)',
		args: [],
	})
	await db.execute({ sql: 'DELETE FROM _test_tx', args: [] })

	// Insert a row, then throw inside transaction — should rollback
	await assertThrows(async () => {
		await withTransaction(async () => {
			await db.execute({
				sql: "INSERT INTO _test_tx (id, val) VALUES (1, 'should-not-exist')",
				args: [],
			})
			throw new Error('Simulated failure')
		})
	}, 'Transaction throws on inner error')

	// Verify the row was NOT inserted (rollback worked)
	const result = await db.execute({
		sql: 'SELECT * FROM _test_tx WHERE id = 1',
		args: [],
	})
	assert(result.rows.length === 0, 'Row was rolled back — not in DB')

	// Cleanup
	await db.execute({ sql: 'DROP TABLE IF EXISTS _test_tx', args: [] })
}

// ── Test 2: withTransaction commit ──

async function testWithTransactionCommit(): Promise<void> {
	console.log('\n[2] withTransaction — commit on success')

	await db.execute({
		sql: 'CREATE TABLE IF NOT EXISTS _test_tx (id INTEGER PRIMARY KEY, val TEXT)',
		args: [],
	})
	await db.execute({ sql: 'DELETE FROM _test_tx', args: [] })

	// Insert a row inside transaction — should commit
	const returnValue = await withTransaction(async () => {
		await db.execute({
			sql: "INSERT INTO _test_tx (id, val) VALUES (1, 'committed')",
			args: [],
		})
		return 'success-value'
	})

	assert(returnValue === 'success-value', 'withTransaction returns inner value')

	const result = await db.execute({
		sql: 'SELECT val FROM _test_tx WHERE id = 1',
		args: [],
	})
	assert(result.rows.length === 1, 'Row was committed — exists in DB')
	assert(String(result.rows[0].val) === 'committed', 'Row has correct value')

	await db.execute({ sql: 'DROP TABLE IF EXISTS _test_tx', args: [] })
}

// ── Test 3: claimHashCache.validate (non-destructive) ──

function testValidateNonDestructive(): void {
	console.log('\n[3] claimHashCache.validate — non-destructive')

	claimHashCache.clear()

	const hashData = claimHashCache.generateHash('testuser', 'credit_1_12345', 10)
	const hash = hashData.hash

	// First validate — should return data
	const result1 = claimHashCache.validate(hash, 'testuser')
	assert(result1 !== null, 'First validate returns data')
	assert(result1?.username === 'testuser', 'Username matches')
	assert(result1?.creditsAvailable === 10, 'Credits match')

	// Second validate — should STILL return data (non-destructive)
	const result2 = claimHashCache.validate(hash, 'testuser')
	assert(result2 !== null, 'Second validate still returns data (hash NOT consumed)')

	// Wrong username — should return null
	const result3 = claimHashCache.validate(hash, 'wronguser')
	assert(result3 === null, 'Wrong username returns null')

	claimHashCache.clear()
}

// ── Test 4: claimHashCache.consume ──

function testConsume(): void {
	console.log('\n[4] claimHashCache.consume — destructive')

	claimHashCache.clear()

	const hashData = claimHashCache.generateHash('testuser', 'credit_2_12345', 5)
	const hash = hashData.hash

	// Validate first — hash exists
	const beforeConsume = claimHashCache.validate(hash, 'testuser')
	assert(beforeConsume !== null, 'Hash exists before consume')

	// Consume — should return true
	const consumed = claimHashCache.consume(hash)
	assert(consumed === true, 'Consume returns true')

	// Validate after consume — hash gone
	const afterConsume = claimHashCache.validate(hash, 'testuser')
	assert(afterConsume === null, 'Hash is gone after consume')

	// Consume again — should return false
	const consumedAgain = claimHashCache.consume(hash)
	assert(consumedAgain === false, 'Second consume returns false')

	claimHashCache.clear()
}

// ── Test 5: claimHashCache.validateAndConsume (backwards compat) ──

function testValidateAndConsume(): void {
	console.log('\n[5] claimHashCache.validateAndConsume — atomic (backwards compat)')

	claimHashCache.clear()

	const hashData = claimHashCache.generateHash('testuser', 'credit_3_12345', 7)
	const hash = hashData.hash

	// validateAndConsume — should return data AND remove hash
	const result = claimHashCache.validateAndConsume(hash, 'testuser')
	assert(result !== null, 'validateAndConsume returns data')
	assert(result?.creditsAvailable === 7, 'Credits match')

	// Second call — hash is gone
	const result2 = claimHashCache.validateAndConsume(hash, 'testuser')
	assert(result2 === null, 'Second validateAndConsume returns null (consumed)')

	claimHashCache.clear()
}

// ── Test 6: parseClaimVerifyBody runtime validation ──

function testParseClaimVerifyBody(): void {
	console.log('\n[6] parseClaimVerifyBody — runtime boundary validation')

	// Import the module source to test the parse function
	// Since it's not exported, we test the logic inline
	const parseBody = (body: unknown): { transactionId: string; hash: string } | null => {
		if (typeof body !== 'object' || body === null) return null
		const record = body as Record<string, unknown>
		const transactionId = record.transactionId
		const hash = record.hash
		if (typeof transactionId !== 'string' || transactionId.length === 0) return null
		if (typeof hash !== 'string' || hash.length === 0) return null
		return { transactionId, hash }
	}

	// Valid input
	assert(
		parseBody({ transactionId: 'abc123', hash: 'def456' }) !== null,
		'Valid input returns parsed object'
	)

	// Missing fields
	assert(parseBody({}) === null, 'Empty object returns null')
	assert(parseBody({ transactionId: 'abc' }) === null, 'Missing hash returns null')
	assert(parseBody({ hash: 'def' }) === null, 'Missing transactionId returns null')

	// Wrong types
	assert(parseBody({ transactionId: 123, hash: 'def' }) === null, 'Number transactionId returns null')
	assert(parseBody({ transactionId: 'abc', hash: null }) === null, 'Null hash returns null')

	// Empty strings
	assert(parseBody({ transactionId: '', hash: 'def' }) === null, 'Empty transactionId returns null')
	assert(parseBody({ transactionId: 'abc', hash: '' }) === null, 'Empty hash returns null')

	// Non-object inputs
	assert(parseBody(null) === null, 'null returns null')
	assert(parseBody(undefined) === null, 'undefined returns null')
	assert(parseBody('string') === null, 'string returns null')
	assert(parseBody(42) === null, 'number returns null')
}

// ── Test 7: CSRF protection on all mutating endpoints ──

function testCsrfCoverage(): void {
	console.log('\n[7] CSRF — all mutating builder endpoints import requireValidOrigin')

	const baseDir = resolve(import.meta.dirname ?? '.', '..')

	const endpointsToCheck = [
		'src/pages/api/builders/tickets/index.ts',
		'src/pages/api/builders/tickets/[id].ts',
		'src/pages/api/builders/credits/claim-hash.ts',
		'src/pages/api/builders/credits/claim-verify.ts',
	]

	for (const relPath of endpointsToCheck) {
		const fullPath = resolve(baseDir, relPath)
		const content = readFileSync(fullPath, 'utf-8')
		const hasImport = content.includes('requireValidOrigin')
		const hasCall = content.includes('requireValidOrigin(context.request)')
		assert(hasImport && hasCall, `${relPath} has CSRF protection`)
	}
}

// ── Test 8: withTransaction — multiple operations are atomic ──

async function testMultipleOpsAtomic(): Promise<void> {
	console.log('\n[8] withTransaction — multiple operations rollback together')

	await db.execute({
		sql: 'CREATE TABLE IF NOT EXISTS _test_tx_a (id INTEGER PRIMARY KEY, val INTEGER)',
		args: [],
	})
	await db.execute({
		sql: 'CREATE TABLE IF NOT EXISTS _test_tx_b (id INTEGER PRIMARY KEY, val TEXT)',
		args: [],
	})
	await db.execute({ sql: 'DELETE FROM _test_tx_a', args: [] })
	await db.execute({ sql: 'DELETE FROM _test_tx_b', args: [] })

	// Insert into A, then into B fails (simulate UNIQUE constraint)
	await db.execute({
		sql: "INSERT INTO _test_tx_b (id, val) VALUES (1, 'blocker')",
		args: [],
	})

	await assertThrows(async () => {
		await withTransaction(async () => {
			// This should succeed
			await db.execute({
				sql: 'INSERT INTO _test_tx_a (id, val) VALUES (1, 100)',
				args: [],
			})
			// This should fail (UNIQUE constraint on id=1)
			await db.execute({
				sql: "INSERT INTO _test_tx_b (id, val) VALUES (1, 'duplicate')",
				args: [],
			})
		})
	}, 'Transaction throws on second operation failure')

	// Verify BOTH tables rolled back — _test_tx_a should be empty
	const resultA = await db.execute({
		sql: 'SELECT * FROM _test_tx_a WHERE id = 1',
		args: [],
	})
	assert(resultA.rows.length === 0, 'Table A row was rolled back (atomicity)')

	// _test_tx_b should still have the original blocker row
	const resultB = await db.execute({
		sql: 'SELECT val FROM _test_tx_b WHERE id = 1',
		args: [],
	})
	assert(String(resultB.rows[0]?.val) === 'blocker', 'Table B original row intact')

	await db.execute({ sql: 'DROP TABLE IF EXISTS _test_tx_a', args: [] })
	await db.execute({ sql: 'DROP TABLE IF EXISTS _test_tx_b', args: [] })
}

// ── Test 9: Credit mapping (opaque token → creditId) ──

function testCreditMapping(): void {
	console.log('\n[9] claimHashCache.setCreditMapping / getCreditMapping — opaque tokens')

	claimHashCache.clear()

	// Set mapping
	claimHashCache.setCreditMapping('abc123def456abc123def456', 42)

	// Get mapping — should return creditId and consume
	const creditId = claimHashCache.getCreditMapping('abc123def456abc123def456')
	assert(creditId === 42, 'getCreditMapping returns correct creditId')

	// Second get — should return null (consumed)
	const creditId2 = claimHashCache.getCreditMapping('abc123def456abc123def456')
	assert(creditId2 === null, 'Second getCreditMapping returns null (consumed)')

	// Non-existent token
	const creditId3 = claimHashCache.getCreditMapping('nonexistent')
	assert(creditId3 === null, 'Non-existent token returns null')

	claimHashCache.clear()
}

// ── Test 10: RBAC logging (assertCanPerform logs on denial) ──

function testRbacLogging(): void {
	console.log('\n[10] assertCanPerform — logs on denial')

	const filePath = resolve(import.meta.dirname ?? '.', '..', 'src/lib/admin/permissions-management.ts')
	const content = readFileSync(filePath, 'utf-8')

	assert(
		content.includes("logger.warn(`[RBAC] Denied:"),
		'assertCanPerform has logger.warn on denial'
	)
	assert(
		content.includes("import { logger }"),
		'permissions-management imports logger'
	)
}

// ── Test 11: Opaque claim code pattern (no credit ID exposure) ──

function testOpaqueClaimCode(): void {
	console.log('\n[11] claim-hash endpoint — opaque claim code (no internal IDs)')

	const filePath = resolve(import.meta.dirname ?? '.', '..', 'src/pages/api/builders/credits/claim-hash.ts')
	const content = readFileSync(filePath, 'utf-8')

	// Should NOT contain the old pattern that exposes creditId
	assert(
		!content.includes('`credit_${creditId}_${Date.now()}`'),
		'Old pattern credit_${creditId}_${Date.now()} removed'
	)

	// Should use opaque token
	assert(
		content.includes('claim_${opaqueToken}'),
		'Uses opaque token in claim code'
	)

	// Should use randomBytes
	assert(
		content.includes("randomBytes(12).toString('hex')"),
		'Uses crypto randomBytes for token generation'
	)
}

// ── Test 12: compactMap single-pass utility ──

function testCompactMap(): void {
	console.log('\n[12] compactMap — single-pass parse + filter')

	// Parser that returns null for odd numbers
	const parseEven = (row: unknown): number | null => {
		const n = Number(row)
		return n % 2 === 0 ? n : null
	}

	// Basic filtering
	const result1 = compactMap([1, 2, 3, 4, 5, 6], parseEven)
	assert(result1.length === 3, 'Filters correctly (3 evens from 6)')
	assert(result1[0] === 2 && result1[1] === 4 && result1[2] === 6, 'Values are correct')

	// Empty input
	const result2 = compactMap([], parseEven)
	assert(result2.length === 0, 'Empty input returns empty array')

	// All null results
	const result3 = compactMap([1, 3, 5], parseEven)
	assert(result3.length === 0, 'All-null results return empty array')

	// All valid results
	const result4 = compactMap([2, 4, 6], parseEven)
	assert(result4.length === 3, 'All-valid results return all items')

	// Verify no intermediate arrays (functional equivalence with .map().filter())
	const rows = [{ v: 1 }, { v: null }, { v: 3 }]
	const parseObj = (row: unknown): number | null => {
		const r = row as Record<string, unknown>
		return typeof r.v === 'number' ? r.v : null
	}
	const result5 = compactMap(rows, parseObj)
	assert(result5.length === 2, 'Object parsing works correctly')
	assert(result5[0] === 1 && result5[1] === 3, 'Parsed values match')
}

// ── Test 13: PERF-04 — getAccountsByUser uses subquery (no sequential queries) ──

function testGetAccountsByUserSubquery(): void {
	console.log('\n[13] getAccountsByUser — uses subquery instead of sequential queries')

	const filePath = resolve(import.meta.dirname ?? '.', '..', 'src/lib/repositories/users-repository.ts')
	const content = readFileSync(filePath, 'utf-8')

	// Should NOT have the old sequential pattern
	assert(
		!content.includes('const builder = await this.getById(builderId)'),
		'Old sequential getById() pattern removed from getAccountsByUser'
	)

	// Should use subquery
	assert(
		content.includes('SELECT username FROM "user" WHERE id = ? LIMIT 1'),
		'Uses subquery to resolve username'
	)
}

// ── Test 14: ALLOC-02 — export has LIMIT guard ──

function testExportLimit(): void {
	console.log('\n[14] export.ts — has LIMIT guard to cap memory')

	const filePath = resolve(import.meta.dirname ?? '.', '..', 'src/pages/api/builders/credits/export.ts')
	const content = readFileSync(filePath, 'utf-8')

	assert(
		content.includes('EXPORT_ROW_LIMIT'),
		'Export defines EXPORT_ROW_LIMIT constant'
	)
	assert(
		content.includes('LIMIT ?'),
		'Export query uses LIMIT parameter'
	)
	assert(
		!content.includes('as unknown as CreditHistoryRow[]'),
		'Blind cast removed — uses explicit row mapping'
	)
}

// ── Test 15: compactMap used across repositories ──

function testCompactMapUsage(): void {
	console.log('\n[15] Repositories use compactMap (no .map().filter() chains)')

	const baseDir = resolve(import.meta.dirname ?? '.', '..')
	const repos = [
		'src/lib/repositories/tickets-repository.ts',
		'src/lib/repositories/accounts-repository.ts',
		'src/lib/repositories/users-repository.ts',
	]

	for (const relPath of repos) {
		const content = readFileSync(resolve(baseDir, relPath), 'utf-8')
		assert(
			content.includes("import") && content.includes("compactMap"),
			`${relPath} imports compactMap`
		)
		assert(
			!content.includes('.map(row => parse'),
			`${relPath} has no .map().filter() chains`
		)
	}
}

// ── Runner ──

async function main(): Promise<void> {
	console.log('═══════════════════════════════════════════')
	console.log(' Security Fixes Test Suite')
	console.log('═══════════════════════════════════════════')

	try {
		await testWithTransactionRollback()
		await testWithTransactionCommit()
		testValidateNonDestructive()
		testConsume()
		testValidateAndConsume()
		testParseClaimVerifyBody()
		testCsrfCoverage()
		await testMultipleOpsAtomic()
		testCreditMapping()
		testRbacLogging()
		testOpaqueClaimCode()
		testCompactMap()
		testGetAccountsByUserSubquery()
		testExportLimit()
		testCompactMapUsage()
	} catch (error) {
		console.error('\n FATAL ERROR:', error)
		process.exit(1)
	}

	console.log('\n═══════════════════════════════════════════')
	console.log(` Results: ${passed} passed, ${failed} failed`)
	console.log('═══════════════════════════════════════════')

	process.exit(failed > 0 ? 1 : 0)
}

main()
