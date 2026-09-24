import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db, initializeDatabase } from '@/lib/database'

const RUN = crypto.randomUUID().replace(/-/g, '').slice(0, 10)
const TICKET = `PROC${RUN.toUpperCase()}`
const CORRELATIONS = [`proc-a-${RUN}`, `proc-b-${RUN}`] as const

interface ChildReservation {
  readonly child: ChildProcessWithoutNullStreams
  readonly ready: Promise<void>
  readonly result: Promise<{ readonly success: boolean }>
  release(): void
}

function startReservationWorker(
  correlationId: string,
  username: string
): ChildReservation {
  const child = spawn(
    process.execPath,
    [
      '--import',
      'tsx',
      resolve(process.cwd(), 'scripts/test-reservation-worker.ts'),
      TICKET,
      correlationId,
      username,
    ],
    { env: { ...process.env }, stdio: ['pipe', 'pipe', 'pipe'] }
  )

  let output = ''
  let errorOutput = ''
  let readyResolved = false
  let resultResolved = false
  let resolveReady!: () => void
  let rejectReady!: (error: Error) => void
  let rejectResult!: (error: Error) => void
  let resolveResult!: (result: { readonly success: boolean }) => void
  const ready = new Promise<void>((resolvePromise, rejectPromise) => {
    resolveReady = resolvePromise
    rejectReady = rejectPromise
    child.once('error', rejectReady)
    child.stderr.on('data', chunk => {
      errorOutput += chunk.toString()
    })
  })
  const result = new Promise<{ readonly success: boolean }>(
    (resolvePromise, reject) => {
      resolveResult = resolvePromise
      rejectResult = reject
    }
  )

  child.stdout.on('data', chunk => {
    output += chunk.toString()
    if (!readyResolved && output.includes('READY\n')) {
      readyResolved = true
      resolveReady()
    }
    const marker = 'RESULT:'
    const resultOffset = output.indexOf(marker)
    const resultLineEnd = output.indexOf('\n', resultOffset + marker.length)
    if (resultOffset >= 0 && resultLineEnd >= 0 && !resultResolved) {
      resultResolved = true
      const serialized = output.slice(
        resultOffset + marker.length,
        resultLineEnd
      )
      try {
        resolveResult(JSON.parse(serialized) as { readonly success: boolean })
      } catch {
        rejectResult(new Error(`Invalid child result: ${serialized}`))
      }
    }
  })
  child.once('exit', (code, signal) => {
    if (code !== 0) {
      const failure = new Error(
        `Reservation worker exited (${code ?? signal}): ${errorOutput || output}`
      )
      if (!readyResolved) rejectReady(failure)
      if (!resultResolved) rejectResult(failure)
    }
  })

  return {
    child,
    ready,
    result,
    release: () => {
      child.stdin.write('go\n')
      child.stdin.end()
    },
  }
}

async function cleanup(): Promise<void> {
  await db.execute({
    sql: 'DELETE FROM CreationAttemptEvents WHERE correlation_id IN (?, ?)',
    args: [...CORRELATIONS],
  })
  await db.execute({
    sql: 'DELETE FROM CreationAttempts WHERE correlation_id IN (?, ?)',
    args: [...CORRELATIONS],
  })
  await db.execute({
    sql: 'DELETE FROM Tickets WHERE code = ?',
    args: [TICKET],
  })
}

beforeAll(async () => {
  expect(await initializeDatabase()).toBe(true)
  await cleanup()
  await db.execute({
    sql: `INSERT INTO Tickets (
      code, total_uses, remaining_uses, creator_username,
      funding_source, owner_builder_username
    ) VALUES (?, 1, 1, 'process-test', 'builder_credits', 'process-test')`,
    args: [TICKET],
  })
})

afterAll(cleanup)

describe('SQLite coordination across processes', () => {
  it('lets exactly one independent process reserve the final ticket use', async () => {
    const workers = [
      startReservationWorker(CORRELATIONS[0], `proca${RUN}`),
      startReservationWorker(CORRELATIONS[1], `procb${RUN}`),
    ]
    await Promise.all(workers.map(worker => worker.ready))
    workers.forEach(worker => worker.release())
    const results = await Promise.all(workers.map(worker => worker.result))

    expect(results.filter(result => result.success)).toHaveLength(1)
    const state = await db.execute({
      sql: `SELECT remaining_uses,
                   (SELECT COUNT(*) FROM CreationAttempts
                    WHERE ticket_id = Tickets.id AND status = 'reserved') AS open_attempts
            FROM Tickets WHERE code = ?`,
      args: [TICKET],
    })
    expect(Number(state.rows[0]?.remaining_uses)).toBe(0)
    expect(Number(state.rows[0]?.open_attempts)).toBe(1)
  }, 30_000)
})
