import { describe, expect, it } from 'vitest'
import { resolveDatabaseConfiguration } from '@/lib/database-config'

describe('database mode selection', () => {
  it('starts standalone SQLite without Turso variables', () => {
    expect(resolveDatabaseConfiguration({})).toEqual({
      mode: 'sqlite-local',
      client: { url: 'file:holahive.db' },
    })
  })

  it('does not enable remote behavior from an unused auth token', () => {
    expect(
      resolveDatabaseConfiguration({ TURSO_AUTH_TOKEN: 'unused-token' })
    ).toEqual({
      mode: 'sqlite-local',
      client: { url: 'file:holahive.db' },
    })
  })

  it('requires credentials only when direct Turso mode is selected', () => {
    expect(() =>
      resolveDatabaseConfiguration({ DATABASE_URL: 'libsql://db.turso.io' })
    ).toThrow('TURSO_AUTH_TOKEN is required')
    expect(
      resolveDatabaseConfiguration({
        DATABASE_URL: 'libsql://db.turso.io',
        TURSO_AUTH_TOKEN: 'remote-token',
      })
    ).toMatchObject({
      mode: 'turso-remote',
      client: { url: 'libsql://db.turso.io', authToken: 'remote-token' },
    })
  })

  it('rejects embedded replica mode until writes use an authoritative primary', () => {
    expect(() =>
      resolveDatabaseConfiguration({ TURSO_SYNC_URL: 'libsql://db.turso.io' })
    ).toThrow('Embedded replica writes are disabled')
    expect(() =>
      resolveDatabaseConfiguration({
        DATABASE_URL: 'file:replica.db',
        TURSO_SYNC_URL: 'libsql://db.turso.io',
        TURSO_AUTH_TOKEN: 'replica-token',
        TURSO_SYNC_INTERVAL_MS: '45000',
      })
    ).toThrow('Embedded replica writes are disabled')
  })

  it('rejects invalid or contradictory selected modes', () => {
    expect(() =>
      resolveDatabaseConfiguration({
        DATABASE_URL: 'file:replica.db',
        TURSO_SYNC_URL: 'sqlite://not-remote',
        TURSO_AUTH_TOKEN: 'token',
      })
    ).toThrow('Embedded replica writes are disabled')
    expect(() =>
      resolveDatabaseConfiguration({
        DATABASE_URL: 'libsql://db.turso.io',
        TURSO_SYNC_URL: 'libsql://other.turso.io',
        TURSO_AUTH_TOKEN: 'token',
      })
    ).toThrow('TURSO_SYNC_URL is not supported')
  })
})
