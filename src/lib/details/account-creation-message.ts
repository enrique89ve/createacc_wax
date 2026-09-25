import {
  BLOCKCHAIN_ERROR_CODES,
  DATABASE_ERROR_CODES,
  VALIDATION_ERROR_CODES,
  type UnifiedErrorCode,
} from '@/consts/unified-errors'
import { interpolate, publicCopy } from '@/i18n'
import type { AccountCreationResult } from './account-submit'

type DetailsCopy = ReturnType<typeof publicCopy>['details']
type CreationErrorCopyKey = keyof DetailsCopy['creationErrors']

const ERROR_COPY_KEYS: Partial<Record<UnifiedErrorCode, CreationErrorCopyKey>> =
  {
    [BLOCKCHAIN_ERROR_CODES.ACCOUNT_ALREADY_EXISTS]: 'accountAlreadyExists',
    [BLOCKCHAIN_ERROR_CODES.GENERIC_HIVE_ERROR]: 'serviceUnavailable',
    [BLOCKCHAIN_ERROR_CODES.CHAIN_VERIFICATION_FAILED]: 'serviceUnavailable',
    [BLOCKCHAIN_ERROR_CODES.CHAIN_VERIFICATION_TIMEOUT]: 'serviceUnavailable',
    [DATABASE_ERROR_CODES.INTERNAL_ERROR]: 'serviceUnavailable',
    [DATABASE_ERROR_CODES.TRANSACTION_FAILED]: 'serviceUnavailable',
    [DATABASE_ERROR_CODES.QUOTA_EXCEEDED]: 'serviceUnavailable',
    [VALIDATION_ERROR_CODES.TICKET_NOT_FOUND]: 'ticketNotFound',
    [VALIDATION_ERROR_CODES.TICKET_RACE_CONDITION]: 'ticketInUse',
    [VALIDATION_ERROR_CODES.TICKET_ALREADY_USED]: 'ticketUsed',
    [VALIDATION_ERROR_CODES.ACCOUNT_CREATION_IN_PROGRESS]: 'creationInProgress',
    [VALIDATION_ERROR_CODES.USERNAME_NOT_ALLOWED]: 'usernameNotAllowed',
    [VALIDATION_ERROR_CODES.USERNAME_TOO_SIMILAR]: 'usernameTooSimilar',
    [VALIDATION_ERROR_CODES.USERNAME_POLICY_UNAVAILABLE]: 'serviceUnavailable',
    [VALIDATION_ERROR_CODES.KEYS_DOWNLOAD_NOT_CONFIRMED]: 'keysNotConfirmed',
  }

export function getAccountCreationMessage(
  result: Exclude<AccountCreationResult, { readonly status: 'created' }>,
  copy: DetailsCopy = publicCopy().details
): string {
  switch (result.status) {
    case 'pending':
      if (result.reason === 'creation_in_progress') {
        return copy.creationErrors.creationInProgress
      }
      return interpolate(copy.creationPending, {
        correlationId: result.correlationId ?? 'unavailable',
      })
    case 'unknown':
      return copy.creationOutcomeUnknown
    case 'rejected': {
      if (result.retryAfterSeconds) {
        return interpolate(copy.creationRateLimited, {
          seconds: String(result.retryAfterSeconds),
        })
      }
      if (result.errorCode) {
        const copyKey = ERROR_COPY_KEYS[result.errorCode]
        if (copyKey) {
          return copy.creationErrors[copyKey]
        }
      }
      if (result.httpStatus >= 500) {
        return copy.creationErrors.serviceUnavailable
      }
      return copy.creationErrors.generic
    }
  }
}
