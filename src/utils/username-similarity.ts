/**
 * Algoritmo de similitud de usernames basado en distancia de Levenshtein
 * Replica la lógica de difflib.SequenceMatcher de Python
 */

/**
 * Calcula la distancia de Levenshtein entre dos cadenas
 * @param a - Primera cadena
 * @param b - Segunda cadena
 * @returns Distancia de Levenshtein
 */
function levenshteinDistance(a: string, b: string): number {
  const matrix = []

  // Si alguna cadena está vacía, la distancia es la longitud de la otra
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length

  // Inicializar matriz
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i]
  }

  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j
  }

  // Llenar matriz
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1]
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitución
          matrix[i][j - 1] + 1, // inserción
          matrix[i - 1][j] + 1 // eliminación
        )
      }
    }
  }

  return matrix[b.length][a.length]
}

/**
 * Calcula el ratio de similitud entre dos cadenas
 * Equivalente a difflib.SequenceMatcher().ratio() de Python
 * @param a - Primera cadena
 * @param b - Segunda cadena
 * @returns Ratio de similitud entre 0.0 y 1.0
 */
export function calcSimilarity(a: string, b: string): number {
  if (a === b) return 1.0
  if (a.length === 0 && b.length === 0) return 1.0
  if (a.length === 0 || b.length === 0) return 0.0

  const maxLength = Math.max(a.length, b.length)
  const distance = levenshteinDistance(a.toLowerCase(), b.toLowerCase())

  return (maxLength - distance) / maxLength
}

/**
 * Verifica si dos usernames son similares según un umbral
 * @param username1 - Primer username
 * @param username2 - Segundo username
 * @param threshold - Umbral de similitud (default: 0.68)
 * @returns true si son similares, false si no
 */
export function isUsernameSimilar(
  username1: string,
  username2: string,
  threshold: number = 0.68
): boolean {
  const ratio = calcSimilarity(username1, username2)
  return ratio >= threshold
}

/**
 * Interfaz para resultado de validación de similitud
 */
export interface SimilarityCheckResult {
  isSimilar: boolean
  similarUsernames: Array<{
    username: string
    similarity: number
    createdAt: string
  }>
  threshold: number
}

/**
 * Encuentra usernames similares en una lista de usernames existentes
 * @param newUsername - Nuevo username a verificar
 * @param existingUsernames - Array de objetos con username y creation_date
 * @param threshold - Umbral de similitud (default: 0.68)
 * @returns Resultado de la verificación de similitud
 */
export function findSimilarUsernames(
  newUsername: string,
  existingUsernames: Array<{ username: string; creation_date: string }>,
  threshold: number = 0.68
): SimilarityCheckResult {
  const similarUsernames: Array<{
    username: string
    similarity: number
    createdAt: string
  }> = []

  const cleanNewUsername = newUsername.toLowerCase().trim()

  for (const existing of existingUsernames) {
    const similarity = calcSimilarity(
      cleanNewUsername,
      existing.username.toLowerCase()
    )
    if (similarity >= threshold) {
      similarUsernames.push({
        username: existing.username,
        similarity: Math.round(similarity * 100) / 100, // Redondear a 2 decimales
        createdAt: existing.creation_date,
      })
    }
  }

  // Ordenar por similitud descendente
  similarUsernames.sort((a, b) => b.similarity - a.similarity)

  return {
    isSimilar: similarUsernames.length > 0,
    similarUsernames,
    threshold,
  }
}

/**
 * Valida que las fechas estén en las últimas X horas
 * @param dateString - Fecha en formato string
 * @param hoursAgo - Número de horas atrás (default: 24)
 * @returns true si la fecha está dentro del rango
 */
export function isWithinTimeRange(
  dateString: string,
  hoursAgo: number = 24
): boolean {
  try {
    const now = new Date()
    const targetDate = new Date(dateString)
    const hoursAgoDate = new Date(now.getTime() - hoursAgo * 60 * 60 * 1000)

    return targetDate >= hoursAgoDate
  } catch (error) {
    return false
  }
}

/**
 * Genera mensaje de error personalizado para usernames similares
 * @param similarUsernames - Array de usernames similares encontrados
 * @returns Mensaje de error formateado
 */
export function generateSimilarityErrorMessage(
  similarUsernames: Array<{
    username: string
    similarity: number
    createdAt: string
  }>
): string {
  if (similarUsernames.length === 0) {
    return 'Username no disponible'
  }

  const mostSimilar = similarUsernames[0]
  const similarityPercentage = Math.round(mostSimilar.similarity * 100)

  if (similarUsernames.length === 1) {
    return `Username muy similar a "${mostSimilar.username}" (${similarityPercentage}% similar) creado recientemente`
  }

  return `Username muy similar a ${similarUsernames.length} cuentas recientes. La más similar: "${mostSimilar.username}" (${similarityPercentage}%)`
}

/**
 * Genera sugerencias de usernames alternativos
 * @param originalUsername - Username original rechazado
 * @returns Array de sugerencias de usernames
 */
export function suggestUsernames(originalUsername: string): string[] {
  const suggestions: string[] = []
  const base = originalUsername.toLowerCase().trim()

  // Añadir números
  suggestions.push(`${base}123`)
  suggestions.push(`${base}2024`)
  suggestions.push(`${base}2025`)

  // Añadir prefijos/sufijos
  if (base.length <= 12) {
    // Mantener límite de 16 caracteres
    suggestions.push(`${base}user`)
    suggestions.push(`${base}dev`)
    suggestions.push(`new${base}`)
  }

  // Variar con guiones si es apropiado
  if (base.length <= 14) {
    suggestions.push(`${base}-1`)
    suggestions.push(`${base}-2`)
  }

  // Filtrar sugerencias válidas (3-16 caracteres, formato correcto)
  return suggestions
    .filter(suggestion => {
      return (
        suggestion.length >= 3 &&
        suggestion.length <= 16 &&
        /^[a-z]/.test(suggestion) && // Empieza con letra
        /^[a-z0-9.-]+$/.test(suggestion) && // Solo caracteres válidos
        !/[.-]{2,}/.test(suggestion) && // No caracteres especiales consecutivos
        !/[.-]$/.test(suggestion) // No termina con caracteres especiales
      )
    })
    .slice(0, 3) // Máximo 3 sugerencias
}

// ===== BACKWARD COMPATIBILITY ALIASES =====

/**
 * @deprecated Usar calcSimilarity() en su lugar
 * Mantenido por compatibilidad hacia atrás
 */
export const calculateSimilarityRatio = calcSimilarity

/**
 * @deprecated Usar isUsernameSimilar() en su lugar
 * Mantenido por compatibilidad hacia atrás
 */
export const areUsernamesSimilar = isUsernameSimilar

/**
 * @deprecated Usar suggestUsernames() en su lugar
 * Mantenido por compatibilidad hacia atrás
 */
export const generateUsernameSuggestions = suggestUsernames
