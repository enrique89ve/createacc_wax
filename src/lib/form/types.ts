import type { PowSolution } from '@/utils/pow-solver'

export interface FormElements {
  readonly form: HTMLFormElement
  readonly usernameInput: HTMLInputElement
  readonly usernameStatusIcon: HTMLElement
  readonly loadingIcon: HTMLElement
  readonly successIcon: HTMLElement
  readonly errorIcon: HTMLElement
  readonly usernameError: HTMLElement
  readonly ticketInput: HTMLInputElement
  readonly ticketApplyBtn: HTMLButtonElement
  readonly ticketInputContainer: HTMLElement
  readonly ticketChip: HTMLElement
  readonly ticketChipCode: HTMLElement
  readonly ticketRemoveBtn: HTMLButtonElement
  readonly ticketError: HTMLElement
  readonly submitButton: HTMLButtonElement
}

export function queryFormElements(): FormElements | null {
  const form = document.querySelector<HTMLFormElement>('#registro-form')
  const usernameInput = document.querySelector<HTMLInputElement>('#username')
  const usernameStatusIcon = document.querySelector<HTMLElement>(
    '#username-status-icon'
  )
  const loadingIcon = document.querySelector<HTMLElement>('#loading-icon')
  const successIcon = document.querySelector<HTMLElement>('#success-icon')
  const errorIcon = document.querySelector<HTMLElement>('#error-icon')
  const usernameError = document.querySelector<HTMLElement>('#username-error')
  const ticketInput = document.querySelector<HTMLInputElement>('#ticket')
  const ticketApplyBtn =
    document.querySelector<HTMLButtonElement>('#ticket-apply-btn')
  const ticketInputContainer = document.querySelector<HTMLElement>(
    '#ticket-input-container'
  )
  const ticketChip = document.querySelector<HTMLElement>('#ticket-chip')
  const ticketChipCode =
    document.querySelector<HTMLElement>('#ticket-chip-code')
  const ticketRemoveBtn =
    document.querySelector<HTMLButtonElement>('#ticket-remove-btn')
  const ticketError = document.querySelector<HTMLElement>('#ticket-error')
  const submitButton =
    document.querySelector<HTMLButtonElement>('#form-siguiente')

  if (
    !form ||
    !usernameInput ||
    !usernameStatusIcon ||
    !loadingIcon ||
    !successIcon ||
    !errorIcon ||
    !usernameError ||
    !ticketInput ||
    !ticketApplyBtn ||
    !ticketInputContainer ||
    !ticketChip ||
    !ticketChipCode ||
    !ticketRemoveBtn ||
    !ticketError ||
    !submitButton
  ) {
    return null
  }

  return {
    form,
    usernameInput,
    usernameStatusIcon,
    loadingIcon,
    successIcon,
    errorIcon,
    usernameError,
    ticketInput,
    ticketApplyBtn,
    ticketInputContainer,
    ticketChip,
    ticketChipCode,
    ticketRemoveBtn,
    ticketError,
    submitButton,
  }
}

export type UsernameFieldState = 'neutral' | 'loading' | 'error' | 'success'

export interface FormState {
  isUsernameValid: boolean
  isTicketValid: boolean
  isSubmitting: boolean
  preSolvedPow: Promise<PowSolution | null> | null
  preSolvedPowAt: number
  flowTimingToken: string | undefined
  flowTimingTokenFetchedAt: number
}

export function createInitialState(): FormState {
  return {
    isUsernameValid: false,
    isTicketValid: false,
    isSubmitting: false,
    preSolvedPow: null,
    preSolvedPowAt: 0,
    flowTimingToken: undefined,
    flowTimingTokenFetchedAt: 0,
  }
}
