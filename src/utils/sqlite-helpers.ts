/**
 * SQLite Boolean Conversion Utilities
 *
 * SQLite stores booleans as integers (1 = true, 0 = false).
 * These helpers provide type-safe conversion between SQLite integers and TypeScript booleans.
 */

/**
 * Converts SQLite integer/boolean value to TypeScript boolean
 * @param value - SQLite value (1, 0, true, false, or unknown)
 * @returns TypeScript boolean
 */
export const sqliteToBoolean = (value: unknown): boolean => {
  return value === 1 || value === true
}

/**
 * Converts TypeScript boolean to SQLite integer
 * @param value - TypeScript boolean
 * @returns SQLite integer (1 or 0)
 */
export const booleanToSqlite = (value: boolean): number => {
  return value ? 1 : 0
}
