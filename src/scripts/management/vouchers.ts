/* eslint-disable no-console */

const copyToast = document.getElementById('copy-toast') as HTMLDivElement | null
const createTicketForm = document.getElementById(
  'admin-create-ticket-form'
) as HTMLFormElement | null
const createTicketFeedback = document.getElementById(
  'admin-ticket-feedback'
) as HTMLParagraphElement | null

type ApiPayload = Record<string, unknown>

function isRecord(value: unknown): value is ApiPayload {
  return typeof value === 'object' && value !== null
}

function showCreateTicketFeedback(message: string, isError: boolean): void {
  if (!createTicketFeedback) return

  createTicketFeedback.textContent = message
  createTicketFeedback.className = isError
    ? 'text-sm text-red-400'
    : 'text-sm text-green-400'
}

createTicketForm?.addEventListener('submit', async event => {
  event.preventDefault()

  const submitButton = createTicketForm.querySelector<HTMLButtonElement>(
    'button[type="submit"]'
  )
  const formData = new FormData(createTicketForm)
  const code = String(formData.get('code') ?? '')
    .trim()
    .toUpperCase()
  const uses = Number(formData.get('uses'))
  const description = String(formData.get('description') ?? '').trim()

  if (submitButton) submitButton.disabled = true
  showCreateTicketFeedback('Creando ticket...', false)

  try {
    const response = await fetch('/api/management/tickets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, uses, description }),
    })
    const payload: unknown = await response.json()
    const data = isRecord(payload) ? payload : {}

    if (!response.ok || data.success !== true) {
      const error =
        typeof data.error === 'string'
          ? data.error
          : 'No se pudo crear el ticket'
      showCreateTicketFeedback(error, true)
      return
    }

    showCreateTicketFeedback('Ticket creado. Actualizando la lista...', false)
    window.setTimeout(() => window.location.reload(), 700)
  } catch (error) {
    console.error('Error creating management ticket:', error)
    showCreateTicketFeedback('Error de conexión', true)
  } finally {
    if (
      submitButton &&
      createTicketFeedback?.classList.contains('text-red-400')
    ) {
      submitButton.disabled = false
    }
  }
})

document.addEventListener('click', async event => {
  const target = event.target as HTMLElement
  const button = target.closest<HTMLButtonElement>(
    'button[data-action="copy-link"]'
  )
  if (!button) return

  const ticketCode = button.dataset.ticketCode
  if (!ticketCode) return

  try {
    const ticketUrl = `${window.location.origin}/?ticket=${ticketCode}`
    await navigator.clipboard.writeText(ticketUrl)
    showCopyToast()
  } catch (error) {
    console.error('Error copying to clipboard:', error)
    alert('Error al copiar el link')
  }
})

function showCopyToast(): void {
  if (!copyToast) return

  copyToast.classList.remove('hidden')
  window.setTimeout(() => copyToast.classList.add('hidden'), 2000)
}
