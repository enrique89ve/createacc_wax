import { describe, expect, it } from 'vitest'
import { validateRequestData } from '@/lib/create/account-creation.validator'
import { VALIDATION_ERROR_MESSAGES } from '@/consts/validation'
import { isValidationSuccess } from '@/utils/validation-result'

const PUBLIC_FIELDS = {
  username: 'alice',
  ownerPublicKey: 'STM7ownerpub',
  activePublicKey: 'STM7activepub',
  postingPublicKey: 'STM7postingpub',
  memoPublicKey: 'STM7memopub',
}

describe('validateRequestData private-key rejection', () => {
  it('rejects bodies that include private key fields without echoing secrets', () => {
    const result = validateRequestData({
      ...PUBLIC_FIELDS,
      masterPrivateKey: 'P5SHOULDNEVERBELOGGED',
    })
    expect(isValidationSuccess(result)).toBe(false)
    if (isValidationSuccess(result)) return
    expect(result.error.message).toBe(
      VALIDATION_ERROR_MESSAGES.PRIVATE_KEYS_NOT_ALLOWED
    )
    expect(JSON.stringify(result.error)).not.toContain('P5SHOULDNEVERBELOGGED')
  })
})
