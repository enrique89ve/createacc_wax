import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db, initializeDatabase } from '@/lib/database'
import { createClaimIntent } from '@/lib/credits/claim-service'
import type { VerifiedHiveClaim } from '@/lib/credits/adapters/hive-claim-adapter'

const PREFIX = `credits-process-${Date.now()}`
const TSX_BIN = resolve(process.cwd(), 'node_modules/.bin/tsx')
const WORKER = resolve(process.cwd(), 'scripts/credits-claim-worker.ts')

function proof(username: string, hash: string): VerifiedHiveClaim {
  return {
    username,
    hash,
    transactionId: hash,
    operationIndex: 0,
    externalReference: `hive:claim:${hash}:0`,
  }
}

function runWorker(value: VerifiedHiveClaim): Promise<unknown> {
  return new Promise((resolveResult, reject) => {
    const environment = { ...process.env }
    delete environment.TURSO_AUTH_TOKEN
    delete environment.TURSO_SYNC_URL

    const child = spawn(TSX_BIN, [WORKER, JSON.stringify(value)], {
      cwd: process.cwd(),
      env: environment,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => {
      stdout += String(chunk)
    })
    child.stderr.on('data', chunk => {
      stderr += String(chunk)
    })
    child.on('error', reject)
    child.on('close', code => {
      if (code !== 0) {
        reject(new Error(stderr || `Worker exited with code ${code}`))
        return
      }
      try {
        resolveResult(JSON.parse(stdout))
      } catch (error) {
        reject(error)
      }
    })
  })
}

describe('cross-process credit claims', () => {
  beforeAll(async () => {
    expect(await initializeDatabase()).toBe(true)
  })

  afterAll(async () => {
    await db.execute({
      sql: 'DELETE FROM CreditClaimIntents WHERE hive_username LIKE ?',
      args: [`${PREFIX}%`],
    })
    await db.execute({
      sql: 'DELETE FROM CreditAudit WHERE hive_username LIKE ?',
      args: [`${PREFIX}%`],
    })
    await db.execute({
      sql: 'DELETE FROM Credits WHERE hive_username LIKE ?',
      args: [`${PREFIX}%`],
    })
  })

  it('lets one process claim an intent issued by another process', async () => {
    const username = `${PREFIX}-persisted`
    const hash = '6'.repeat(64)
    await db.execute({
      sql: `INSERT INTO Credits
        (hive_username, pending_amount, available_amount, total_issued, total_consumed)
        VALUES (?, 11, 0, 11, 0)`,
      args: [username],
    })
    const intent = await createClaimIntent(username, {
      hashFactory: () => hash,
      now: Date.now(),
    })
    expect(intent.ok).toBe(true)

    const result = await runWorker(proof(username, hash))
    expect(result).toMatchObject({ ok: true, credits: 11 })

    const replay = await runWorker(proof(username, hash))
    expect(replay).toMatchObject({ ok: false, code: 'intent_not_found' })

    const state = await db.execute({
      sql: `SELECT pending_amount, available_amount FROM Credits
        WHERE hive_username = ?`,
      args: [username],
    })
    expect(state.rows[0]).toMatchObject({
      pending_amount: 0,
      available_amount: 11,
    })
  })
})
