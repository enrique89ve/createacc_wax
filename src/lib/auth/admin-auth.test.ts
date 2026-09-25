import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db, initializeDatabase, insertAdminUser } from '@/lib/database'
import {
  appendAdminSessionCookie,
  createAdminAuthSession,
  getFreshAdminSession,
} from './admin-auth'

const username = `fresh${Date.now().toString(36).slice(-7)}`
let userId = ''
let sessionToken = ''
let cookieHeader = ''

describe('fresh admin session resolution', () => {
  beforeAll(async () => {
    expect(await initializeDatabase()).toBe(true)
    userId = await insertAdminUser({
      username,
      passwordHash: 'test-password-hash',
    })
    const session = await createAdminAuthSession({ username })
    expect(session).not.toBeNull()
    if (!session) throw new Error('Expected an admin session')
    sessionToken = session.token
    const headers = new Headers()
    await appendAdminSessionCookie(headers, session.token)
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

  it('fetches current session state while bypassing cookie cache', async () => {
    const absent = await getFreshAdminSession(
      new Request('http://localhost:4321/api/management/test')
    )
    expect(absent).toEqual({ kind: 'unauthenticated' })

    const request = new Request('http://localhost:4321/api/management/test', {
      headers: { cookie: cookieHeader },
    })
    const valid = await getFreshAdminSession(request)
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
    const expired = await getFreshAdminSession(request)
    expect(expired).toEqual({ kind: 'unauthenticated' })
  })
})
