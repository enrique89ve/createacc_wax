/** HTTP response builders for JSON API routes. */

import { HTTP_STATUS } from '@/consts/constants'
import { ALL_ERROR_CODES } from '@/consts/unified-errors'
import {
  ApiProblemDetailsSchema,
  ApiResponseMetaSchema,
  ApiSuccessEnvelopeSchema,
} from '@/lib/api/http-contracts'

export type ApiSuccessResponse<T> = {
  readonly success: true
  readonly data: T
  readonly meta: { readonly requestId: string }
}

export type ApiErrorResponse = {
  readonly type: 'about:blank'
  readonly title: string
  readonly status: number
  readonly detail: string
  readonly code: string
  readonly requestId: string
  readonly success: false
  readonly error: string
  readonly message: string
  readonly errorCode?: string
  readonly details?: unknown
}

export interface ResponseOptions {
  readonly noCache?: boolean
  readonly headers?: HeadersInit
  readonly requestId?: string
}

const DEFAULT_CACHE_CONTROL = 'no-store'
const JSON_CONTENT_TYPE = 'application/json; charset=utf-8'
const PROBLEM_CONTENT_TYPE = 'application/problem+json; charset=utf-8'
const EMPTY_OBJECT: Readonly<Record<string, unknown>> = Object.freeze({})

const HTTP_PROBLEM_CODES: Readonly<Record<number, string>> = {
  [HTTP_STATUS.BAD_REQUEST]: 'BAD_REQUEST',
  [HTTP_STATUS.UNAUTHORIZED]: 'UNAUTHORIZED',
  [HTTP_STATUS.FORBIDDEN]: 'FORBIDDEN',
  [HTTP_STATUS.NOT_FOUND]: 'NOT_FOUND',
  [HTTP_STATUS.CONFLICT]: 'CONFLICT',
  [HTTP_STATUS.TOO_MANY_REQUESTS]: 'TOO_MANY_REQUESTS',
  [HTTP_STATUS.INTERNAL_SERVER_ERROR]: 'INTERNAL_SERVER_ERROR',
  [HTTP_STATUS.SERVICE_UNAVAILABLE]: 'SERVICE_UNAVAILABLE',
}

const HTTP_PROBLEM_TITLES: Readonly<Record<number, string>> = {
  [HTTP_STATUS.BAD_REQUEST]: 'Bad Request',
  [HTTP_STATUS.UNAUTHORIZED]: 'Unauthorized',
  [HTTP_STATUS.FORBIDDEN]: 'Forbidden',
  [HTTP_STATUS.NOT_FOUND]: 'Not Found',
  [HTTP_STATUS.CONFLICT]: 'Conflict',
  [HTTP_STATUS.TOO_MANY_REQUESTS]: 'Too Many Requests',
  [HTTP_STATUS.INTERNAL_SERVER_ERROR]: 'Internal Server Error',
  [HTTP_STATUS.SERVICE_UNAVAILABLE]: 'Service Unavailable',
  405: 'Method Not Allowed',
  408: 'Request Timeout',
  415: 'Unsupported Media Type',
  422: 'Unprocessable Content',
  502: 'Bad Gateway',
  504: 'Gateway Timeout',
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getRequestId(options?: ResponseOptions): string {
  const requestId = options?.requestId ?? globalThis.crypto.randomUUID()
  const parsedRequestId =
    ApiResponseMetaSchema.shape.requestId.safeParse(requestId)

  if (!parsedRequestId.success) {
    throw new TypeError('API request ID must be a UUID')
  }

  return parsedRequestId.data
}

function createHeaders(
  contentType: string,
  options?: ResponseOptions,
  requestId?: string
): Headers {
  const headers = new Headers(options?.headers)
  headers.set('Content-Type', contentType)

  headers.set('Cache-Control', DEFAULT_CACHE_CONTROL)
  if (requestId) headers.set('X-Request-Id', requestId)

  return headers
}

function createResponseWithOptions(
  body: unknown,
  status: number,
  options?: ResponseOptions,
  contentType = JSON_CONTENT_TYPE,
  requestId?: string
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: createHeaders(contentType, options, requestId),
  })
}

/** Low-level JSON response retained for specialized legacy protocols. */
export function createJsonResponse(
  body: unknown,
  status: number,
  options?: ResponseOptions
): Response {
  if (isRecord(body) && body.success === true) {
    const data = { ...body }
    delete data.success
    return apiSuccess(data, status, options)
  }

  if (isRecord(body) && body.success === false) {
    if (status === HTTP_STATUS.ACCEPTED) {
      const pendingData = { ...body }
      delete pendingData.success
      return apiSuccess({ status: 'pending', ...pendingData }, status, options)
    }

    const detail =
      typeof body.error === 'string'
        ? body.error
        : typeof body.message === 'string'
          ? body.message
          : 'Request failed'
    const legacyErrorCode =
      typeof body.errorCode === 'string' ? body.errorCode : undefined
    return createProblemResponse(
      detail,
      status,
      body.details,
      options,
      body,
      legacyErrorCode
    )
  }

  return createResponseWithOptions(body, status, options)
}

/** Return a canonical success envelope and temporary flat aliases for old clients. */
export function apiSuccess<T>(
  data: T,
  status: number = HTTP_STATUS.OK,
  options?: ResponseOptions
): Response {
  const requestId = getRequestId(options)
  const envelope = {
    success: true as const,
    data,
    meta: { requestId },
  }
  const validation = ApiSuccessEnvelopeSchema.safeParse(envelope)

  if (!validation.success) {
    throw new TypeError('API success response violates its shared contract')
  }

  const legacyFields = isRecord(data) ? data : EMPTY_OBJECT
  const body: ApiSuccessResponse<T> & Record<string, unknown> = {
    ...legacyFields,
    ...envelope,
  }

  return createResponseWithOptions(
    body,
    status,
    options,
    JSON_CONTENT_TYPE,
    requestId
  )
}

function getPublicErrorCode(
  details: unknown,
  status: number,
  suppliedErrorCode?: string
): string {
  const detailCode = isRecord(details) ? details.code : undefined
  for (const legacyErrorCode of [suppliedErrorCode, detailCode]) {
    if (typeof legacyErrorCode !== 'string') continue
    for (const errorCode of Object.values(ALL_ERROR_CODES)) {
      if (errorCode === legacyErrorCode) return errorCode
    }
  }

  return HTTP_PROBLEM_CODES[status] ?? `HTTP_${status}`
}

/** Return RFC 9457 problem details and temporary fields for existing clients. */
export function apiError(
  error: string,
  status: number,
  details?: unknown,
  options?: ResponseOptions
): Response {
  const requestId = getRequestId(options)
  return createProblemResponse(
    error,
    status,
    details,
    options,
    {},
    undefined,
    requestId
  )
}

function createProblemResponse(
  error: string,
  status: number,
  details: unknown,
  options: ResponseOptions | undefined,
  legacyFields: Readonly<Record<string, unknown>>,
  suppliedErrorCode?: string,
  requestId = getRequestId(options)
): Response {
  const errorCode = getPublicErrorCode(details, status, suppliedErrorCode)
  const problem = {
    type: 'about:blank' as const,
    title: HTTP_PROBLEM_TITLES[status] ?? 'Request Failed',
    status,
    detail: error,
    code: errorCode,
    requestId,
    ...(details === undefined ? {} : { details }),
  }
  const validation = ApiProblemDetailsSchema.safeParse(problem)

  if (!validation.success) {
    throw new TypeError('API problem response violates its shared contract')
  }

  const legacyErrorCode =
    suppliedErrorCode ?? (isRecord(details) ? details.code : undefined)
  const body: ApiErrorResponse & Record<string, unknown> = {
    ...legacyFields,
    type: problem.type,
    title: problem.title,
    status: problem.status,
    detail: problem.detail,
    code: problem.code,
    requestId: problem.requestId,
    success: false,
    error,
    message:
      typeof legacyFields.message === 'string' ? legacyFields.message : error,
    ...(typeof legacyErrorCode === 'string'
      ? { errorCode: legacyErrorCode }
      : {}),
    ...(details === undefined ? {} : { details }),
  }

  return createResponseWithOptions(
    body,
    status,
    options,
    PROBLEM_CONTENT_TYPE,
    requestId
  )
}
