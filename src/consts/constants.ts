// Moved from lib/constants.ts to consts/constants.ts for clearer separation
export const BEEKEEPER_CONFIG = {
  WALLET_NAME: 'holahive-creator',
  WALLET_PASSWORD: 'holahive-secure-password-2024',
  SESSION_PREFIX: 'holahive-session',
} as const

export const RC_DELEGATION_AMOUNT = '50000000000' as const

export const ERROR_MESSAGES = {
  WALLET: {
    INITIALIZATION_FAILED: 'Failed to initialize wallet',
    NO_PUBLIC_KEYS: 'No public keys found in wallet',
    PRIVATE_KEY_REQUIRED: 'Private key is required for wallet creation',
    CONFIG_REQUIRED: 'Account and private key are required',
  },
  DELEGATION: {
    SELF_DELEGATION: 'Cannot delegate RC to yourself',
    SELF_REMOVAL: 'Cannot remove RC delegation from yourself',
  },
} as const

export const ROUTES = {
  LOGIN: '/management/access',
  CONSOLE: '/management/console',
  MANAGEMENT: '/management/',
  API_LOGIN: '/api/auth/login',
  API_LOGOUT: '/api/auth/logout',
} as const

export const SESSION_KEYS = {
  ADMIN_USER: 'adminUser',
  CREATE_FLOW: 'createFlow',
  USER: 'user',
} as const

/**
 * @deprecated USER_ROLES is deprecated for backward compatibility only.
 * New code should use separate Admin and Builder types.
 * See: src/lib/admin/auth/helpers/auth-guards.ts
 */
export const USER_ROLES = ['admin', 'builder'] as const

/**
 * @deprecated UserRole type for backward compatibility only.
 * New code should use AdminSession or BuilderSession types.
 */
export type UserRole = (typeof USER_ROLES)[number]

export const TICKET_TYPES = {
  REGULAR: 'regular',
  ADMIN: 'admin',
} as const

export const TICKET_TYPE_LIST = [
  TICKET_TYPES.REGULAR,
  TICKET_TYPES.ADMIN,
] as const

export type TicketType = (typeof TICKET_TYPE_LIST)[number]

export const AUTH_PROVIDERS = {
  CREDENTIALS: 'credentials',
  KEYCHAIN: 'keychain',
} as const

export type AuthProvider = (typeof AUTH_PROVIDERS)[keyof typeof AUTH_PROVIDERS]

export const HTTP_STATUS = {
  OK: 200,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INTERNAL_SERVER_ERROR: 500,
} as const

// Error handling configuration
export const ERROR_CONFIG = {
  MAX_RETRY_ATTEMPTS: 3,
  RETRY_DELAY_MS: 1000,
  LOG_LEVEL: 'error', // 'error' | 'warn' | 'info' | 'debug'
  ENABLE_DETAILED_LOGGING: true,
} as const

// Wax-specific error patterns
export const WAX_ERROR_PATTERNS = {
  RETRYABLE_PATTERNS: [
    'network',
    'timeout',
    'connection',
    'fetch',
    'temporary failure',
  ],
  BUSINESS_ERRORS: [
    'account.*not.*exist',
    'account.*already.*exist',
    'insufficient.*rc',
    'delegation.*exist',
  ],
} as const

export const SESSION_CONFIG = {
  TTL: 86400, // 24 hours in seconds
  COOKIE_NAME: 'holahive-session',
} as const

export const AUTH_CONFIG = {
  MAX_LOGIN_ATTEMPTS: 5,
  RATE_LIMIT_WINDOW: 60000, // 1 minute
  SESSION_TIMEOUT: 86400000, // 24 hours in milliseconds
} as const

export const FRONTEND_KEYS = {
  SESSION_KEY: 'hh_keys_downloaded',
  KEYSET_SEPARATOR: '_',
  HIVE_PUBLIC_KEY_PREFIX: 'STM',
  MIN_KEY_LENGTH: 50,
} as const

export const API_MESSAGES = {
  SUCCESS: {
    KEYS_CONFIRMED: 'Keys download confirmed successfully',
    SESSION_CREATED: 'Creation session initialized',
    ACCOUNT_CREATED: 'Account created successfully',
  },
  ERROR: {
    NO_SESSION: 'no creation session',
    MISSING_KEYS: 'missing public keys',
    INVALID_KEY_FORMAT: 'invalid public key format',
    INTERNAL_ERROR: 'internal error',
    MISSING_USERNAME: 'username is required',
  },
} as const

export const FILE_CONFIG = {
  FILENAME_TEMPLATE: 'hive-keys-{username}.txt',
  CONTENT_TYPE: 'text/plain',
  HEADER_TEMPLATE: 'HIVE ACCOUNT KEYS - {USERNAME}',
  FOOTER_TEXT: 'Generated with HolaHive - https://holahive.io',
} as const

export const BLOCKCHAIN_VERIFICATION_CONFIG = {
  INITIAL_DELAY_MS: 500,
  MAX_DELAY_MS: 2000,
  MAX_ATTEMPTS: 6,
  BACKOFF_MULTIPLIER: 2,
  TIMEOUT_MS: 10000,
} as const

export const RC_DELEGATION_CONFIG = {
  DELAY_MS: 1000,
  CACHE_CLEANUP_MS: 300000, // 5 minutes
} as const

export const RECONCILIATION_CONFIG = {
  RATE_LIMIT_DELAY_MS: 100,
} as const

export const ENV_KEYS = {
  HIVE_CREATOR_ACCOUNT: 'HIVE_CREATOR_ACCOUNT',
  HIVE_DELEGATOR_ACCOUNT: 'HIVE_DELEGATOR_ACCOUNT',
  HIVE_CREATOR_ACTIVE_KEY: 'HIVE_CREATOR_ACTIVE_KEY',
  HIVE_DELEGATOR_ACTIVE_KEY: 'HIVE_DELEGATOR_ACTIVE_KEY',
  MAINNET: 'MAINNET',
} as const
