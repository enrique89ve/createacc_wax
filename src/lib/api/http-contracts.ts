import { z } from 'astro/zod'

export const ApiResponseMetaSchema = z.strictObject({
  requestId: z.uuid(),
})

export const ApiSuccessEnvelopeSchema = z.looseObject({
  success: z.literal(true),
  data: z.unknown(),
  meta: ApiResponseMetaSchema,
})

export const ApiProblemDetailsSchema = z.looseObject({
  type: z.url(),
  title: z.string().min(1),
  status: z.number().int().min(400).max(599),
  detail: z.string(),
  code: z.string().min(1),
  requestId: z.uuid(),
})

export type ApiResponseMeta = z.infer<typeof ApiResponseMetaSchema>
export type ApiProblemDetails = z.infer<typeof ApiProblemDetailsSchema>
