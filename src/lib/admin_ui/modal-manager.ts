/**
 * ModalManager - Gestión genérica de modales client-side
 * Utilidad reutilizable para management y builders portals
 */

import { MANAGEMENT_UI } from '@/consts/constants'

export class ModalManager {
  private modal: HTMLElement | null
  private form: HTMLFormElement | null

  constructor(modalId: string, formId?: string) {
    this.modal = document.getElementById(modalId)
    this.form = formId
      ? (document.getElementById(formId) as HTMLFormElement)
      : null

    // Auto-setup backdrop click listener
    this.setupBackdropClick()
  }

  /**
   * Muestra el modal
   */
  show(): void {
    if (!this.modal) return

    this.modal.classList.remove(MANAGEMENT_UI.CSS_CLASSES.HIDDEN)
    this.modal.classList.add(MANAGEMENT_UI.CSS_CLASSES.FLEX)
  }

  /**
   * Oculta el modal y resetea el formulario si existe
   */
  hide(): void {
    if (!this.modal) return

    this.modal.classList.add(MANAGEMENT_UI.CSS_CLASSES.HIDDEN)
    this.modal.classList.remove(MANAGEMENT_UI.CSS_CLASSES.FLEX)

    this.resetForm()
  }

  /**
   * Toggle entre show/hide
   */
  toggle(): void {
    if (!this.modal) return

    const isHidden = this.modal.classList.contains(
      MANAGEMENT_UI.CSS_CLASSES.HIDDEN
    )
    if (isHidden) {
      this.show()
    } else {
      this.hide()
    }
  }

  /**
   * Resetea el formulario asociado (si existe)
   */
  resetForm(): void {
    if (this.form) {
      this.form.reset()
    }
  }

  /**
   * Setup para cerrar el modal al hacer clic en el backdrop
   */
  private setupBackdropClick(): void {
    this.modal?.addEventListener('click', event => {
      if (event.target === this.modal) {
        this.hide()
      }
    })
  }

  /**
   * Añade listener para un botón de cerrar custom
   */
  addCloseButton(buttonId: string): void {
    const button = document.getElementById(buttonId)
    button?.addEventListener('click', () => this.hide())
  }

  /**
   * Getter para el modal element (útil para manipulaciones custom)
   */
  getElement(): HTMLElement | null {
    return this.modal
  }

  /**
   * Getter para el form element (útil para validaciones custom)
   */
  getForm(): HTMLFormElement | null {
    return this.form
  }
}
