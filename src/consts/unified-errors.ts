/**
 * SISTEMA UNIFICADO DE ERROR CODES
 * 
 * Consolida todos los códigos de error en un sistema jerárquico
 * con separación clara por dominio pero tipos unificados.
 */

// ===== BLOCKCHAIN ERRORS =====
// Errores específicos de operaciones Hive/Wax
export const BLOCKCHAIN_ERROR_CODES = {
	// Resource Credits
	RC_DELEGATION_EXISTS: 'RC_DELEGATION_EXISTS',
	INSUFFICIENT_RC: 'INSUFFICIENT_RC',
	SELF_DELEGATION: 'SELF_DELEGATION',
	SELF_REMOVAL: 'SELF_REMOVAL',
	
	// Account Operations
	ACCOUNT_NOT_EXISTS: 'ACCOUNT_NOT_EXISTS',
	ACCOUNT_ALREADY_EXISTS: 'ACCOUNT_ALREADY_EXISTS',
	
	// Wallet/Keys
	MISSING_WALLET_CONFIG: 'MISSING_WALLET_CONFIG',
	
	// Generic Blockchain
	GENERIC_HIVE_ERROR: 'GENERIC_HIVE_ERROR',
	CHAIN_VERIFICATION_FAILED: 'CHAIN_VERIFICATION_FAILED',
	CHAIN_VERIFICATION_TIMEOUT: 'CHAIN_VERIFICATION_TIMEOUT',
} as const

export type BlockchainErrorCode = typeof BLOCKCHAIN_ERROR_CODES[keyof typeof BLOCKCHAIN_ERROR_CODES]

// ===== DATABASE ERRORS =====
// Errores de operaciones de base de datos
export const DATABASE_ERROR_CODES = {
	CONSTRAINT_VIOLATION: 'CONSTRAINT_VIOLATION',
	NOT_FOUND: 'NOT_FOUND',
	INVALID_INPUT: 'INVALID_INPUT',
	TRANSACTION_FAILED: 'TRANSACTION_FAILED',
	PERMISSION_DENIED: 'PERMISSION_DENIED',
	QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
	RACE_CONDITION: 'RACE_CONDITION',
	INTERNAL_ERROR: 'INTERNAL_ERROR'
} as const

export type DatabaseErrorCode = typeof DATABASE_ERROR_CODES[keyof typeof DATABASE_ERROR_CODES]

// ===== VALIDATION ERRORS =====
// Errores de validaciones de negocio específicas
export const VALIDATION_ERROR_CODES = {
	// Ticket Operations
	TICKET_NOT_FOUND: 'TICKET_NOT_FOUND',
	TICKET_RACE_CONDITION: 'TICKET_RACE_CONDITION',
	TICKET_ALREADY_USED: 'TICKET_ALREADY_USED',
	
	// Request Validation
	MISSING_REQUIRED_FIELDS: 'MISSING_REQUIRED_FIELDS',
	INVALID_USERNAME_FORMAT: 'INVALID_USERNAME_FORMAT',
	INVALID_PUBLIC_KEY_FORMAT: 'INVALID_PUBLIC_KEY_FORMAT',
	KEYS_DOWNLOAD_NOT_CONFIRMED: 'KEYS_DOWNLOAD_NOT_CONFIRMED',
	
	// Business Logic
	IDEMPOTENCY_CHECK_FAILED: 'IDEMPOTENCY_CHECK_FAILED',
} as const

export type ValidationErrorCode = typeof VALIDATION_ERROR_CODES[keyof typeof VALIDATION_ERROR_CODES]

// ===== UNIFIED ERROR SYSTEM =====
// Union type de todos los códigos para type safety completa
export type UnifiedErrorCode = 
	| BlockchainErrorCode 
	| DatabaseErrorCode 
	| ValidationErrorCode

// Mapeo consolidado para retrocompatibilidad
export const ALL_ERROR_CODES = {
	...BLOCKCHAIN_ERROR_CODES,
	...DATABASE_ERROR_CODES,
	...VALIDATION_ERROR_CODES,
} as const

// ===== ERROR MESSAGES =====
// Mensajes centralizados por dominio
export const BLOCKCHAIN_ERROR_MESSAGES: Record<BlockchainErrorCode, string> = {
	[BLOCKCHAIN_ERROR_CODES.RC_DELEGATION_EXISTS]: 
		'A delegation to that user with the same amount of RC already exists',
	[BLOCKCHAIN_ERROR_CODES.ACCOUNT_NOT_EXISTS]: 
		'Account does not exist',
	[BLOCKCHAIN_ERROR_CODES.ACCOUNT_ALREADY_EXISTS]: 
		'Account already exists',
	[BLOCKCHAIN_ERROR_CODES.INSUFFICIENT_RC]: 
		'Insufficient resource credits',
	[BLOCKCHAIN_ERROR_CODES.GENERIC_HIVE_ERROR]: 
		'Hive generic error',
	[BLOCKCHAIN_ERROR_CODES.MISSING_WALLET_CONFIG]: 
		'Account and private key are required',
	[BLOCKCHAIN_ERROR_CODES.SELF_DELEGATION]: 
		'Cannot delegate RC to yourself',
	[BLOCKCHAIN_ERROR_CODES.SELF_REMOVAL]: 
		'Cannot remove RC delegation from yourself',
	[BLOCKCHAIN_ERROR_CODES.CHAIN_VERIFICATION_FAILED]: 
		'Blockchain verification failed',
	[BLOCKCHAIN_ERROR_CODES.CHAIN_VERIFICATION_TIMEOUT]: 
		'Blockchain verification timeout',
}

const DATABASE_ERROR_MESSAGES: Record<DatabaseErrorCode, string> = {
	[DATABASE_ERROR_CODES.CONSTRAINT_VIOLATION]: 'Database constraint violation',
	[DATABASE_ERROR_CODES.NOT_FOUND]: 'Record not found',
	[DATABASE_ERROR_CODES.INVALID_INPUT]: 'Invalid input data',
	[DATABASE_ERROR_CODES.TRANSACTION_FAILED]: 'Database transaction failed',
	[DATABASE_ERROR_CODES.PERMISSION_DENIED]: 'Permission denied',
	[DATABASE_ERROR_CODES.QUOTA_EXCEEDED]: 'Quota exceeded',
	[DATABASE_ERROR_CODES.RACE_CONDITION]: 'Database race condition',
	[DATABASE_ERROR_CODES.INTERNAL_ERROR]: 'Internal database error',
}

export const VALIDATION_ERROR_MESSAGES: Record<ValidationErrorCode, string> = {
	[VALIDATION_ERROR_CODES.TICKET_NOT_FOUND]: 'Ticket not found',
	[VALIDATION_ERROR_CODES.TICKET_RACE_CONDITION]: 'Ticket operation race condition',
	[VALIDATION_ERROR_CODES.TICKET_ALREADY_USED]: 'Ticket already used',
	[VALIDATION_ERROR_CODES.MISSING_REQUIRED_FIELDS]: 'Missing required fields',
	[VALIDATION_ERROR_CODES.INVALID_USERNAME_FORMAT]: 'Invalid username format',
	[VALIDATION_ERROR_CODES.INVALID_PUBLIC_KEY_FORMAT]: 'Invalid public key format',
	[VALIDATION_ERROR_CODES.KEYS_DOWNLOAD_NOT_CONFIRMED]: 'Keys download not confirmed',
	[VALIDATION_ERROR_CODES.IDEMPOTENCY_CHECK_FAILED]: 'Idempotency check failed',
}

// Mensajes unificados para lookup fácil
export const UNIFIED_ERROR_MESSAGES: Record<UnifiedErrorCode, string> = {
	...BLOCKCHAIN_ERROR_MESSAGES,
	...DATABASE_ERROR_MESSAGES,
	...VALIDATION_ERROR_MESSAGES,
}

// ===== HTTP STATUS MAPPING =====
// Mapeo unificado de códigos de error a HTTP status
export const ERROR_TO_HTTP_STATUS: Record<UnifiedErrorCode, number> = {
	// Blockchain Errors
	[BLOCKCHAIN_ERROR_CODES.RC_DELEGATION_EXISTS]: 409,
	[BLOCKCHAIN_ERROR_CODES.ACCOUNT_NOT_EXISTS]: 404,
	[BLOCKCHAIN_ERROR_CODES.ACCOUNT_ALREADY_EXISTS]: 409,
	[BLOCKCHAIN_ERROR_CODES.INSUFFICIENT_RC]: 402,
	[BLOCKCHAIN_ERROR_CODES.GENERIC_HIVE_ERROR]: 500,
	[BLOCKCHAIN_ERROR_CODES.MISSING_WALLET_CONFIG]: 400,
	[BLOCKCHAIN_ERROR_CODES.SELF_DELEGATION]: 400,
	[BLOCKCHAIN_ERROR_CODES.SELF_REMOVAL]: 400,
	[BLOCKCHAIN_ERROR_CODES.CHAIN_VERIFICATION_FAILED]: 500,
	[BLOCKCHAIN_ERROR_CODES.CHAIN_VERIFICATION_TIMEOUT]: 408,
	
	// Database Errors
	[DATABASE_ERROR_CODES.CONSTRAINT_VIOLATION]: 409,
	[DATABASE_ERROR_CODES.NOT_FOUND]: 404,
	[DATABASE_ERROR_CODES.INVALID_INPUT]: 400,
	[DATABASE_ERROR_CODES.TRANSACTION_FAILED]: 500,
	[DATABASE_ERROR_CODES.PERMISSION_DENIED]: 403,
	[DATABASE_ERROR_CODES.QUOTA_EXCEEDED]: 429,
	[DATABASE_ERROR_CODES.RACE_CONDITION]: 409,
	[DATABASE_ERROR_CODES.INTERNAL_ERROR]: 500,
	
	// Validation Errors
	[VALIDATION_ERROR_CODES.TICKET_NOT_FOUND]: 404,
	[VALIDATION_ERROR_CODES.TICKET_RACE_CONDITION]: 409,
	[VALIDATION_ERROR_CODES.TICKET_ALREADY_USED]: 409,
	[VALIDATION_ERROR_CODES.MISSING_REQUIRED_FIELDS]: 400,
	[VALIDATION_ERROR_CODES.INVALID_USERNAME_FORMAT]: 400,
	[VALIDATION_ERROR_CODES.INVALID_PUBLIC_KEY_FORMAT]: 400,
	[VALIDATION_ERROR_CODES.KEYS_DOWNLOAD_NOT_CONFIRMED]: 400,
	[VALIDATION_ERROR_CODES.IDEMPOTENCY_CHECK_FAILED]: 409,
}

// ===== UNIFIED ERROR CLASS =====
// Clase de error unificada que mantiene compatibilidad
export class UnifiedError extends Error {
	constructor(
		public readonly code: UnifiedErrorCode,
		message?: string,
		public readonly cause?: Error,
		public readonly domain?: 'blockchain' | 'database' | 'validation'
	) {
		super(message || UNIFIED_ERROR_MESSAGES[code])
		this.name = 'UnifiedError'
		
		// Auto-detectar dominio si no se especifica
		if (!domain) {
			if (code in BLOCKCHAIN_ERROR_CODES) this.domain = 'blockchain'
			else if (code in DATABASE_ERROR_CODES) this.domain = 'database'  
			else if (code in VALIDATION_ERROR_CODES) this.domain = 'validation'
		}
	}
}

// ===== HELPER FUNCTIONS =====
export function getErrorMessage(code: UnifiedErrorCode): string {
	return UNIFIED_ERROR_MESSAGES[code]
}

export function getHttpStatus(code: UnifiedErrorCode): number {
	return ERROR_TO_HTTP_STATUS[code] || 500
}

