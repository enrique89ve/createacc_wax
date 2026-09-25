import { describe, expect, it } from 'vitest'
import { getMessages } from '@/i18n/messages'
import { getAccountCreationMessage } from '@/lib/details/account-creation-message'

describe('getAccountCreationMessage', () => {
  const copy = getMessages('es').details

  it('maps ticket-not-found to the localized reason and hides backend text', () => {
    const message = getAccountCreationMessage(
      {
        status: 'rejected',
        httpStatus: 400,
        errorCode: 'TICKET_NOT_FOUND',
      },
      copy
    )

    expect(message).toBe(copy.creationErrors.ticketNotFound)
    expect(message).toContain('no existe')
  })

  it('keeps reconciliation separate from definitive failure', () => {
    expect(
      getAccountCreationMessage(
        {
          status: 'pending',
          reason: 'reconciliation',
          correlationId: 'attempt-7',
        },
        copy
      )
    ).toContain('attempt-7')
    expect(getAccountCreationMessage({ status: 'unknown' }, copy)).toContain(
      'Se interrumpió la conexión'
    )
  })
})
