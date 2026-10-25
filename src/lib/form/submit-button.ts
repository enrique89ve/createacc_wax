import { obtainPowSolution, type PowSolution } from '@/utils/pow-solver'
import { prewarmWaxFoundation } from '@/lib/wax-foundation'
import type { FormElements, FormState } from './types'

export function updateSubmitButtonState(
  elements: FormElements,
  isEnabled: boolean
): void {
  if (isEnabled) {
    elements.submitButton.disabled = false
    elements.submitButton.classList.remove('opacity-50', 'cursor-not-allowed')
    elements.submitButton.classList.add('cursor-pointer')
  } else {
    elements.submitButton.disabled = true
    elements.submitButton.classList.add('opacity-50', 'cursor-not-allowed')
    elements.submitButton.classList.remove('cursor-pointer')
  }
}

export function syncSubmitButton(
  elements: FormElements,
  state: FormState,
  shouldPrewarm = true
): void {
  const bothValid = state.isUsernameValid && state.isTicketValid
  updateSubmitButtonState(elements, bothValid)

  if (bothValid && shouldPrewarm) {
    prewarmWaxFoundation()
    if (!state.preSolvedPow) {
      state.preSolvedPowAt = performance.now()
      const abortController = new AbortController()
      state.preSolvedPowAbortController = abortController
      state.preSolvedPow = obtainPowSolution({
        signal: abortController.signal,
      }).catch((): PowSolution | null => {
        if (state.preSolvedPowAbortController === abortController) {
          state.preSolvedPow = null
          state.preSolvedPowAbortController = null
        }
        return null
      })
    }
    return
  }

  if (bothValid) return

  state.preSolvedPowAbortController?.abort()
  state.preSolvedPowAbortController = null
  state.preSolvedPow = null
  state.preSolvedPowAt = 0
}
