/* eslint-disable no-console */
/**
 * 🎫 TICKET MODAL HANDLERS
 * Manejadores de eventos para modales de gestión de tickets con slider
 * Usa componentes Astro nativos en lugar de innerHTML
 */

import { BUILDERS_UI, MAX_TICKET_CREDITS } from '@/consts/constants'

export interface TicketData {
  id: number
  code: string
  credits: number
  original_credits: number
}

type NotifyType = 'success' | 'error' | 'info'

// Elementos del DOM
let ticketActionModal: HTMLElement | null
let updateModalContent: HTMLElement | null
let deleteModalContent: HTMLElement | null
let currentTicket: TicketData | null = null

// Caché de créditos disponibles (se actualiza al abrir el modal)
let cachedAvailableCredits: number = 0

// Elementos del modal de actualización (SLIDER)
let updateForm: HTMLFormElement | null
let updateCodeDisplay: HTMLInputElement | null
let updateCreditsDisplay: HTMLInputElement | null
let deltaSlider: HTMLInputElement | null // Cambiado de deltaInput a deltaSlider
let deltaValueDisplay: HTMLElement | null // Nuevo: display del valor
let sliderMinLabel: HTMLElement | null // Nuevo: label mínimo
let sliderMaxLabel: HTMLElement | null // Nuevo: label máximo
let availableCreditsInfo: HTMLElement | null // Nuevo: info de créditos
let previewBox: HTMLElement | null
let previewContent: HTMLElement | null
let errorMessage: HTMLElement | null
let confirmBtn: HTMLButtonElement | null

// Elementos del modal de borrado
let deleteTicketCode: HTMLElement | null
let deleteTicketCredits: HTMLElement | null
let deleteRefundAmount: HTMLElement | null

// Función de notificación (ahora acepta parámetro duration opcional)
let notify: (type: NotifyType, message: string, duration?: number) => void

export function initializeTicketModals(
  notifyFn: (type: NotifyType, message: string, duration?: number) => void
) {
  notify = notifyFn

  // Inicializar referencias a elementos
  ticketActionModal = document.getElementById('ticket-action-modal')
  updateModalContent = document.getElementById('update-modal-content')
  deleteModalContent = document.getElementById('delete-modal-content')

  updateForm = document.querySelector<HTMLFormElement>('#update-ticket-form')
  updateCodeDisplay = document.querySelector<HTMLInputElement>(
    '#update-ticket-code-display'
  )
  updateCreditsDisplay = document.querySelector<HTMLInputElement>(
    '#update-ticket-credits-display'
  )

  // Referencias al slider y sus elementos asociados
  deltaSlider = document.querySelector<HTMLInputElement>('#delta-slider')
  deltaValueDisplay = document.getElementById('delta-value-display')
  sliderMinLabel = document.getElementById('slider-min-label')
  sliderMaxLabel = document.getElementById('slider-max-label')
  availableCreditsInfo = document.getElementById('available-credits-info')

  previewBox = document.getElementById('preview-box')
  previewContent = document.getElementById('preview-content')
  errorMessage = document.getElementById('error-message')
  confirmBtn = document.querySelector<HTMLButtonElement>('#confirm-update')

  deleteTicketCode = document.getElementById('delete-ticket-code')
  deleteTicketCredits = document.getElementById('delete-ticket-credits')
  deleteRefundAmount = document.getElementById('delete-refund-amount')

  // Event listeners
  setupUpdateModalListeners()
  setupDeleteModalListeners()
  setupTicketButtons()
  setupModalCloseHandlers()
}

/**
 * Obtener créditos disponibles del builder en tiempo real
 * Hace fetch al servidor para obtener el balance actualizado
 */
async function getBuilderCredits(): Promise<number> {
  try {
    // Intentar obtener desde el servidor (datos más actualizados)
    const resp = await fetch('/api/builders/credits/balance')
    if (resp.ok) {
      const data = await resp.json()
      // El endpoint retorna: {success: true, balance: {available_amount: X}}
      return data.balance?.available_amount || 0
    }
  } catch (error) {
    console.warn('[getBuilderCredits] Error fetching from API:', error)
  }

  // Fallback: leer del DOM si el fetch falla
  const layout = document.querySelector('[data-builder-credits]')
  return parseInt(layout?.getAttribute('data-builder-credits') || '0', 10)
}

/**
 * Configurar límites dinámicos del slider basados en:
 * - Créditos actuales del ticket
 * - Créditos disponibles del builder
 * - Límite máximo de 100 créditos por ticket
 */
async function setupSlider(ticket: TicketData) {
  if (
    !deltaSlider ||
    !sliderMinLabel ||
    !sliderMaxLabel ||
    !availableCreditsInfo
  )
    return

  // Obtener créditos disponibles en tiempo real y guardar en caché
  const availableCredits = await getBuilderCredits()
  cachedAvailableCredits = availableCredits

  // Calcular límites
  const maxDecrease = ticket.credits - 1 // Mínimo 1 crédito en el ticket
  const maxIncrease = Math.min(
    availableCredits,
    MAX_TICKET_CREDITS - ticket.credits // No exceder 100 créditos
  )

  // Configurar atributos del slider
  deltaSlider.min = String(-maxDecrease)
  deltaSlider.max = String(maxIncrease)
  deltaSlider.value = '0'

  // Actualizar labels con formato claro y colores contextuales
  // Izquierda: mostrar máximo a reducir (rojo)
  sliderMinLabel.textContent = maxDecrease > 0 ? `-${maxDecrease}` : '0'
  sliderMinLabel.className =
    maxDecrease > 0 ? 'text-red-400 font-medium' : 'text-gray-600 font-medium'

  // Derecha: mostrar máximo a aumentar (verde o gris si no hay)
  if (maxIncrease > 0) {
    sliderMaxLabel.textContent = `+${maxIncrease}`
    sliderMaxLabel.className = 'text-emerald-400 font-medium'
  } else {
    sliderMaxLabel.textContent = 'sin créditos'
    sliderMaxLabel.className = 'text-gray-500 font-medium italic'
  }

  // Actualizar info de créditos disponibles
  availableCreditsInfo.textContent = String(availableCredits)

  // Actualizar display del delta
  if (deltaValueDisplay) {
    deltaValueDisplay.textContent = '0'
    deltaValueDisplay.className =
      'text-4xl font-bold tabular-nums text-white transition-all duration-150'
  }
}

export async function openUpdateModal(ticket: TicketData) {
  if (!ticketActionModal || !updateModalContent) return

  currentTicket = ticket

  // Mostrar modal de actualización, ocultar el de borrado
  updateModalContent.classList.remove('hidden')
  deleteModalContent?.classList.add('hidden')

  // Poblar campos readonly
  if (updateCodeDisplay) updateCodeDisplay.value = ticket.code
  if (updateCreditsDisplay) {
    updateCreditsDisplay.value = `${ticket.credits} / ${ticket.original_credits}`
  }

  // Configurar slider con límites dinámicos
  await setupSlider(ticket)

  // Resetear estados
  previewBox?.classList.add('hidden')
  errorMessage?.classList.add('hidden')
  if (confirmBtn) confirmBtn.disabled = false

  // Mostrar modal
  ticketActionModal.classList.remove('hidden')
  ticketActionModal.classList.add('flex')

  // Focus en el slider
  deltaSlider?.focus()
}

export function openDeleteModal(ticket: TicketData) {
  if (!ticketActionModal || !deleteModalContent) return

  currentTicket = ticket

  // Mostrar modal de borrado, ocultar el de actualización
  deleteModalContent.classList.remove('hidden')
  updateModalContent?.classList.add('hidden')

  // Poblar campos
  if (deleteTicketCode) deleteTicketCode.textContent = ticket.code
  if (deleteTicketCredits)
    deleteTicketCredits.textContent = String(ticket.original_credits)
  if (deleteRefundAmount)
    deleteRefundAmount.textContent = String(ticket.original_credits)

  // Mostrar modal
  ticketActionModal.classList.remove('hidden')
  ticketActionModal.classList.add('flex')
}

function closeModal() {
  ticketActionModal?.classList.add('hidden')
  ticketActionModal?.classList.remove('flex')
  currentTicket = null

  // Limpiar estados del slider
  if (deltaSlider) deltaSlider.value = '0'
  if (deltaValueDisplay) {
    deltaValueDisplay.textContent = '0'
    deltaValueDisplay.className =
      'text-4xl font-bold tabular-nums text-white transition-all duration-150'
  }

  previewBox?.classList.add('hidden')
  errorMessage?.classList.add('hidden')
}

function setupUpdateModalListeners() {
  if (!deltaSlider) return

  // Validación en tiempo real del slider (usa caché, NO hace fetch)
  deltaSlider.addEventListener('input', () => {
    if (!currentTicket || !deltaSlider || !deltaValueDisplay) return

    const delta = parseInt(deltaSlider.value, 10)

    // Actualizar display del valor delta
    const deltaText =
      delta === 0 ? '0' : delta > 0 ? `+${delta}` : String(delta)
    deltaValueDisplay.textContent = deltaText

    // Cambiar color según dirección
    if (delta > 0) {
      deltaValueDisplay.className =
        'text-4xl font-bold tabular-nums text-emerald-400 transition-all duration-150'
    } else if (delta < 0) {
      deltaValueDisplay.className =
        'text-4xl font-bold tabular-nums text-red-400 transition-all duration-150'
    } else {
      deltaValueDisplay.className =
        'text-4xl font-bold tabular-nums text-white transition-all duration-150'
    }

    // Si delta es 0, ocultar preview
    if (delta === 0) {
      previewBox?.classList.add('hidden')
      errorMessage?.classList.add('hidden')
      if (confirmBtn) confirmBtn.disabled = true // Deshabilitar si no hay cambios
      return
    }

    // Calcular nuevos valores
    const newCredits = currentTicket.credits + delta
    const newOriginal = currentTicket.original_credits + delta

    // Validar límites de créditos
    if (newCredits < 1 || newOriginal < 1) {
      showError(BUILDERS_UI.MESSAGES.MIN_CREDIT_REMAINING)
      return
    }

    if (newOriginal > MAX_TICKET_CREDITS) {
      showError(`Los créditos no pueden exceder ${MAX_TICKET_CREDITS}`)
      return
    }

    // Validar créditos disponibles si delta es positivo (usa caché)
    if (delta > 0 && delta > cachedAvailableCredits) {
      showError(
        `No tienes suficientes créditos. Disponibles: ${cachedAvailableCredits}`
      )
      return
    }

    // Todo OK - mostrar preview simplificado
    errorMessage?.classList.add('hidden')
    if (confirmBtn) confirmBtn.disabled = false

    if (previewContent) {
      // Usar createElement para prevenir XSS
      previewContent.textContent = ''
      const container = document.createElement('div')
      container.className = 'flex items-center justify-center gap-2 text-sm'

      const labelSpan = document.createElement('span')
      labelSpan.className = 'text-gray-400'
      labelSpan.textContent = 'El ticket tendrá:'

      const valueSpan = document.createElement('span')
      valueSpan.className = 'font-mono text-lg font-bold text-white'
      valueSpan.textContent = String(newCredits)

      const unitSpan = document.createElement('span')
      unitSpan.className = 'text-gray-500'
      unitSpan.textContent = 'créditos'

      container.appendChild(labelSpan)
      container.appendChild(valueSpan)
      container.appendChild(unitSpan)
      previewContent.appendChild(container)
    }
    previewBox?.classList.remove('hidden')
  })

  // Submit del formulario
  updateForm?.addEventListener('submit', async e => {
    e.preventDefault()
    if (!currentTicket || !deltaSlider) return

    const delta = parseInt(deltaSlider.value, 10)

    // Validar que hay cambios
    if (delta === 0) {
      notify('info', 'No hay cambios que aplicar')
      return
    }

    try {
      const resp = await fetch(
        `${BUILDERS_UI.API_ENDPOINTS.TICKETS_BY_ID}/${currentTicket.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            code: currentTicket.code,
            delta: delta,
          }),
        }
      )

      const data = await resp.json()

      if (resp.ok && data.success) {
        const deltaText = delta > 0 ? `+${delta}` : String(delta)
        notify(
          'success',
          `Créditos actualizados: ${currentTicket.credits} → ${currentTicket.credits + delta} (${deltaText})`,
          3000
        )
        closeModal()

        // Esperar 3 segundos para que el usuario vea el toast antes de recargar
        setTimeout(() => {
          location.reload()
        }, 3000)
      } else {
        notify('error', data.error || 'Error al actualizar créditos')
      }
    } catch (_error) {
      // Network error: notify user with generic message
      notify('error', BUILDERS_UI.MESSAGES.NETWORK_ERROR)
    }
  })

  // Cancelar
  document
    .getElementById('cancel-update')
    ?.addEventListener('click', closeModal)
}

function setupDeleteModalListeners() {
  // Confirmar borrado
  document
    .getElementById('confirm-delete')
    ?.addEventListener('click', async () => {
      if (!currentTicket) return

      try {
        const resp = await fetch(
          `${BUILDERS_UI.API_ENDPOINTS.TICKETS_BY_ID}/${currentTicket.id}`,
          {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              code: currentTicket.code,
            }),
          }
        )

        const data = await resp.json()

        if (resp.ok && data.success) {
          notify('success', BUILDERS_UI.MESSAGES.TICKET_DELETED, 3000)
          closeModal()

          // Esperar 3 segundos para que el usuario vea el toast antes de recargar
          setTimeout(() => {
            location.reload()
          }, 3000)
        } else {
          notify('error', data.error || 'Error al eliminar')
        }
      } catch (_error) {
        // Network error: notify user with generic message
        notify('error', BUILDERS_UI.MESSAGES.NETWORK_ERROR)
      }
    })

  // Cancelar
  document
    .getElementById('cancel-delete')
    ?.addEventListener('click', closeModal)
}

function setupTicketButtons() {
  // Event listeners para botones de actualizar
  document.querySelectorAll<HTMLElement>('.ticket-update-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      const target = e.currentTarget as HTMLElement
      const ticket: TicketData = {
        id: parseInt(target.dataset.ticketId || '0', 10),
        code: target.dataset.ticketCode || '',
        credits: parseInt(target.dataset.ticketCredits || '0', 10),
        original_credits: parseInt(target.dataset.ticketOriginal || '0', 10),
      }
      openUpdateModal(ticket)
    })
  })

  // Event listeners para botones de borrar
  document.querySelectorAll<HTMLElement>('.ticket-delete-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      const target = e.currentTarget as HTMLElement
      const ticket: TicketData = {
        id: parseInt(target.dataset.ticketId || '0', 10),
        code: target.dataset.ticketCode || '',
        credits: parseInt(target.dataset.ticketCredits || '0', 10),
        original_credits: parseInt(target.dataset.ticketOriginal || '0', 10),
      }
      openDeleteModal(ticket)
    })
  })
}

function setupModalCloseHandlers() {
  // Cerrar modal al hacer clic fuera
  ticketActionModal?.addEventListener('click', e => {
    if (e.target === ticketActionModal) {
      closeModal()
    }
  })
}

function showError(message: string) {
  if (errorMessage) {
    errorMessage.textContent = message
    errorMessage.classList.remove('hidden')
  }
  if (confirmBtn) confirmBtn.disabled = true
  previewBox?.classList.add('hidden')
}
