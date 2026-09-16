type StepState = 'pending' | 'active' | 'completed' | 'error'
type IconName = 'number' | 'spinner' | 'check' | 'error'

const STEP_CLASSES: Record<
  StepState,
  { item: string; icon: string; label: string; status: string }
> = {
  pending: {
    item: 'step-pending border-border bg-muted/30 opacity-60',
    icon: 'bg-muted text-muted-foreground',
    label: 'text-muted-foreground',
    status: '',
  },
  active: {
    item: 'step-active border-primary bg-primary/5 shadow-sm',
    icon: 'bg-primary text-primary-foreground animate-pulse',
    label: 'text-primary',
    status: 'En progreso...',
  },
  completed: {
    item: 'step-completed border-green-500 bg-green-50',
    icon: 'bg-green-500 text-white',
    label: 'text-green-700',
    status: 'Completado',
  },
  error: {
    item: 'step-error border-red-500 bg-red-50',
    icon: 'bg-red-500 text-white',
    label: 'text-red-700',
    status: 'Error',
  },
}

const STATUS_COLOR: Record<StepState, string> = {
  pending: '',
  active: 'text-muted-foreground',
  completed: 'text-green-600',
  error: 'text-red-600',
}

const ICON_NAMES: Record<StepState, IconName> = {
  pending: 'number',
  active: 'spinner',
  completed: 'check',
  error: 'error',
}

function resolveStepState(
  index: number,
  currentStep: number,
  completedSteps: readonly number[],
  errorStep: number
): StepState {
  if (index === errorStep) return 'error'
  if (completedSteps.includes(index)) return 'completed'
  if (index === currentStep) return 'active'
  return 'pending'
}

export function showProgressModal(modal: HTMLElement): void {
  modal.classList.remove('hidden')
  modal.classList.add('flex')
}

export function hideProgressModal(modal: HTMLElement): void {
  modal.classList.add('hidden')
  modal.classList.remove('flex')
}

export function updateStepStates(
  container: HTMLElement,
  currentStep: number,
  completedSteps: readonly number[],
  errorStep: number
): void {
  const steps = container.querySelectorAll<HTMLElement>('[data-step-index]')
  const totalSteps = steps.length

  steps.forEach(stepEl => {
    const index = Number(stepEl.getAttribute('data-step-index'))
    const state = resolveStepState(
      index,
      currentStep,
      completedSteps,
      errorStep
    )

    stepEl.setAttribute('data-state', state)

    // Update step item classes
    const baseItemClasses =
      'step-item flex items-center gap-4 p-4 rounded-lg border transition-all duration-500 ease-out'
    stepEl.className = `${baseItemClasses} ${STEP_CLASSES[state].item}`
    stepEl.style.animationDelay = `${index * 150}ms`
    if (state === 'active') {
      stepEl.setAttribute('aria-current', 'step')
    } else {
      stepEl.removeAttribute('aria-current')
    }

    // Update icon container classes
    const iconContainer = stepEl.querySelector<HTMLElement>('.step-icon')
    if (iconContainer) {
      const baseIconClasses =
        'step-icon flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold transition-all duration-300'
      iconContainer.className = `${baseIconClasses} ${STEP_CLASSES[state].icon}`
    }

    // Toggle icon visibility
    const visibleIcon = ICON_NAMES[state]
    stepEl.querySelectorAll<HTMLElement>('[data-icon]').forEach(icon => {
      if (icon.getAttribute('data-icon') === visibleIcon) {
        icon.classList.remove('hidden')
      } else {
        icon.classList.add('hidden')
      }
    })

    // Update label classes
    const label = stepEl.querySelector<HTMLElement>('[data-step-label]')
    if (label) {
      label.className = `text-sm font-medium transition-colors duration-300 ${STEP_CLASSES[state].label}`
    }

    // Update status text
    const statusEl = stepEl.querySelector<HTMLElement>('[data-step-status]')
    if (statusEl) {
      const statusText = STEP_CLASSES[state].status
      if (statusText) {
        statusEl.textContent = statusText
        statusEl.className = `text-xs mt-1 ${STATUS_COLOR[state]}`
        statusEl.classList.remove('hidden')
      } else {
        statusEl.textContent = ''
        statusEl.classList.add('hidden')
      }
    }
  })

  // Update progress bar
  const progressFill = container.querySelector<HTMLElement>(
    '[data-progress-fill]'
  )
  if (progressFill && totalSteps > 0) {
    const referenceStep = errorStep >= 0 ? errorStep : currentStep
    const percentage = Math.max(0, ((referenceStep + 1) / totalSteps) * 100)
    progressFill.style.width = `${percentage}%`
  }
}

export function showProgressError(errorActions: HTMLElement): void {
  errorActions.classList.remove('hidden')
}

export function hideProgressError(errorActions: HTMLElement): void {
  errorActions.classList.add('hidden')
}
