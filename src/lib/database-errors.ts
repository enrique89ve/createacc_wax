interface StructuredDatabaseError {
  readonly code?: unknown
  readonly rawCode?: unknown
  readonly message?: unknown
}

function structuredError(error: unknown): StructuredDatabaseError | null {
  return typeof error === 'object' && error !== null
    ? (error as StructuredDatabaseError)
    : null
}

export function isUniqueConstraintViolation(error: unknown): boolean {
  const databaseError = structuredError(error)
  if (!databaseError) return false
  if (
    databaseError.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
    databaseError.code === 'SQLITE_CONSTRAINT_PRIMARYKEY' ||
    databaseError.rawCode === 2067 ||
    databaseError.rawCode === 1555
  ) {
    return true
  }
  return (
    databaseError.code === 'SQLITE_CONSTRAINT' &&
    typeof databaseError.message === 'string' &&
    databaseError.message.includes('UNIQUE constraint failed')
  )
}
