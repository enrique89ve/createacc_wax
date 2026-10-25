import { z } from 'astro/zod'
import { TICKET_VALIDATION_ERROR_CODES } from '@/consts/validation'
import type { TicketValidationErrorCode } from '@/consts/validation'
import { readApiResponse } from '@/utils/api-client'
import type { PowSolution } from '@/utils/pow-solver'

const TicketValidationResponseSchema = z.looseObject({
  valid: z.boolean(),
  errorCode: z.string().optional(),
})

export async function verifyTicketInDatabase(
  ticket: string,
  pow: PowSolution,
  timingTokenId: string,
  signal?: AbortSignal
): Promise<TicketValidationErrorCode | null> {
  let response: Response
  try {
    response = await fetch('/api/validate/ticket', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticket, pow, timingTokenId }),
      signal,
    })
  } catch {
    return TICKET_VALIDATION_ERROR_CODES.INTERNAL_ERROR
  }

  const parsed = await readApiResponse(response, TicketValidationResponseSchema)
  if (!response.ok || !parsed.ok) {
    return TICKET_VALIDATION_ERROR_CODES.INTERNAL_ERROR
  }
  if (parsed.data.valid) return null
  return (
    Object.values(TICKET_VALIDATION_ERROR_CODES).find(
      code => code === parsed.data.errorCode
    ) ?? TICKET_VALIDATION_ERROR_CODES.INTERNAL_ERROR
  )
}
