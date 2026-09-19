import { validateTicket, cleanTicket } from '@/utils/validate-ticket'
import { publicCopy } from '@/i18n'
import type { FormElements } from './types'

export function showTicketError(elements: FormElements, message: string): void {
  elements.ticketInput.classList.add('border-red-500')
  elements.ticketError.textContent = message
  elements.ticketError.classList.remove('hidden')
}

export function setTicketLoadingState(
  elements: FormElements,
  _ticket: string
): void {
  const copy = publicCopy()
  elements.ticketInput.disabled = true
  elements.ticketApplyBtn.disabled = true
  elements.ticketApplyBtn.textContent = copy.accessCode.validating
}

export function showTicketApplied(
  elements: FormElements,
  ticket: string
): void {
  elements.ticketChipCode.textContent = ticket
  elements.ticketInputContainer.classList.add('hidden')
  elements.ticketChip.classList.remove('hidden')
  elements.ticketError.classList.add('hidden')
}

export function resetTicketInput(elements: FormElements): void {
  const copy = publicCopy()
  elements.ticketInput.disabled = false
  elements.ticketApplyBtn.textContent = copy.home.accessCodeVerify
  elements.ticketApplyBtn.disabled = false
}

export function removeTicket(elements: FormElements): void {
  const copy = publicCopy()
  elements.ticketChip.classList.add('hidden')
  elements.ticketInputContainer.classList.remove('hidden')
  elements.ticketInput.value = ''
  elements.ticketInput.disabled = false
  elements.ticketApplyBtn.textContent = copy.home.accessCodeVerify
  elements.ticketApplyBtn.disabled = true
  elements.ticketError.classList.add('hidden')
  elements.ticketInput.classList.remove('border-red-500')
  elements.ticketInput.focus()
}

export function handleTicketInputChange(elements: FormElements): boolean {
  const cleaned = cleanTicket(elements.ticketInput.value)

  if (cleaned !== elements.ticketInput.value) {
    const pos = elements.ticketInput.selectionStart || 0
    elements.ticketInput.value = cleaned
    const newPos = Math.min(pos, cleaned.length)
    elements.ticketInput.setSelectionRange(newPos, newPos)
  }

  elements.ticketError.classList.add('hidden')
  elements.ticketInput.classList.remove('border-red-500')

  if (!cleaned) return false

  const localError = validateTicket(cleaned)
  return localError === null
}

export interface ApplyTicketDeps {
  readonly elements: FormElements
  readonly onTicketValid: (ticket: string) => void
  readonly onTicketInvalid: () => void
}

export type ApplyTicketResult =
  | { readonly status: 'applied'; readonly ticket: string }
  | { readonly status: 'invalid' }

/** Local format check only — DB validation happens in POST /api/create/session. */
export async function applyTicket(
  deps: ApplyTicketDeps
): Promise<ApplyTicketResult> {
  const { elements } = deps
  const copy = publicCopy()

  const ticket = cleanTicket(elements.ticketInput.value)
  const localError = validateTicket(ticket)
  if (localError) {
    showTicketError(elements, copy.accessCode.format[localError])
    deps.onTicketInvalid()
    return { status: 'invalid' }
  }

  setTicketLoadingState(elements, ticket)
  await Promise.resolve()

  showTicketApplied(elements, ticket)
  deps.onTicketValid(ticket)
  resetTicketInput(elements)
  return { status: 'applied', ticket }
}
