import { describe, expect, it } from 'vitest'
import { isUniqueConstraintViolation } from '@/lib/database-errors'

describe('database error classification', () => {
  it('maps unique and primary key conflicts without exposing SQL details', () => {
    expect(
      isUniqueConstraintViolation({ code: 'SQLITE_CONSTRAINT_UNIQUE' })
    ).toBe(true)
    expect(isUniqueConstraintViolation({ rawCode: 1555 })).toBe(true)
    expect(isUniqueConstraintViolation(new Error('internal failure'))).toBe(
      false
    )
  })
})
