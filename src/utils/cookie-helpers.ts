function requestUsesHttps(request: Request): boolean {
  const xfProto = request.headers.get('x-forwarded-proto') || ''
  const viaHttpsHeader = xfProto.split(',')[0]?.trim().toLowerCase() === 'https'
  const forwarded = request.headers.get('forwarded') || ''
  const viaForwarded = /proto=https/i.test(forwarded)
  const url = new URL(request.url)
  const viaUrl = url.protocol === 'https:'
  return viaHttpsHeader || viaForwarded || viaUrl
}

/**
 * Cookie Secure flag depends on HTTPS (including reverse-proxy headers).
 * It does not depend on Hive execution mode.
 */
export function shouldUseSecureCookie(request?: Request): boolean {
  if (request) return requestUsesHttps(request)
  return false
}
