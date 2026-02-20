/**
 * ModalManager - Generic client-side modal management
 * Reusable utility for management and builders portals
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
   * Shows the modal
   */
  show(): void {
    if (!this.modal) return

    this.modal.classList.remove(MANAGEMENT_UI.CSS_CLASSES.HIDDEN)
    this.modal.classList.add(MANAGEMENT_UI.CSS_CLASSES.FLEX)
  }

  /**
   * Hides the modal and resets the form if it exists
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
   * Resets the associated form (if it exists)
   */
  resetForm(): void {
    if (this.form) {
      this.form.reset()
    }
  }

  /**
   * Setup to close the modal when clicking on the backdrop
   */
  private setupBackdropClick(): void {
    this.modal?.addEventListener('click', event => {
      if (event.target === this.modal) {
        this.hide()
      }
    })
  }

  /**
   * Adds listener for a custom close button
   */
  addCloseButton(buttonId: string): void {
    const button = document.getElementById(buttonId)
    button?.addEventListener('click', () => this.hide())
  }

  /**
   * Getter for the modal element (useful for custom manipulations)
   */
  getElement(): HTMLElement | null {
    return this.modal
  }

  /**
   * Getter for the form element (useful for custom validations)
   */
  getForm(): HTMLFormElement | null {
    return this.form
  }
}
