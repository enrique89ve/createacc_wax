/* eslint-disable no-console */
/**
 * 🍞 TOAST NOTIFICATION UTILITIES
 * API canónica para mostrar notificaciones en toda la aplicación
 * SSR-safe wrapper para el sistema global de toasts (Toasts.astro)
 */

import type { ToastType } from '@/types/toast'

/**
 * Muestra una notificación toast
 * @param type - Tipo de notificación: 'success' | 'error' | 'warning' | 'info'
 * @param message - Mensaje a mostrar
 * @param duration - Duración en ms (opcional, usa default del sistema)
 */
export function notify(
  type: ToastType,
  message: string,
  duration?: number
): string | undefined {
  if (typeof window !== 'undefined' && window.showToast) {
    return window.showToast(type, message, duration)
  }
  console.warn('[notify] Toast system not available:', type, message)
  return undefined
}

/**
 * Helpers semánticos para mostrar toasts
 * Proporcionan una API más ergonómica para casos comunes
 */
export const toast = {
  success: (message: string, duration?: number) =>
    notify('success', message, duration),
  error: (message: string, duration?: number) =>
    notify('error', message, duration),
  warning: (message: string, duration?: number) =>
    notify('warning', message, duration),
  info: (message: string, duration?: number) =>
    notify('info', message, duration),
} as const
