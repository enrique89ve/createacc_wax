import {
  SUSPICIOUS_ACCOUNTS,
  SUSPICIOUS_PATTERNS,
} from '@/data/suspicious-accounts'

/**
 * Caché optimizado para lookups ultrarrápidos
 */
let suspiciousAccountsSet: Set<string> | null = null
let suspiciousSubstringsSet: Set<string> | null = null

/**
 * Inicializa el caché de cuentas sospechosas (solo una vez)
 * Complejidad: O(1) después de la primera llamada
 */
function initializeSuspiciousCache() {
  if (suspiciousAccountsSet === null) {
    // Set para lookup exacto O(1)
    suspiciousAccountsSet = new Set(
      SUSPICIOUS_ACCOUNTS.map(account => account.toLowerCase())
    )
    // Set para substrings comunes O(1) - más selectivo
    suspiciousSubstringsSet = new Set([
      'admin',
      'root',
      'mod',
      'spam',
      'scam',
      'fake',
      'hack',
      'hive',
      'steem',
      'bitcoin',
      'nazi',
      'kill',
      'drug',
      'rape',
      'terrorist',
    ])
  }
}

/**
 * Validación ultrarrápida de usuario sospechoso
 * Optimizado para velocidad máxima con múltiples estrategias
 *
 * @param username - Username a validar
 * @returns true si es sospechoso, false si es seguro
 */
export function isSuspiciousUsername(username: string): boolean {
  try {
    // Validación básica
    if (!username || typeof username !== 'string') {
      return true // Entrada inválida es sospechosa
    }

    const cleanUsername = username.toLowerCase().trim()

    // Longitud sospechosa
    if (cleanUsername.length < 3 || cleanUsername.length > 16) {
      return true
    }

    // Inicializar caché una vez
    initializeSuspiciousCache()

    // 1. LOOKUP EXACTO (más rápido - O(1))
    if (suspiciousAccountsSet!.has(cleanUsername)) {
      return true
    }

    // 2. PATRONES REGEX (muy rápido)
    for (const pattern of SUSPICIOUS_PATTERNS) {
      if (pattern.test(cleanUsername)) {
        return true
      }
    }

    // 3. SUBSTRINGS COMUNES (rápido - O(1) por substring)
    for (const suspicious of suspiciousSubstringsSet!) {
      if (cleanUsername.includes(suspicious)) {
        return true
      }
    }

    // 4. VALIDACIONES ESPECÍFICAS (muy rápido)

    // Solo números
    if (/^\d+$/.test(cleanUsername)) {
      return true
    }

    // Caracteres repetidos excesivos
    if (/(.)\1{4,}/.test(cleanUsername)) {
      return true
    }

    // Patrones alternantes sospechosos
    if (/^(.)(.)\1\2\1\2/.test(cleanUsername)) {
      return true
    }

    // Secuencias keyboard (qwerty, asdf, etc.)
    const keyboardPatterns = ['qwerty', 'asdf', 'zxcv', '123456', 'abcdef']
    for (const pattern of keyboardPatterns) {
      if (cleanUsername.includes(pattern)) {
        return true
      }
    }

    // 5. DETECCIÓN DE ENTROPÍA (Nombres generados por bots)
    
    // Racha de 4 o más consonantes seguidas (ignora números en el medio para evaluar legibilidad)
    const lettersOnly = cleanUsername.replace(/[^a-z]/g, '')
    if (/[bcdfghjklmnpqrstvwxyz]{4,}/.test(lettersOnly)) {
      return true
    }

    // Letras y números intercalados sin sentido (ej: x1y2z3 o a1b2c3d4)
    if (/([a-z]\d){3,}|(\d[a-z]){3,}/.test(cleanUsername)) {
      return true
    }

    return false
  } catch (error) {
    return true // En caso de error, consideramos sospechoso por seguridad
  }
}

/**
 * Validación más permisiva con threshold personalizable
 * Solo usa si necesitas flexibilidad adicional
 *
 * @param username - Username a validar
 * @param strictMode - Si usar modo estricto (default: true)
 * @returns true si es sospechoso
 */
export function isSuspiciousUsernameFlexible(
  username: string,
  strictMode: boolean = true
): boolean {
  if (!strictMode) {
    // Modo permisivo: solo bloquear lo más obvio
    const cleanUsername = username.toLowerCase().trim()

    initializeSuspiciousCache()

    // Solo lookup exacto y patrones más obvios
    if (suspiciousAccountsSet!.has(cleanUsername)) {
      return true
    }

    // Solo los patrones más restrictivos
    if (
      /^(admin|root|bot|spam|scam|fake|hack|nazi|kill)\d*$/i.test(cleanUsername)
    ) {
      return true
    }

    return false
  }

  return isSuspiciousUsername(username)
}

/**
 * Obtiene razón específica de por qué un username es sospechoso
 * Útil para logs y debugging
 *
 * @param username - Username a validar
 * @returns string con la razón o null si no es sospechoso
 */
export function getSuspiciousReason(username: string): string | null {
  try {
    if (!username || typeof username !== 'string') {
      return 'Invalid input'
    }

    const cleanUsername = username.toLowerCase().trim()

    if (cleanUsername.length < 3) {
      return 'Too short'
    }

    if (cleanUsername.length > 16) {
      return 'Too long'
    }

    initializeSuspiciousCache()

    if (suspiciousAccountsSet!.has(cleanUsername)) {
      return `Exact match: ${cleanUsername}`
    }

    for (const pattern of SUSPICIOUS_PATTERNS) {
      if (pattern.test(cleanUsername)) {
        return `Pattern match: ${pattern.source}`
      }
    }

    for (const suspicious of suspiciousSubstringsSet!) {
      if (cleanUsername.includes(suspicious)) {
        return `Contains: ${suspicious}`
      }
    }

    if (/^\d+$/.test(cleanUsername)) {
      return 'Numbers only'
    }

    if (/(.)\1{4,}/.test(cleanUsername)) {
      return 'Repeated characters'
    }

    const lettersOnly = cleanUsername.replace(/[^a-z]/g, '')
    if (/[bcdfghjklmnpqrstvwxyz]{4,}/.test(lettersOnly)) {
      return 'High entropy: consecutive consonants'
    }

    if (/([a-z]\d){3,}|(\d[a-z]){3,}/.test(cleanUsername)) {
      return 'High entropy: alternating letters and numbers'
    }

    return null
  } catch (error) {
    return `Error: ${error}`
  }
}

/**
 * Estadísticas del sistema de detección
 */
export function getSuspiciousStats() {
  return {
    totalSuspiciousAccounts: SUSPICIOUS_ACCOUNTS.length,
    totalPatterns: SUSPICIOUS_PATTERNS.length,
    cacheInitialized: suspiciousAccountsSet !== null,
  }
}

/**
 * Limpiar caché (útil para testing)
 */
export function clearSuspiciousCache() {
  suspiciousAccountsSet = null
  suspiciousSubstringsSet = null
}

/**
 * Type guard que verifica si un username es válido (no sospechoso)
 * Combina validación de tipo y contenido en una sola función
 * @param username - Username a validar
 * @returns true si es string válido y no sospechoso
 */
export function isValidUsername(username: unknown): username is string {
  return typeof username === 'string' && !isSuspiciousUsername(username)
}

/**
 * Type guard que verifica si un input es un string válido para username
 * Solo valida tipo y formato básico, no contenido sospechoso
 * @param input - Input a validar
 * @returns true si es string con formato de username válido
 */
export function isUsernameFormat(input: unknown): input is string {
  if (typeof input !== 'string') {
    return false
  }

  const cleaned = input.toLowerCase().trim()
  return (
    cleaned.length >= 3 && cleaned.length <= 16 && /^[a-z0-9.-]+$/.test(cleaned)
  )
}
