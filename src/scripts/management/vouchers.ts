declare global {
  interface Window {
    deleteTicket?: (ticketId: number) => Promise<void>
  }
}

const createBtn = document.getElementById('create-ticket-btn')
const createModal = document.getElementById('create-modal')
const createForm = document.getElementById(
  'create-form'
) as HTMLFormElement | null
const cancelBtn = document.getElementById('cancel-btn')
const createError = document.getElementById('create-error')

function showModal(): void {
  createModal?.classList.remove('hidden')
  createModal?.classList.add('flex')
}

function hideModal(): void {
  createModal?.classList.add('hidden')
  createModal?.classList.remove('flex')
  createForm?.reset()
  createError?.classList.add('hidden')
}

function showError(message: string): void {
  if (createError) {
    createError.textContent = message
    createError.classList.remove('hidden')
  }
}

createBtn?.addEventListener('click', showModal)
cancelBtn?.addEventListener('click', hideModal)

createModal?.addEventListener('click', event => {
  if (event.target === createModal) {
    hideModal()
  }
})

createForm?.addEventListener('submit', async event => {
  event.preventDefault()

  const codeInput = document.getElementById(
    'ticket-code'
  ) as HTMLInputElement | null
  const typeSelect = document.getElementById(
    'ticket-type'
  ) as HTMLSelectElement | null
  const descriptionInput = document.getElementById(
    'ticket-description'
  ) as HTMLInputElement | null
  const creditsInput = document.getElementById(
    'ticket-credits'
  ) as HTMLInputElement | null

  const code = codeInput?.value.trim().toUpperCase() ?? ''
  const type = typeSelect?.value ?? 'free'
  const description = descriptionInput?.value.trim()
  const credits = Math.max(1, parseInt(creditsInput?.value ?? '1', 10))

  if (!code) {
    showError('El código del ticket es requerido')
    return
  }

  try {
    const response = await fetch('/api/management/tickets', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ code, type, description, credits }),
    })

    const result = (await response.json()) as {
      success?: boolean
      error?: string
    }

    if (response.ok && result.success) {
      window.location.reload()
      return
    }

    showError(result.error ?? 'Error al crear ticket')
  } catch (_) {
    showError('Error de conexión')
  }
})

window.deleteTicket = async (ticketId: number) => {
  if (!window.confirm('¿Estás seguro de que quieres eliminar este ticket?')) {
    return
  }

  try {
    const response = await fetch(`/api/management/tickets/${ticketId}`, {
      method: 'DELETE',
    })

    const result = (await response.json()) as {
      success?: boolean
      error?: string
    }

    if (response.ok && result.success) {
      window.location.reload()
      return
    }

    window.alert(result.error ?? 'Error al eliminar ticket')
  } catch (_) {
    window.alert('Error de conexión')
  }
}

export {}
