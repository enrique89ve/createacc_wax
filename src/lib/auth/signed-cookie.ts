import { createHmac, timingSafeEqual } from 'node:crypto'
import { logger } from '@/lib/logger'

const HMAC_ALGORITHM = 'sha256'

export function signPayload(data: string, secret: string): string {
  const hmac = createHmac(HMAC_ALGORITHM, secret)
  hmac.update(data)
  return `${data}.${hmac.digest('base64url')}`
}

export function verifySignedPayload(
  signedData: string,
  secret: string
): string | null {
  try {
    const [data, signature] = signedData.split('.')
    if (!data || !signature) return null

    const expectedSignature = createHmac(HMAC_ALGORITHM, secret)
      .update(data)
      .digest('base64url')

    const expectedBuffer = Buffer.from(expectedSignature, 'base64url')
    const actualBuffer = Buffer.from(signature, 'base64url')

    if (expectedBuffer.length !== actualBuffer.length) return null
    if (!timingSafeEqual(expectedBuffer, actualBuffer)) return null

    return data
  } catch (error) {
    logger.warn('[signed-cookie] signature verification failed', {
      error: error instanceof Error ? error.message : 'unknown',
    })
    return null
  }
}

export function encodeJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf-8').toString('base64url')
}

export function decodeJson(encoded: string): unknown | null {
  try {
    const json = Buffer.from(encoded, 'base64url').toString('utf-8')
    return JSON.parse(json)
  } catch {
    return null
  }
}

export function signValue(value: string, secret: string): string {
  const encoded = Buffer.from(value, 'utf-8').toString('base64url')
  return signPayload(encoded, secret)
}

export function verifySignedValue(
  signedValue: string,
  secret: string
): string | null {
  const verified = verifySignedPayload(signedValue, secret)
  if (!verified) return null
  try {
    return Buffer.from(verified, 'base64url').toString('utf-8')
  } catch {
    return null
  }
}
