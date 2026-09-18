import { defineMiddleware } from 'astro:middleware'
import '@/i18n/app-locals'
import { getMessages } from './messages'
import {
  localeRedirectUrl,
  persistLocaleCookie,
  resolveLocale,
} from './resolve-locale'

function applyLocaleResponseHeaders(
  response: Response,
  locale: string,
  pathname: string
): void {
  if (pathname.startsWith('/api/')) return
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('text/html')) return

  response.headers.set('Content-Language', locale)
  response.headers.set('Vary', 'Cookie, Accept-Language')
}

export const localeMiddleware = defineMiddleware(async (context, next) => {
  const resolution = resolveLocale({
    url: context.url,
    cookies: context.cookies,
    acceptLanguage: context.request.headers.get('accept-language'),
  })

  if (
    resolution.shouldRedirect &&
    resolution.requestedLocale &&
    context.request.method === 'GET' &&
    !context.url.pathname.startsWith('/api/')
  ) {
    persistLocaleCookie(
      context.cookies,
      resolution.requestedLocale,
      context.request
    )
    return context.redirect(localeRedirectUrl(context.url))
  }

  context.locals.locale = resolution.locale
  context.locals.messages = getMessages(resolution.locale)
  if (!context.url.pathname.startsWith('/api/')) {
    persistLocaleCookie(context.cookies, resolution.locale, context.request)
  }

  const response = await next()
  applyLocaleResponseHeaders(
    response,
    resolution.locale,
    context.url.pathname
  )
  return response
})
