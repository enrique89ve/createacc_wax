/**
 * LEGACY AppError - Migrado al Sistema Unificado
 * Mantiene compatibilidad hacia atrás mientras migra al nuevo sistema.
 */

import {
  BLOCKCHAIN_ERROR_CODES,
  UnifiedError,
  type BlockchainErrorCode
} from './unified-errors'

// Re-exportar códigos blockchain como AppErrorCode para compatibilidad
export const AppErrorCode = BLOCKCHAIN_ERROR_CODES
export type AppErrorCode = BlockchainErrorCode

// Clase AppError que extiende UnifiedError para mantener compatibilidad
export class AppError extends UnifiedError {
  constructor(
    public readonly code: AppErrorCode,
    message?: string,
    public readonly cause?: Error
  ) {
    super(code, message, cause, 'blockchain')
    this.name = 'AppError'
  }
}

