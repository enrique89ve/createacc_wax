// Moved from lib/constants.ts to consts/constants.ts for clearer separation
// WALLET_PASSWORD moved to environment variables for security
export const BEEKEEPER_CONFIG = {
  WALLET_PREFIX: 'holahive',
  SESSION_SALT: 'holahive-beekeeper-salt-v1',
} as const

export const RC_DELEGATION_AMOUNT = '50000000000' as const

export const ERROR_MESSAGES = {
  WALLET: {
    INITIALIZATION_FAILED: 'Failed to initialize wallet',
    NO_PUBLIC_KEYS: 'No public keys found in wallet',
    PRIVATE_KEY_REQUIRED: 'Private key is required for wallet creation',
    CONFIG_REQUIRED: 'Account and private key are required',
    SESSION_CREATION_FAILED: 'Failed to create Beekeeper session',
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
  BUILDERS_LOGIN: '/builders/login',
} as const

export const SESSION_KEYS = {
  ADMIN_USER: 'adminUser',
  CREATE_FLOW: 'createFlow',
  USER: 'user',
} as const

// Re-export UserRole enum from centralized roles module
export { UserRole } from '@/lib/roles'

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
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
} as const

// Error handling configuration
export const ERROR_CONFIG = {
  MAX_RETRY_ATTEMPTS: 3,
  RETRY_DELAY_MS: 1000,
  LOG_LEVEL: 'error', // 'error' | 'warn' | 'info' | 'debug'
  ENABLE_DETAILED_LOGGING: import.meta.env.DEV,
}

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

/**
 * Configuration for creation session cookies (public account creation flow)
 * Uses signed cookies with HMAC-SHA256 for security
 */
export const CREATION_SESSION_CONFIG = {
  COOKIE_NAME: 'hh_creation_session',
  MAX_AGE_SECONDS: 1800, // 30 minutes
  SIGNATURE_ALGORITHM: 'sha256',
} as const

/**
 * Límites de créditos para operaciones administrativas
 */
export const CREDITS_LIMITS = {
  /** Máximo de créditos que se pueden asignar en una operación */
  MAX_ASSIGNMENT: 100000,
  /** Mínimo de créditos para una operación */
  MIN_ASSIGNMENT: 1,
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
  DELAY_MS: 2000,
  CACHE_CLEANUP_MS: 300000, // 5 minutes
} as const

export const RECONCILIATION_CONFIG = {
  RATE_LIMIT_DELAY_MS: 100,
} as const

export const ENV_KEYS = {
  HIVE_CREATOR_ACCOUNT: 'HIVE_CREATOR_ACCOUNT',
  HIVE_DELEGATOR_ACCOUNT: 'HIVE_DELEGATOR_ACCOUNT',
  HIVE_CREATOR_ACTIVE_KEY: 'HIVE_CREATOR_ACTIVE_KEY',
  HIVE_DELEGATOR_POSTING_KEY: 'HIVE_DELEGATOR_POSTING_KEY',
  MAINNET: 'MAINNET',
  BEEKEEPER_WALLET_PASSWORD: 'BEEKEEPER_WALLET_PASSWORD',
  SESSION_SECRET: 'SESSION_SECRET',
  TRUST_PROXY_HEADERS: 'TRUST_PROXY_HEADERS',
} as const

// Management UI - Client-side constants for admin console
export const MANAGEMENT_UI = {
  MESSAGES: {
    LOGIN_FAILED: 'Credenciales inválidas',
    CONNECTION_ERROR: 'Error de conexión',
    RATE_LIMIT_EXCEEDED:
      'Demasiados intentos fallidos. Cuenta bloqueada temporalmente por 15 minutos.',
    TICKET_CODE_REQUIRED: 'El código del ticket es requerido',
    TICKET_CREATED: 'Ticket creado exitosamente',
    TICKET_DELETED: 'Ticket eliminado',
    CREDITS_ASSIGNED: 'Créditos asignados exitosamente',
    BUILDER_DELETED: 'Builder eliminado',
    INVALID_USERNAME: 'Usuario inválido. Usa 3-20 caracteres alfanuméricos.',
    INVALID_PASSWORD: 'La contraseña debe tener al menos 8 caracteres',
    INVALID_CREDITS: 'La cantidad debe estar entre 1 y 100 créditos',
    EMPTY_FIELDS: 'Por favor ingresa usuario y contraseña',
    REMAINING_ATTEMPTS: 'Te quedan',
  },
  API_ENDPOINTS: {
    // Auth endpoints (generados por Auth.js)
    CSRF: '/api/auth/csrf',
    // Management endpoints
    TICKETS: '/api/management/tickets',
    USERS: '/api/management/users',
  },
  RATE_LIMIT: {
    MAX_ATTEMPTS: 5,
    LOCKOUT_DURATION_MS: 15 * 60 * 1000,
    ATTEMPT_WINDOW_MS: 5 * 60 * 1000,
    STORAGE_KEY: 'login_attempts',
  },
  CSS_CLASSES: {
    HIDDEN: 'hidden',
    FLEX: 'flex',
  },
  DELAYS: {
    REDIRECT_MS: 100,
  },
} as const

// Builders UI - Client-side constants for builders portal
export enum TicketAction {
  Update = 'update',
  Delete = 'delete',
}

export const BUILDERS_UI = {
  MESSAGES: {
    TICKET_CREATED: 'Ticket creado exitosamente',
    TICKET_DELETED: 'Ticket eliminado',
    CREDITS_UPDATED: 'Créditos actualizados',
    INVALID_DELTA: 'Delta inválido',
    NETWORK_ERROR: 'Error de red',
    CODE_AVAILABLE: '✓ Código disponible',
    CODE_UNAVAILABLE: 'Código no disponible',
    CHECKING_AVAILABILITY: 'Verificando disponibilidad...',
    TICKET_NAME_REQUIRED: 'El nombre del ticket es requerido',
    ONLY_NUMBERS: 'No puede ser solo números',
    CREDITS_RANGE: 'Los créditos deben estar entre 1 y 100',
    CONFIRM_DELETE:
      '¿Eliminar ticket? Esta acción devolverá créditos originales.',
    MIN_LENGTH_ERROR: 'El nombre debe tener al menos',
    MAX_LENGTH_ERROR: 'El nombre no puede exceder',
    INSUFFICIENT_CREDITS: 'No tienes suficientes créditos disponibles',
    DELTA_REQUIRED: 'El delta de créditos es requerido',
    DELTA_ZERO: 'El delta no puede ser cero',
    MIN_CREDIT_REMAINING: 'Debe quedar al menos 1 crédito en el ticket',
    INVALID_NEW_CREDITS: 'Los nuevos créditos deben estar entre 1 y 100',
  },
  API_ENDPOINTS: {
    // Nuevas rutas builders (organizadas por recurso)
    TICKETS: '/api/builders/tickets',
    TICKETS_CHECK: '/api/builders/tickets/check-code',
    TICKETS_BY_ID: '/api/builders/tickets', // Base para PATCH/DELETE con /:id
    CREDITS_BALANCE: '/api/builders/credits/balance',
    CREDITS_CLAIM_HASH: '/api/builders/credits/claim-hash',
    CREDITS_CLAIM_VERIFY: '/api/builders/credits/claim-verify',
    CREDITS_EXPORT: '/api/builders/credits/export',
    ACCOUNTS: '/api/builders/accounts',
  },
  TICKET_VALIDATION: {
    MIN_LENGTH: 4,
    MAX_LENGTH: 16,
    ALPHANUMERIC_REGEX: /^[a-zA-Z0-9]+$/,
    ONLY_NUMBERS_REGEX: /^\d+$/,
  },
  DEBOUNCE_DELAY_MS: 500,
} as const

export const MAX_TICKET_CREDITS = 100 as const
