/**
 * Username similarity algorithm based on Levenshtein distance
 * Replicates the logic of Python's difflib.SequenceMatcher
 */

/**
 * Calculates the Levenshtein distance between two strings
 * @param a - First string
 * @param b - Second string
 * @returns Levenshtein distance
 */
function levenshteinDistance(a: string, b: string): number {
  const matrix = []

  // If any string is empty, the distance is the length of the other
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length

  // Initialize matrix
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i]
  }

  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j
  }

  // Fill matrix
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1]
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1, // insertion
          matrix[i - 1][j] + 1 // deletion
        )
      }
    }
  }

  return matrix[b.length][a.length]
}

/**
 * Calculates the similarity ratio between two strings
 * Equivalent to Python's difflib.SequenceMatcher().ratio()
 * @param a - First string
 * @param b - Second string
 * @returns Similarity ratio between 0.0 and 1.0
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
 * Checks if two usernames are similar based on a threshold
 * @param username1 - First username
 * @param username2 - Second username
 * @param threshold - Similarity threshold (default: 0.68)
 * @returns true if similar, false if not
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
 * Interface for similarity validation result
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
 * Finds similar usernames in a list of existing usernames
 * @param newUsername - New username to check
 * @param existingUsernames - Array of objects with username and creation_date
 * @param threshold - Similarity threshold (default: 0.68)
 * @returns Similarity check result
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
        similarity: Math.round(similarity * 100) / 100, // Round to 2 decimal places
        createdAt: existing.creation_date,
      })
    }
  }

  // Sort by similarity descending
  similarUsernames.sort((a, b) => b.similarity - a.similarity)

  return {
    isSimilar: similarUsernames.length > 0,
    similarUsernames,
    threshold,
  }
}

/**
 * Validates that dates are within the last X hours
 * @param dateString - Date in string format
 * @param hoursAgo - Number of hours ago (default: 24)
 * @returns true if date is within range
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
 * Generates custom error message for similar usernames
 * @param similarUsernames - Array of similar usernames found
 * @returns Formatted error message
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
 * Generates alternative username suggestions
 * @param originalUsername - Original rejected username
 * @returns Array of username suggestions
 */
export function suggestUsernames(originalUsername: string): string[] {
  const suggestions: string[] = []
  const base = originalUsername.toLowerCase().trim()

  // Add numbers
  suggestions.push(`${base}123`)
  suggestions.push(`${base}2024`)
  suggestions.push(`${base}2025`)

  // Add prefixes/suffixes
  if (base.length <= 12) {
    // Maintain 16 character limit
    suggestions.push(`${base}user`)
    suggestions.push(`${base}dev`)
    suggestions.push(`new${base}`)
  }

  // Vary with hyphens if appropriate
  if (base.length <= 14) {
    suggestions.push(`${base}-1`)
    suggestions.push(`${base}-2`)
  }

  // Filter valid suggestions (3-16 characters, correct format)
  return suggestions
    .filter(suggestion => {
      return (
        suggestion.length >= 3 &&
        suggestion.length <= 16 &&
        /^[a-z]/.test(suggestion) && // Starts with letter
        /^[a-z0-9.-]+$/.test(suggestion) && // Only valid characters
        !/[.-]{2,}/.test(suggestion) && // No consecutive special characters
        !/[.-]$/.test(suggestion) // Does not end with special characters
      )
    })
    .slice(0, 3) // Maximum 3 suggestions
}

// ===== BACKWARD COMPATIBILITY ALIASES =====

/**
 * @deprecated Use calcSimilarity() instead
 * Maintained for backward compatibility
 */
export const calculateSimilarityRatio = calcSimilarity

/**
 * @deprecated Use isUsernameSimilar() instead
 * Maintained for backward compatibility
 */
export const areUsernamesSimilar = isUsernameSimilar

/**
 * @deprecated Use suggestUsernames() instead
 * Maintained for backward compatibility
 */
export const generateUsernameSuggestions = suggestUsernames
