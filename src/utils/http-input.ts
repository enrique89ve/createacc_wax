export type JsonObject = Readonly<Record<string, unknown>>

export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Malformed JSON and non-object JSON have the same invalid-request result. */
export async function parseJsonObject(
  request: Request
): Promise<JsonObject | null> {
  try {
    const value: unknown = await request.json()
    return isJsonObject(value) ? value : null
  } catch {
    return null
  }
}

/** Parse only canonical positive decimal IDs, excluding exponent/float syntax. */
export function parsePositiveDecimalId(
  value: string | undefined
): number | null {
  if (!value || !/^[1-9]\d*$/.test(value)) return null
  const id = Number(value)
  return Number.isSafeInteger(id) ? id : null
}
