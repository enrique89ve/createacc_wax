import { z } from 'astro/zod'
import {
  ApiProblemDetailsSchema,
  ApiSuccessEnvelopeSchema,
  type ApiProblemDetails,
  type ApiResponseMeta,
} from '@/lib/api/http-contracts'

export type ApiClientResult<T> =
  | {
      readonly ok: true
      readonly data: T
      readonly meta: ApiResponseMeta | null
    }
  | {
      readonly ok: false
      readonly kind: 'problem'
      readonly problem: ApiProblemDetails
      readonly body: Readonly<Record<string, unknown>>
    }
  | {
      readonly ok: false
      readonly kind: 'legacy_problem'
      readonly httpStatus: number
      readonly message: string
      readonly errorCode?: string
      readonly body: Readonly<Record<string, unknown>>
    }
  | {
      readonly ok: false
      readonly kind: 'invalid_response'
      readonly httpStatus: number
    }

function isJsonContentType(response: Response): boolean {
  const contentType = response.headers.get('Content-Type')
  const mediaType = contentType?.split(';', 1)[0]?.trim().toLowerCase()
  return (
    mediaType === 'application/json' || mediaType?.endsWith('+json') === true
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Parse canonical envelopes and legacy flat payloads at the untrusted HTTP boundary. */
export async function readApiResponse<T>(
  response: Response,
  dataSchema: z.ZodType<T>
): Promise<ApiClientResult<T>> {
  if (!isJsonContentType(response)) {
    return {
      ok: false,
      kind: 'invalid_response',
      httpStatus: response.status,
    }
  }

  let body: unknown
  try {
    body = await response.json()
  } catch {
    return {
      ok: false,
      kind: 'invalid_response',
      httpStatus: response.status,
    }
  }

  const isLegacyFailure =
    isRecord(body) &&
    (body.success === false ||
      (body.success !== true && typeof body.error === 'string'))

  const envelope = ApiSuccessEnvelopeSchema.safeParse(body)
  if (response.ok && envelope.success) {
    const data = dataSchema.safeParse(envelope.data.data)
    if (data.success) {
      return { ok: true, data: data.data, meta: envelope.data.meta }
    }

    // Do not fall back to legacy aliases when a canonical envelope is malformed.
    return {
      ok: false,
      kind: 'invalid_response',
      httpStatus: response.status,
    }
  }

  if (!response.ok || isLegacyFailure) {
    const problem = ApiProblemDetailsSchema.safeParse(body)
    if (
      problem.success &&
      problem.data.status === response.status &&
      isRecord(body)
    ) {
      return {
        ok: false,
        kind: 'problem',
        problem: problem.data,
        body,
      }
    }

    if (isRecord(body)) {
      const message =
        typeof body.error === 'string'
          ? body.error
          : typeof body.message === 'string'
            ? body.message
            : 'The request could not be completed.'
      return {
        ok: false,
        kind: 'legacy_problem',
        httpStatus: response.status,
        message,
        ...(typeof body.errorCode === 'string'
          ? { errorCode: body.errorCode }
          : {}),
        body,
      }
    }

    return {
      ok: false,
      kind: 'invalid_response',
      httpStatus: response.status,
    }
  }

  const legacyData = dataSchema.safeParse(body)
  if (legacyData.success) {
    return { ok: true, data: legacyData.data, meta: null }
  }

  return {
    ok: false,
    kind: 'invalid_response',
    httpStatus: response.status,
  }
}
