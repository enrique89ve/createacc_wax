export const USERNAME_CONSTRAINTS = {
  MIN_LENGTH: 3,
  MAX_LENGTH: 16,
} as const

export const TICKET_VALIDATION_ERROR_CODES = {
  INVALID_CODE: 'invalidCode',
  NOT_FOUND: 'notFound',
  INVALID_RECORD: 'invalidRecord',
  TEMPORARILY_UNAVAILABLE: 'temporarilyUnavailable',
  INACTIVE: 'inactive',
  NO_USES: 'noUses',
  INTERNAL_ERROR: 'internalError',
} as const

export type TicketValidationErrorCode =
  (typeof TICKET_VALIDATION_ERROR_CODES)[keyof typeof TICKET_VALIDATION_ERROR_CODES]

export const VALIDATION_ERROR_MESSAGES = {
  USERNAME_REQUIRED: 'username required',
  INTERNAL_ERROR: 'internal error',
  MISSING_REQUIRED_FIELDS: 'Missing required fields',
  MISSING_REQUIRED_FIELDS_DETAILED:
    'Missing required fields: username, ownerPublicKey, activePublicKey, postingPublicKey, memoPublicKey',
  INVALID_USERNAME_FORMAT: 'Invalid username format',
  USERNAME_NOT_ALLOWED: 'Username not allowed',
  USERNAME_NOT_ALLOWED_DETAILS:
    'This username contains prohibited content or patterns',
  KEYS_DOWNLOAD_NOT_CONFIRMED: 'Keys download not confirmed',
  KEYS_DOWNLOAD_NOT_CONFIRMED_DETAILED: 'keys download not confirmed',
  ACCOUNT_ALREADY_CREATED_SESSION:
    'already created in this session (idempotent)',
  ACCOUNT_ALREADY_EXISTS: 'already exists (idempotent)',
  TICKET_ALREADY_USED: 'Ticket already used',
  ERROR_CHECKING_IDEMPOTENCY: 'Error checking idempotency',
  UNHANDLED_INTERNAL_ERROR: 'Unhandled internal error',
  FAILED_TO_CREATE_ACCOUNT: 'Failed to create account',
  DB_OPERATIONS_FAILED:
    'Database operations failed after successful account creation',
  TICKET_ALREADY_IN_USE: 'Ticket already in use',
  TICKET_RACE_CONDITION: 'Another request is using this ticket simultaneously',
  ACCOUNT_CREATION_SUCCESS: 'created and verified successfully',
  USERNAME_HIVE_STANDARDS: 'Username does not meet Hive naming standards',
  INVALID_PUBLIC_KEY_FORMAT: 'Invalid public key format',
  PRIVATE_KEYS_NOT_ALLOWED: 'Request must contain public keys only',
  INVALID_PUBLIC_KEYS_MULTIPLE: 'One or more public keys have invalid format',
  USERNAME_SESSION_MISMATCH: 'Username does not match the current session',
  TICKET_REQUIRED: 'A valid ticket is required to create an account',
  TICKET_INVALID: 'The provided ticket is not valid',
  TICKET_EXHAUSTED: 'The provided ticket has no remaining uses',
  TICKET_RESERVATION_FAILED: 'Failed to reserve ticket credit',
  ACCOUNT_EXISTS_ON_CHAIN:
    'This username is already taken on the Hive blockchain',
} as const
