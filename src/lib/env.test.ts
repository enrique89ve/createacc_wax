import { afterEach, describe, expect, it } from 'vitest'
import { ENV_KEYS } from '@/consts/constants'
import { getEnvString, getRequiredEnvString } from '@/lib/env'

const activeKeyName = ENV_KEYS.HIVE_CREATOR_ACTIVE_KEY
const originalActiveKey = process.env[activeKeyName]

afterEach(() => {
  if (originalActiveKey === undefined) {
    delete process.env[activeKeyName]
  } else {
    process.env[activeKeyName] = originalActiveKey
  }
})

describe('runtime environment access', () => {
  it('reads service secrets from process.env when called', () => {
    process.env[activeKeyName] = 'runtime-key-canary'

    expect(getEnvString(activeKeyName)).toBe('runtime-key-canary')
    expect(getRequiredEnvString(activeKeyName)).toBe('runtime-key-canary')
  })

  it('returns an empty value when a runtime secret is missing', () => {
    delete process.env[activeKeyName]

    expect(getEnvString(activeKeyName)).toBe('')
    expect(() => getRequiredEnvString(activeKeyName)).toThrow(
      `${activeKeyName} is missing or empty`
    )
  })
})
