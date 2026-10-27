import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { db, initializeDatabase, insertAdminUser } from '@/lib/database'

const username = `fresh${Date.now().toString(36).slice(-7)}`
let adminAuth: typeof import('./admin-auth')
let userId = ''
let sessionToken = ''
let cookieHeader = ''

describe('admin Better Auth sessions', () => {
  beforeAll(async () => {
    expect(await initializeDatabase()).toBe(true)
    userId = await insertAdminUser({
      username,
      passwordHash: 'test-password-hash',
    })
    // Match server startup: initialize the DB before Better Auth validates it.
    adminAuth = await import('./admin-auth')
  })

  beforeEach(async () => {
    const session = await adminAuth.createAdminAuthSession({ username })
    expect(session).not.toBeNull()
    if (!session) throw new Error('Expected an admin session')
    sessionToken = session.token
    const headers = new Headers()
    await adminAuth.appendAdminSessionCookie(headers, session.token)
    cookieHeader = headers.get('set-cookie')?.split(';', 1)[0] ?? ''
  })

  afterAll(async () => {
    if (userId) {
      await db.execute({
        sql: 'DELETE FROM "user" WHERE id = ?',
        args: [userId],
      })
    }
  })

  it('keeps the password hash out of the public session response', async () => {
    const { auth } = await import('@/lib/auth')
    const response = await auth.handler(
      new Request('http://localhost:4321/api/auth/get-session', {
        headers: { cookie: cookieHeader },
      })
    )
    expect(response.status).toBe(200)
    const payload: unknown = await response.json()
    expect(payload).toMatchObject({ user: { id: userId, username } })
    const serialized = JSON.stringify(payload)
    expect(serialized).not.toContain('passwordHash')
    expect(serialized).not.toContain('password_hash')
    expect(serialized).not.toContain('test-password-hash')
  })

  it('revokes the stored session on logout', async () => {
    const request = new Request('http://localhost:4321/api/auth/logout', {
      method: 'POST',
      headers: {
        cookie: cookieHeader,
        origin: 'http://localhost:4321',
      },
    })
    await adminAuth.signOutAdmin(request)
    expect(await adminAuth.getFreshAdminSession(request)).toEqual({
      kind: 'unauthenticated',
    })
    const remaining = await db.execute({
      sql: 'SELECT id FROM session WHERE token = ?',
      args: [sessionToken],
    })
    expect(remaining.rows).toHaveLength(0)
  })

  it('fetches current session state while bypassing cookie cache', async () => {
    const absent = await adminAuth.getFreshAdminSession(
      new Request('http://localhost:4321/api/management/test')
    )
    expect(absent).toEqual({ kind: 'unauthenticated' })

    const request = new Request('http://localhost:4321/api/management/test', {
      headers: { cookie: cookieHeader },
    })
    const valid = await adminAuth.getFreshAdminSession(request)
    expect(valid).toMatchObject({
      kind: 'authenticated',
      session: { userId, username },
    })

    await db.execute({
      sql: "UPDATE session SET expires_at = '2000-01-01 00:00:00' WHERE token = ?",
      args: [sessionToken],
    })
    const expiryResult = await db.execute({
      sql: 'SELECT expires_at FROM session WHERE token = ?',
      args: [sessionToken],
    })
    expect(String(expiryResult.rows[0]?.expires_at)).toContain('2000-01-01')
    const expired = await adminAuth.getFreshAdminSession(request)
    expect(expired).toEqual({ kind: 'unauthenticated' })
  })
})
