/**
 * Sistema de Toasts - Tipos y configuraciones
 * Mejora: se añade variante 'info', identificador único y timestamps para facilitar stacking y animaciones.
 */

export type ToastType = 'success' | 'error' | 'warning' | 'info'

export interface ToastConfig {
  readonly type: ToastType
  readonly message: string
  /** Tiempo en ms que permanecerá visible antes de autodestruirse */
  readonly duration?: number
}

// Representa un toast en cola (runtime)
export interface ToastItem extends ToastConfig {
  readonly id: string
  readonly key: string
  readonly createdAt: number
}

export const TOAST_CONFIG = {
  DEFAULT_DURATION: 4000,
  ANIMATION_DURATION: 250,
  MAX_VISIBLE: 4 as const,
} as const

// Clases base para cada variante (Flowbite-inspired + modo oscuro)
export const TOAST_VARIANT_STYLES: Readonly<Record<ToastType, string>> = {
  success:
    'border-green-500/25 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200',
  error:
    'border-red-500/25 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200',
  warning:
    'border-amber-500/25 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200',
  info: 'border-sky-500/25 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200',
}

export const TOAST_VARIANT_ICON_COLORS: Readonly<Record<ToastType, string>> = {
  success:
    'text-green-600 dark:text-green-400 bg-green-100 dark:bg-green-900/40',
  error: 'text-red-600 dark:text-red-400 bg-red-100 dark:bg-red-900/40',
  warning:
    'text-amber-600 dark:text-amber-400 bg-amber-100 dark:bg-amber-900/40',
  info: 'text-sky-600 dark:text-sky-400 bg-sky-100 dark:bg-sky-900/40',
}

// Declaraciones globales para funciones de toast disponibles en window
declare global {
  interface Window {
    showToast: (type: ToastType, message: string, duration?: number) => string
    dismissToast: (id: string) => void
    __TOAST_INITIALIZED__?: boolean
  }
}
