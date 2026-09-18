import type { FormElements, UsernameFieldState } from './types'

const STATUS_ERROR = 'text-destructive'
const STATUS_SUCCESS = 'text-green-400'

function resetStatusTone(element: HTMLElement): void {
  element.classList.remove(STATUS_ERROR, STATUS_SUCCESS)
}

export function setUsernameFieldState(
  elements: FormElements,
  state: UsernameFieldState,
  message?: string
): void {
  elements.loadingIcon.classList.add('hidden')
  elements.successIcon.classList.add('hidden')
  elements.errorIcon.classList.add('hidden')
  resetStatusTone(elements.usernameError)

  elements.usernameInput.classList.remove(
    'border-red-500',
    'border-green-500',
    'border-blue-500'
  )

  switch (state) {
    case 'neutral':
      elements.usernameStatusIcon.classList.add('hidden')
      elements.usernameError.classList.add('hidden')
      elements.usernameError.textContent = ''
      elements.usernameInput.classList.add('border-border')
      break
    case 'loading':
      elements.loadingIcon.classList.remove('hidden')
      elements.usernameStatusIcon.classList.remove('hidden')
      elements.usernameError.classList.add('hidden')
      elements.usernameInput.classList.add('border-blue-500')
      break
    case 'error':
      elements.errorIcon.classList.remove('hidden')
      elements.usernameStatusIcon.classList.remove('hidden')
      elements.usernameInput.classList.add('border-red-500')
      if (message) {
        elements.usernameError.textContent = message
        elements.usernameError.classList.add(STATUS_ERROR)
        elements.usernameError.classList.remove('hidden')
      }
      break
    case 'success':
      elements.successIcon.classList.remove('hidden')
      elements.usernameStatusIcon.classList.remove('hidden')
      elements.usernameInput.classList.add('border-green-500')
      if (message) {
        elements.usernameError.textContent = message
        elements.usernameError.classList.add(STATUS_SUCCESS)
        elements.usernameError.classList.remove('hidden')
      } else {
        elements.usernameError.classList.add('hidden')
      }
      break
  }
}
