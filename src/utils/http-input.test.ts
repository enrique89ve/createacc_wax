import { describe, expect, it } from 'vitest'
import { parseJsonObject, parsePositiveDecimalId } from '@/utils/http-input'

describe('HTTP input parsing', () => {
  it('accepts only JSON objects for ticket mutation bodies', async () => {
    await expect(
      parseJsonObject(
        new Request('http://localhost', { method: 'POST', body: '{"uses":1}' })
      )
    ).resolves.toEqual({ uses: 1 })
    for (const body of ['null', '[]', '"text"', '3', '{']) {
      await expect(
        parseJsonObject(
          new Request('http://localhost', { method: 'POST', body })
        )
      ).resolves.toBeNull()
    }
  })

  it('accepts only safe canonical positive decimal path IDs', () => {
    expect(parsePositiveDecimalId('1')).toBe(1)
    expect(parsePositiveDecimalId('9007199254740991')).toBe(
      Number.MAX_SAFE_INTEGER
    )
    for (const value of [
      '',
      '0',
      '-1',
      '1.5',
      '1e2',
      ' 1',
      '01',
      'Infinity',
      '9007199254740992',
    ]) {
      expect(parsePositiveDecimalId(value)).toBeNull()
    }
    expect(parsePositiveDecimalId(undefined)).toBeNull()
  })
})
