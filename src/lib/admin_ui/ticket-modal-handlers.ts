/* eslint-disable no-console */
/**
 * 🎫 TICKET MODAL HANDLERS
 * Event handlers for ticket management modals with slider
 * Uses native Astro components instead of innerHTML
 */

import { BUILDERS_UI, MAX_TICKET_CREDITS } from '@/consts/constants'

export interface TicketData {
  id: number
  code: string
  credits: number
  original_credits: number
}

type NotifyType = 'success' | 'error' | 'info'

// DOM Elements
let ticketActionModal: HTMLElement | null
let updateModalContent: HTMLElement | null
let deleteModalContent: HTMLElement | null
let currentTicket: TicketData | null = null

// Available credits cache (updated when opening modal)
let cachedAvailableCredits: number = 0

// Update modal elements (SLIDER)
let updateForm: HTMLFormElement | null
let updateCodeDisplay: HTMLInputElement | null
let updateCreditsDisplay: HTMLInputElement | null
let deltaSlider: HTMLInputElement | null // Changed from deltaInput to deltaSlider
let deltaValueDisplay: HTMLElement | null // New: value display
let sliderMinLabel: HTMLElement | null // New: minimum label
let sliderMaxLabel: HTMLElement | null // New: maximum label
let availableCreditsInfo: HTMLElement | null // New: credits info
let previewBox: HTMLElement | null
let previewContent: HTMLElement | null
let errorMessage: HTMLElement | null
let confirmBtn: HTMLButtonElement | null

// Delete modal elements
let deleteTicketCode: HTMLElement | null
let deleteTicketCredits: HTMLElement | null
let deleteRefundAmount: HTMLElement | null

// Notification function (now accepts optional duration parameter)
let notify: (type: NotifyType, message: string, duration?: number) => void

export function initializeTicketModals(
  notifyFn: (type: NotifyType, message: string, duration?: number) => void
) {
  notify = notifyFn

  // Initialize element references
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

  // Slider references and associated elements
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
 * Get available builder credits in real time
 * Fetches the server to get updated balance
 */
async function getBuilderCredits(): Promise<number> {
  try {
    // Try to get from server (most recent data)
    const resp = await fetch('/api/builders/credits/balance')
    if (resp.ok) {
      const data = await resp.json()
      // The endpoint returns: {success: true, balance: {available_amount: X}}
      return data.balance?.available_amount || 0
    }
  } catch (error) {
    console.warn('[getBuilderCredits] Error fetching from API:', error)
  }

  // Fallback: read from DOM if fetch fails
  const layout = document.querySelector('[data-builder-credits]')
  return parseInt(layout?.getAttribute('data-builder-credits') || '0', 10)
}

/**
 * Configure dynamic slider limits based on:
 * - Current ticket credits
 * - Available builder credits
 * - Maximum limit of 100 credits per ticket
 */
async function setupSlider(ticket: TicketData) {
  if (
    !deltaSlider ||
    !sliderMinLabel ||
    !sliderMaxLabel ||
    !availableCreditsInfo
  )
    return

  // Get real-time available credits and cache them
  const availableCredits = await getBuilderCredits()
  cachedAvailableCredits = availableCredits

  // Calculate limits
  const maxDecrease = ticket.credits - 1 // Minimum 1 credit on the ticket
  const maxIncrease = Math.min(
    availableCredits,
    MAX_TICKET_CREDITS - ticket.credits // Do not exceed 100 credits
  )

  // Configure slider attributes
  deltaSlider.min = String(-maxDecrease)
  deltaSlider.max = String(maxIncrease)
  deltaSlider.value = '0'

  // Update labels with clear formatting and contextual colors
  // Left: show maximum to reduce (red)
  sliderMinLabel.textContent = maxDecrease > 0 ? `-${maxDecrease}` : '0'
  sliderMinLabel.className =
    maxDecrease > 0 ? 'text-red-400 font-medium' : 'text-gray-600 font-medium'

  // Right: show maximum to increase (green or gray if none)
  if (maxIncrease > 0) {
    sliderMaxLabel.textContent = `+${maxIncrease}`
    sliderMaxLabel.className = 'text-emerald-400 font-medium'
  } else {
    sliderMaxLabel.textContent = 'no credits'
    sliderMaxLabel.className = 'text-gray-500 font-medium italic'
  }

  // Update available credits info
  availableCreditsInfo.textContent = String(availableCredits)

  // Update delta display
  if (deltaValueDisplay) {
    deltaValueDisplay.textContent = '0'
    deltaValueDisplay.className =
      'text-4xl font-bold tabular-nums text-white transition-all duration-150'
  }
}

export async function openUpdateModal(ticket: TicketData) {
  if (!ticketActionModal || !updateModalContent) return

  currentTicket = ticket

  // Show update modal, hide delete modal
  updateModalContent.classList.remove('hidden')
  deleteModalContent?.classList.add('hidden')

  // Populate readonly fields
  if (updateCodeDisplay) updateCodeDisplay.value = ticket.code
  if (updateCreditsDisplay) {
    updateCreditsDisplay.value = `${ticket.credits} / ${ticket.original_credits}`
  }

  // Configure slider with dynamic limits
  await setupSlider(ticket)

  // Reset states
  previewBox?.classList.add('hidden')
  errorMessage?.classList.add('hidden')
  if (confirmBtn) confirmBtn.disabled = false

  // Show modal
  ticketActionModal.classList.remove('hidden')
  ticketActionModal.classList.add('flex')

  // Focus on slider
  deltaSlider?.focus()
}

export function openDeleteModal(ticket: TicketData) {
  if (!ticketActionModal || !deleteModalContent) return

  currentTicket = ticket

  // Show delete modal, hide update modal
  deleteModalContent.classList.remove('hidden')
  updateModalContent?.classList.add('hidden')

  // Populate fields
  if (deleteTicketCode) deleteTicketCode.textContent = ticket.code
  if (deleteTicketCredits)
    deleteTicketCredits.textContent = String(ticket.original_credits)
  if (deleteRefundAmount)
    deleteRefundAmount.textContent = String(ticket.original_credits)

  // Show modal
  ticketActionModal.classList.remove('hidden')
  ticketActionModal.classList.add('flex')
}

function closeModal() {
  ticketActionModal?.classList.add('hidden')
  ticketActionModal?.classList.remove('flex')
  currentTicket = null

  // Clear slider states
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

  // Real-time slider validation (uses cache, DOES NOT fetch)
  deltaSlider.addEventListener('input', () => {
    if (!currentTicket || !deltaSlider || !deltaValueDisplay) return

    const delta = parseInt(deltaSlider.value, 10)

    // Update delta value display
    const deltaText =
      delta === 0 ? '0' : delta > 0 ? `+${delta}` : String(delta)
    deltaValueDisplay.textContent = deltaText

    // Change color depending on direction
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

    // If delta is 0, hide preview
    if (delta === 0) {
      previewBox?.classList.add('hidden')
      errorMessage?.classList.add('hidden')
      if (confirmBtn) confirmBtn.disabled = true // Disable if there are no changes
      return
    }

    // Calculate new values
    const newCredits = currentTicket.credits + delta
    const newOriginal = currentTicket.original_credits + delta

    // Validate credit limits
    if (newCredits < 1 || newOriginal < 1) {
      showError(BUILDERS_UI.MESSAGES.MIN_CREDIT_REMAINING)
      return
    }

    if (newOriginal > MAX_TICKET_CREDITS) {
      showError(`Credits cannot exceed ${MAX_TICKET_CREDITS}`)
      return
    }

    // Validate available credits if positive delta (uses cache)
    if (delta > 0 && delta > cachedAvailableCredits) {
      showError(
        `Not enough credits. Available: ${cachedAvailableCredits}`
      )
      return
    }

    // Everything OK - show simplified preview
    errorMessage?.classList.add('hidden')
    if (confirmBtn) confirmBtn.disabled = false

    if (previewContent) {
      // Use createElement to prevent XSS
      previewContent.textContent = ''
      const container = document.createElement('div')
      container.className = 'flex items-center justify-center gap-2 text-sm'

      const labelSpan = document.createElement('span')
      labelSpan.className = 'text-gray-400'
      labelSpan.textContent = 'Ticket will have:'

      const valueSpan = document.createElement('span')
      valueSpan.className = 'font-mono text-lg font-bold text-white'
      valueSpan.textContent = String(newCredits)

      const unitSpan = document.createElement('span')
      unitSpan.className = 'text-gray-500'
      unitSpan.textContent = 'credits'

      container.appendChild(labelSpan)
      container.appendChild(valueSpan)
      container.appendChild(unitSpan)
      previewContent.appendChild(container)
    }
    previewBox?.classList.remove('hidden')
  })

  // Form submit
  updateForm?.addEventListener('submit', async e => {
    e.preventDefault()
    if (!currentTicket || !deltaSlider) return

    const delta = parseInt(deltaSlider.value, 10)

    // Validate that there are changes
    if (delta === 0) {
      notify('info', 'No changes to apply')
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
          `Credits updated: ${currentTicket.credits} → ${currentTicket.credits + delta} (${deltaText})`,
          3000
        )
        closeModal()

        // Wait 3 seconds for the user to see the toast before reloading
        setTimeout(() => {
          location.reload()
        }, 3000)
      } else {
        notify('error', data.error || 'Error updating credits')
      }
    } catch (_error) {
      // Network error: notify user with generic message
      notify('error', BUILDERS_UI.MESSAGES.NETWORK_ERROR)
    }
  })

  // Cancel
  document
    .getElementById('cancel-update')
    ?.addEventListener('click', closeModal)
}

function setupDeleteModalListeners() {
  // Confirm delete
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

          // Wait 3 seconds for the user to see the toast before reloading
          setTimeout(() => {
            location.reload()
          }, 3000)
        } else {
          notify('error', data.error || 'Error deleting')
        }
      } catch (_error) {
        // Network error: notify user with generic message
        notify('error', BUILDERS_UI.MESSAGES.NETWORK_ERROR)
      }
    })

  // Cancel
  document
    .getElementById('cancel-delete')
    ?.addEventListener('click', closeModal)
}

function setupTicketButtons() {
  // Event listeners for update buttons
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

  // Event listeners for delete buttons
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
  // Close modal when clicking outside
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
