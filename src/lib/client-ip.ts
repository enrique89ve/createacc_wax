/**
 * Trusted client IP resolution for rate limiting.
 *
 * Extracted from management-login.ts to be reused across all endpoints
 * that need the real client IP behind proxies (Vercel, Cloudflare, etc.).
 *
 * When TRUST_PROXY_HEADERS=true:
 *   cf-connecting-ip → x-forwarded-for → x-real-ip → context.clientAddress
 *
 * When TRUST_PROXY_HEADERS=false (default):
 *   Uses context.clientAddress directly
 */

import { createHash } from 'node:crypto'
import { isIP } from 'node:net'
import { isTruthyProcessEnv } from '@/lib/env'
import { ENV_KEYS } from '@/consts/constants'

const MAX_HEADER_VALUE_LENGTH = 256
const BRACKETED_IPV6_RE = /^\[([^\]]+)\](?::\d{1,5})?$/
const IPV4_WITH_PORT_RE = /^(\d{1,3}(?:\.\d{1,3}){3}):\d{1,5}$/

const TRUST_PROXY_HEADERS = isTruthyProcessEnv(ENV_KEYS.TRUST_PROXY_HEADERS)

/**
 * Normalize raw header value to trimmed string with max length
 */
function normalizeHeaderValue(
  value: string | null,
  maxLength = MAX_HEADER_VALUE_LENGTH
): string {
  if (!value) return ''
  const normalized = value.trim()
  if (!normalized) return ''
  return normalized.slice(0, maxLength)
}

/**
 * Normalize IP candidate and validate format
 */
function normalizeIpCandidate(rawValue: string): string | null {
  const value = normalizeHeaderValue(rawValue)
  if (!value) return null

  // Direct IPv4/IPv6
  if (isIP(value)) return value

  // Bracketed IPv6 with optional port (e.g., [::1]:443)
  const bracketedIpv6Match = value.match(BRACKETED_IPV6_RE)
  if (bracketedIpv6Match?.[1] && isIP(bracketedIpv6Match[1])) {
    return bracketedIpv6Match[1]
  }

  // IPv4 with port (e.g., 1.2.3.4:443)
  const ipv4WithPortMatch = value.match(IPV4_WITH_PORT_RE)
  if (ipv4WithPortMatch?.[1] && isIP(ipv4WithPortMatch[1])) {
    return ipv4WithPortMatch[1]
  }

  return null
}

/**
 * Extract trusted proxy IP ONLY when explicitly enabled.
 */
function getTrustedProxyIp(request: Request): string | null {
  if (!TRUST_PROXY_HEADERS) {
    return null
  }

  // CF-Connecting-IP: set by Cloudflare to the real client IP.
  // Cannot be spoofed when behind Cloudflare proxy (always overwritten).
  const cfIp = request.headers.get('cf-connecting-ip')
  if (cfIp) {
    const normalizedIp = normalizeIpCandidate(cfIp)
    if (normalizedIp) return normalizedIp
  }

  // Industry standard: take the rightmost valid IP from x-forwarded-for.
  // The rightmost entry is added by the closest trusted proxy, making it
  // the most reliable. Left entries can be spoofed by the client.
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) {
    const chain = forwarded.split(',')
    for (let i = chain.length - 1; i >= 0; i--) {
      const normalizedIp = normalizeIpCandidate(chain[i])
      if (normalizedIp) return normalizedIp
    }
  }

  const realIp = request.headers.get('x-real-ip')
  if (realIp) {
    const normalizedIp = normalizeIpCandidate(realIp)
    if (normalizedIp) return normalizedIp
  }

  return null
}

/**
 * Build deterministic fallback fingerprint when trusted IP is unavailable.
 */
function createFallbackFingerprint(request: Request): string {
  const userAgent = normalizeHeaderValue(request.headers.get('user-agent'))
  const acceptLanguage = normalizeHeaderValue(
    request.headers.get('accept-language')
  )
  const originHost = normalizeHeaderValue(new URL(request.url).host)
  const fingerprintRaw = `${userAgent}|${acceptLanguage}|${originHost}`
  const fingerprintHash = createHash('sha256')
    .update(fingerprintRaw)
    .digest('hex')
    .slice(0, 32)

  return `fp:${fingerprintHash}`
}

/**
 * Resolve the real client IP for rate limiting.
 *
 * Behind a proxy (Vercel/Cloudflare), context.clientAddress is the proxy IP.
 * This function extracts the real client IP from trusted headers when enabled,
 * or falls back to a request fingerprint hash.
 */
export function resolveClientIp(context: {
  clientAddress: string
  request: Request
}): string {
  const trustedIp = getTrustedProxyIp(context.request)
  if (trustedIp) return trustedIp

  // If clientAddress looks valid, use it
  if (context.clientAddress && isIP(context.clientAddress)) {
    return context.clientAddress
  }

  // Fallback to fingerprint
  return createFallbackFingerprint(context.request)
}

/**
 * Resolve source key for rate limiting.
 * Returns { sourceKey } with "ip:" prefix when a valid IP is found,
 * or "fp:" prefix when falling back to request fingerprint.
 */
export function resolveRateLimitSource(context: {
  clientAddress: string
  request: Request
}): { sourceKey: string } {
  const trustedProxyIp = getTrustedProxyIp(context.request)
  if (trustedProxyIp) {
    return { sourceKey: `ip:${trustedProxyIp}` }
  }

  if (context.clientAddress && isIP(context.clientAddress)) {
    return { sourceKey: `ip:${context.clientAddress}` }
  }

  return { sourceKey: createFallbackFingerprint(context.request) }
}
