import { validateTicket, cleanTicket } from '@/utils/validate-ticket'
import { publicCopy } from '@/i18n'
import type { FormElements } from './types'

const VERIFIED_INPUT_CLASSES = [
  'border-green-500',
  'focus:border-green-500',
  'focus:ring-green-500/40',
] as const

const VERIFIED_BUTTON_CLASSES = [
  'bg-green-500/10',
  'border-green-500',
  'text-green-400',
  '!opacity-100',
  '!cursor-default',
] as const

export function showTicketError(elements: FormElements, message: string): void {
  elements.ticketInput.classList.remove(
    ...VERIFIED_INPUT_CLASSES,
    'border-border'
  )
  elements.ticketInput.classList.add(
    'border-red-500',
    'focus:border-primary',
    'focus:ring-primary/40'
  )
  elements.ticketError.textContent = message
  elements.ticketError.classList.remove('hidden')
}

export function setTicketLoadingState(elements: FormElements): void {
  const copy = publicCopy()
  elements.ticketInput.disabled = true
  elements.ticketApplyBtn.disabled = true
  elements.ticketApplyLabel.textContent = copy.accessCode.validating
  elements.ticketApplyLabel.classList.remove('hidden')
  elements.ticketApplyIcon.classList.add('hidden')
  elements.ticketApplyBtn.setAttribute('aria-label', copy.accessCode.validating)
}

export function showTicketApplied(
  elements: FormElements,
  ticket: string
): void {
  const copy = publicCopy()
  elements.ticketInput.value = ticket
  elements.ticketInput.disabled = false
  elements.ticketInput.classList.remove('border-border', 'border-red-500')
  elements.ticketInput.classList.remove(
    'focus:border-primary',
    'focus:ring-primary/40'
  )
  elements.ticketInput.classList.add(...VERIFIED_INPUT_CLASSES)
  elements.ticketApplyLabel.classList.add('hidden')
  elements.ticketApplyIcon.classList.remove('hidden')
  elements.ticketApplyBtn.setAttribute(
    'aria-label',
    copy.home.accessCodeVerified
  )
  elements.ticketApplyBtn.classList.remove(
    'bg-muted',
    'text-foreground',
    'border-border'
  )
  elements.ticketApplyBtn.classList.add(...VERIFIED_BUTTON_CLASSES)
  elements.ticketApplyBtn.disabled = true
  elements.ticketError.classList.add('hidden')
}

function resetTicketVerification(elements: FormElements): void {
  const copy = publicCopy()
  elements.ticketInput.classList.remove(
    ...VERIFIED_INPUT_CLASSES,
    'border-red-500'
  )
  elements.ticketInput.classList.add(
    'border-border',
    'focus:border-primary',
    'focus:ring-primary/40'
  )
  elements.ticketApplyLabel.textContent = copy.home.accessCodeVerify
  elements.ticketApplyLabel.classList.remove('hidden')
  elements.ticketApplyIcon.classList.add('hidden')
  elements.ticketApplyBtn.setAttribute(
    'aria-label',
    copy.home.accessCodeVerify
  )
  elements.ticketApplyBtn.classList.remove(...VERIFIED_BUTTON_CLASSES)
  elements.ticketApplyBtn.classList.add(
    'bg-muted',
    'text-foreground',
    'border-border'
  )
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
  resetTicketVerification(elements)

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

  setTicketLoadingState(elements)
  await Promise.resolve()

  showTicketApplied(elements, ticket)
  deps.onTicketValid(ticket)
  return { status: 'applied', ticket }
}
