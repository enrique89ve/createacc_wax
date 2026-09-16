/**
 * DOM Helpers - Utilidades type-safe para manipulación del DOM
 * Simplifica operaciones comunes con null-safety integrado
 */

/**
 * querySelector type-safe con null check
 */
export function querySelector$<T extends HTMLElement>(
  selector: string
): T | null {
  return document.querySelector<T>(selector)
}

/**
 * querySelector que lanza error si el elemento no existe
 * Útil para elementos que deben existir garantizadamente
 */
export function querySelectorRequired$<T extends HTMLElement>(
  selector: string
): T {
  const element = document.querySelector<T>(selector)
  if (!element) {
    throw new Error(`Required element not found: ${selector}`)
  }
  return element
}

/**
 * querySelectorAll type-safe
 */
export function querySelectorAll$<T extends HTMLElement>(
  selector: string
): NodeListOf<T> {
  return document.querySelectorAll<T>(selector)
}

/**
 * Toggle una clase en un elemento (null-safe)
 */
export function toggleClass(
  element: HTMLElement | null,
  className: string,
  add: boolean
): void {
  if (!element) return

  if (add) {
    element.classList.add(className)
  } else {
    element.classList.remove(className)
  }
}

/**
 * Toggle múltiples clases
 */
export function toggleClasses(
  element: HTMLElement | null,
  classesToAdd: string[],
  classesToRemove: string[]
): void {
  if (!element) return

  element.classList.remove(...classesToRemove)
  element.classList.add(...classesToAdd)
}

/**
 * Gestiona estado de loading en un botón
 */
export function setLoading(
  button: HTMLButtonElement | null,
  loading: boolean,
  loadingText: string,
  normalText: string
): void {
  if (!button) return

  button.disabled = loading
  button.textContent = loading ? loadingText : normalText
}

/**
 * Gestiona estado de loading en un botón + inputs asociados
 */
export function setFormLoading(
  button: HTMLButtonElement | null,
  inputs: (HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null)[],
  loading: boolean,
  loadingText: string,
  normalText: string
): void {
  if (button) {
    button.disabled = loading
    button.textContent = loading ? loadingText : normalText
  }

  inputs.forEach(input => {
    if (input) {
      input.disabled = loading
    }
  })
}

/**
 * Muestra/oculta un elemento (usando clases hidden/flex)
 */
export function toggleVisibility(
  element: HTMLElement | null,
  visible: boolean,
  displayClass: string = 'flex'
): void {
  if (!element) return

  if (visible) {
    element.classList.remove('hidden')
    element.classList.add(displayClass)
  } else {
    element.classList.add('hidden')
    element.classList.remove(displayClass)
  }
}

/**
 * Obtiene el valor de un input de forma segura
 */
export function getInputValue(
  selector: string,
  transform?: (value: string) => string
): string {
  const input = querySelector$<HTMLInputElement>(selector)
  if (!input) return ''

  const value = input.value.trim()
  return transform ? transform(value) : value
}

/**
 * Establece el valor de un input de forma segura
 */
export function setInputValue(
  selector: string,
  value: string,
  readonly: boolean = false
): void {
  const input = querySelector$<HTMLInputElement>(selector)
  if (!input) return

  input.value = value
  input.readOnly = readonly
}

/**
 * Obtiene datos de un dataset de forma type-safe
 */
export function getDataAttribute(
  element: HTMLElement | null,
  attribute: string
): string | undefined {
  if (!element) return undefined
  return element.dataset[attribute]
}

/**
 * Añade event listener con type safety
 */
export function addClickListener<T extends HTMLElement>(
  selector: string,
  handler: (element: T, event: MouseEvent) => void
): void {
  const element = querySelector$<T>(selector)
  if (!element) return

  element.addEventListener('click', event => {
    handler(element, event as MouseEvent)
  })
}

/**
 * Event delegation helper
 */
export function delegateClick(
  containerSelector: string,
  targetSelector: string,
  handler: (target: HTMLElement, event: MouseEvent) => void
): void {
  const container = querySelector$(containerSelector)
  if (!container) return

  container.addEventListener('click', event => {
    const target = (event.target as HTMLElement).closest<HTMLElement>(
      targetSelector
    )
    if (target) {
      handler(target, event as MouseEvent)
    }
  })
}
