import {
  createHiveChain,
  HealthChecker,
  WaxError,
  WaxChainApiError,
  WaxRequestError,
  WaxRequestTimeoutError,
  WaxRequestAbortedByUser,
} from '@hiveio/wax'
import type {
  IHiveChainInterface,
  TScoredEndpoint,
  GetDynamicGlobalPropertiesResponse,
} from '@hiveio/wax'
import { getBooleanEnv } from '@/lib/env'

/**
 * Sistema de failover híbrido "try-default-first + smart-backup"
 * - Siempre intenta API default primero
 * - Si falla, usa HealthChecker para elegir el mejor backup
 * - Próxima petición vuelve a intentar default
 */

// Configuración de endpoints
const MAINNET_DEFAULT = 'https://api.hive.blog'
const MAINNET_BACKUPS = [
  'https://api.openhive.network',
  'https://techcoderx.com',
  'https://rpc.mahdiyari.info',
] as const

const TESTNET_API = 'https://api.fake.openhive.network'
const TESTNET_CHAIN_ID =
  '4200000000000000000000000000000000000000000000000000000000000000'

// Constantes para HealthChecker
const HEALTH_CHECK_TIMEOUT = 5000
const EVALUATION_DELAY = 1500

export const isMainnet = (): boolean => getBooleanEnv('MAINNET')

/**
 * Type guard helper to check if an object has a property
 */
function hasProperty<K extends PropertyKey>(
  obj: object,
  key: K
): obj is Record<K, unknown> {
  return key in obj
}

/**
 * Type guard para verificar errores internos del servidor
 * Uses proper type narrowing without any casts
 * @param apiError - The apiError property from WaxChainApiError
 * @returns true if the error is an internal server error
 */
const isInternalServerError = (apiError: object): boolean => {
  // Since WaxChainApiError.apiError is typed as object,
  // we need to safely navigate its structure
  if (!hasProperty(apiError, 'error')) {
    return false
  }

  const errorObj = apiError.error
  if (typeof errorObj !== 'object' || errorObj === null) {
    return false
  }

  if (!hasProperty(errorObj, 'data')) {
    return false
  }

  const dataObj = errorObj.data
  if (typeof dataObj !== 'object' || dataObj === null) {
    return false
  }

  if (!hasProperty(dataObj, 'name')) {
    return false
  }

  // Check for the specific internal error pattern
  return dataObj.name === 'internal_error_exception'
}

/**
 * Clasifica errores para determinar si debe activarse failover
 * @param error - Error capturado
 * @returns true si debe intentar failover, false si es error de negocio
 */
const shouldTriggerFailover = (error: unknown): boolean => {
  // Errores de conectividad/red que requieren failover
  if (
    error instanceof WaxRequestError ||
    error instanceof WaxRequestTimeoutError ||
    error instanceof WaxRequestAbortedByUser
  ) {
    return true
  }

  // WaxChainApiError puede ser error de servidor o de negocio
  // error.apiError is already typed as object from the library
  if (error instanceof WaxChainApiError) {
    return isInternalServerError(error.apiError)
  }

  // WaxError genérico - analizar mensaje para determinar tipo
  if (error instanceof WaxError) {
    const message = error.message.toLowerCase()
    if (
      message.includes('network') ||
      message.includes('timeout') ||
      message.includes('connection') ||
      message.includes('fetch')
    ) {
      return true
    }
    return false
  }

  // Otros errores (nativos de JS) - probablemente de conectividad
  if (error instanceof Error) {
    const message = error.message.toLowerCase()
    if (
      message.includes('network') ||
      message.includes('timeout') ||
      message.includes('fetch') ||
      message.includes('connection')
    ) {
      return true
    }
  }

  // Por defecto, no activar failover para errores desconocidos
  return false
}

/**
 * Encuentra el mejor endpoint usando HealthChecker
 */
const findBestBackup = async (backups: readonly string[]): Promise<string> => {
  const healthChecker = new HealthChecker([...backups], HEALTH_CHECK_TIMEOUT)

  try {
    // Crear chain temporal solo para el primer backup disponible
    const tempChain = await createHiveChain({ apiEndpoint: backups[0] })

    // Registrar validador nativo con tipo correcto de la librería
    healthChecker.register(
      tempChain.api.database_api.get_dynamic_global_properties,
      {},
      (data: GetDynamicGlobalPropertiesResponse): true | string => {
        // GetDynamicGlobalPropertiesResponse from @hiveio/wax has the correct type
        return data?.id === 0 ? true : 'invalid dgp'
      }
    )

    // Breve evaluación
    await new Promise<void>(resolve =>
      setTimeout(() => resolve(), EVALUATION_DELAY)
    )

    // Obtener mejor endpoint con tipado fuerte
    const endpoints: TScoredEndpoint[] = healthChecker.list()
    const bestEndpoint = endpoints
      .filter(ep => ep.up)
      .sort((a, b) => b.score - a.score)[0]

    if (bestEndpoint) {
      return bestEndpoint.endpointUrl
    }

    throw new Error('No healthy backup found')
  } finally {
    healthChecker.unregisterAll(true)
  }
}

/**
 * Intenta conectar con backups secuencialmente (fallback)
 */
const tryBackupsSequentially = async (
  backups: readonly string[]
): Promise<IHiveChainInterface> => {
  for (const endpoint of backups) {
    try {
      return await createHiveChain({ apiEndpoint: endpoint })
    } catch {
      // Continue to next backup
    }
  }
  throw new Error('All backup endpoints failed')
}

/**
 * Crea una instancia de Hive Chain con failover híbrido
 */
export const hiveChain = async (): Promise<IHiveChainInterface> => {
  // TESTNET: Configuración simple
  if (!isMainnet()) {
    return await createHiveChain({
      chainId: TESTNET_CHAIN_ID,
      apiEndpoint: TESTNET_API,
    })
  }

  // MAINNET: Try-default-first + smart backup
  try {
    const defaultChain = await createHiveChain({ apiEndpoint: MAINNET_DEFAULT })
    return defaultChain
  } catch (error) {
    // Solo intentar failover si es error de conectividad/servidor
    if (!shouldTriggerFailover(error)) {
      throw error // Re-lanzar errores de negocio sin intentar backup
    }

    try {
      // Estrategia 1: HealthChecker inteligente
      const bestBackupUrl = await findBestBackup(MAINNET_BACKUPS)
      const smartChain = await createHiveChain({ apiEndpoint: bestBackupUrl })
      return smartChain
    } catch (healthError) {
      // Estrategia 2: Fallback secuencial
      try {
        return await tryBackupsSequentially(MAINNET_BACKUPS)
      } catch (fallbackError) {
        throw new Error('All Hive APIs are unavailable')
      }
    }
  }
}
