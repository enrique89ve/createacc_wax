/**
 * HTTP E2E flow against running dev server (simulate mode).
 * Measures per-step latency to find bottlenecks.
 *
 * Usage: BASE_URL=http://127.0.0.1:4322 tsx scripts/test-e2e-http-flow.ts
 */
import './test-setup-env.ts'
import { createHash } from 'node:crypto'
import { DIFFICULTY } from '@/consts/pow'
import { HiveKeys } from '@/lib/create/get-keys'

const BASE_URL = process.env.BASE_URL ?? 'http://127.0.0.1:4322'
const TICKET = process.env.E2E_TICKET ?? 'DEMO-TICKET'

interface TimedStep {
  readonly name: string
  readonly ms: number
  readonly ok: boolean
  readonly detail?: string
}

const steps: TimedStep[] = []

function hasLeadingZeroBits(hash: Buffer, bits: number): boolean {
  const fullBytes = Math.floor(bits / 8)
  const remainderBits = bits % 8
  for (let i = 0; i < fullBytes; i++) {
    if (hash[i] !== 0) return false
  }
  if (remainderBits > 0) {
    const mask = 0xff << (8 - remainderBits)
    if ((hash[fullBytes]! & mask) !== 0) return false
  }
  return true
}

function solvePow(prefix: string): string {
  for (let nonce = 0; nonce < 10_000_000; nonce++) {
    const hash = createHash('sha256')
      .update(prefix + String(nonce))
      .digest()
    if (hasLeadingZeroBits(hash, DIFFICULTY)) return String(nonce)
  }
  throw new Error('PoW not solved')
}

async function timed<T>(
  name: string,
  fn: () => Promise<T>
): Promise<T> {
  const start = performance.now()
  try {
    const result = await fn()
    steps.push({ name, ms: performance.now() - start, ok: true })
    return result
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    steps.push({ name, ms: performance.now() - start, ok: false, detail })
    throw error
  }
}

class CookieJar {
  private cookies = new Map<string, string>()

  ingest(response: Response): void {
    const raw = response.headers.getSetCookie?.() ?? []
    for (const line of raw) {
      const part = line.split(';')[0]?.trim()
      if (!part) continue
      const eq = part.indexOf('=')
      if (eq <= 0) continue
      this.cookies.set(part.slice(0, eq), part.slice(eq + 1))
    }
  }

  header(): string {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ')
  }
}

async function fetchJson(
  jar: CookieJar,
  path: string,
  init?: RequestInit
): Promise<{ res: Response; data: unknown }> {
  const headers = new Headers(init?.headers)
  const cookie = jar.header()
  if (cookie) headers.set('Cookie', cookie)
  const res = await fetch(`${BASE_URL}${path}`, { ...init, headers })
  jar.ingest(res)
  const data = await res.json().catch(() => null)
  return { res, data }
}

async function getPow(jar: CookieJar): Promise<{
  challengeId: string
  nonce: string
}> {
  const { res, data } = await fetchJson(jar, '/api/pow/challenge')
  if (!res.ok) throw new Error(`challenge ${res.status}`)
  const challenge = data as {
    challengeId: string
    prefix: string
  }
  const nonce = await timed('pow.solve', async () =>
    Promise.resolve(solvePow(challenge.prefix))
  )
  return { challengeId: challenge.challengeId, nonce }
}

async function getTiming(jar: CookieJar): Promise<string> {
  const { res, data } = await fetchJson(jar, '/api/pow/timing')
  if (!res.ok) throw new Error(`timing ${res.status}`)
  const id = (data as { timingTokenId?: string }).timingTokenId
  if (!id) throw new Error('missing timingTokenId')
  return id
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

async function main(): Promise<void> {
  const jar = new CookieJar()
  const suffix = crypto.randomUUID().replace(/-/g, '').slice(0, 8)
  const username = `hhe2e${suffix}`

  console.log(`E2E HTTP flow → ${BASE_URL} (simulate)`)
  console.log(`Username: ${username} | Ticket: ${TICKET}\n`)

  await timed('01.home', async () => {
    const res = await fetch(`${BASE_URL}/`)
    if (!res.ok) throw new Error(String(res.status))
  })

  const flowTiming = await timed('02.timing.token.flow', () => getTiming(jar))
  await timed('03.wait.flow.5s', () => sleep(5100))

  const sessionPow = await timed('04.pow.fetch.session', () => getPow(jar))
  await timed('05.create.session', async () => {
    const { res, data } = await fetchJson(jar, '/api/create/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username,
        ticket: TICKET,
        pow: sessionPow,
        timingTokenId: flowTiming,
      }),
    })
    if (!res.ok) throw new Error(JSON.stringify(data))
  })

  await timed('06.details.page', async () => {
    const res = await fetch(`${BASE_URL}/details/${username}`, {
      headers: { Cookie: jar.header() },
    })
    if (!res.ok) throw new Error(String(res.status))
    jar.ingest(res)
  })

  const keys = await timed('07.hivekeys.generate', () => HiveKeys.generate(username))
  const publicKeys = keys.publicKeys()

  await timed('08.keys-hash', async () => {
    const { res, data } = await fetchJson(jar, '/api/create/keys-hash', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(publicKeys),
    })
    if (!res.ok) throw new Error(JSON.stringify(data))
  })

  const accountTiming = await timed('09.timing.token.account', () => getTiming(jar))
  await timed('10.wait.account.1.1s', () => sleep(1100))
  const accountPow = await timed('11.pow.fetch.account', () => getPow(jar))

  let txId = ''
  await timed('12.create.account', async () => {
    const { res, data } = await fetchJson(jar, '/api/create/account', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username,
        ...publicKeys,
        pow: accountPow,
        timingTokenId: accountTiming,
      }),
    })
    if (!res.ok) throw new Error(JSON.stringify(data))
    txId = (data as { transactionId?: string }).transactionId ?? ''
  })

  await timed('13.success.page', async () => {
    const res = await fetch(`${BASE_URL}/success/${username}`, {
      headers: { Cookie: jar.header() },
    })
    if (!res.ok) throw new Error(String(res.status))
  })

  console.log('✅ E2E HTTP FLOW PASSED')
  console.log(`   txId: ${txId || '(simulate)'}\n`)

  const total = steps.reduce((s, x) => s + x.ms, 0)
  const sorted = [...steps].sort((a, b) => b.ms - a.ms)
  console.log('Timing breakdown (slowest first):')
  console.log('─'.repeat(56))
  for (const s of sorted) {
    const pct = ((s.ms / total) * 100).toFixed(1)
    const flag = s.ok ? ' ' : '!'
    console.log(
      `${flag} ${s.name.padEnd(28)} ${s.ms.toFixed(0).padStart(6)}ms  (${pct}%)${s.detail ? ` — ${s.detail}` : ''}`
    )
  }
  console.log('─'.repeat(56))
  console.log(`  TOTAL${' '.repeat(23)} ${total.toFixed(0).padStart(6)}ms`)

  const artificialWait =
    (steps.find(s => s.name === '03.wait.ticket.3s')?.ms ?? 0) +
    (steps.find(s => s.name === '07.wait.session.5s')?.ms ?? 0) +
    (steps.find(s => s.name === '10.wait.account.1.1s')?.ms ?? 0)
  const powTotal = steps
    .filter(s => s.name.startsWith('pow.'))
    .reduce((s, x) => s + x.ms, 0)
  console.log(`\nBottleneck summary:`)
  console.log(`  Artificial timing waits: ~${artificialWait.toFixed(0)}ms (${((artificialWait / total) * 100).toFixed(0)}%)`)
  console.log(`  PoW solves (2×):           ~${powTotal.toFixed(0)}ms (${((powTotal / total) * 100).toFixed(0)}%)`)
}

main().catch(err => {
  console.error('\n❌ E2E FAILED:', err instanceof Error ? err.message : err)
  console.log('\nPartial timing:')
  for (const s of steps) {
    console.log(`  ${s.ok ? '✓' : '✗'} ${s.name}: ${s.ms.toFixed(0)}ms${s.detail ? ` — ${s.detail}` : ''}`)
  }
  process.exit(1)
})
