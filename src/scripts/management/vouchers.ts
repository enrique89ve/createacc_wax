/* eslint-disable no-console */
export {}

// DOM Elements
const createTicketBtn = document.getElementById(
  'create-ticket-btn'
) as HTMLButtonElement | null
const createModal = document.getElementById(
  'create-modal'
) as HTMLDivElement | null
const createForm = document.getElementById(
  'create-form'
) as HTMLFormElement | null
const ticketCodeInput = document.getElementById(
  'ticket-code'
) as HTMLInputElement | null
const ticketDescriptionInput = document.getElementById(
  'ticket-description'
) as HTMLInputElement | null
const ticketCreditsInput = document.getElementById(
  'ticket-credits'
) as HTMLInputElement | null
const createError = document.getElementById(
  'create-error'
) as HTMLDivElement | null
const cancelBtn = document.getElementById(
  'cancel-btn'
) as HTMLButtonElement | null
const submitBtn = document.getElementById(
  'submit-btn'
) as HTMLButtonElement | null
const copyToast = document.getElementById(
  'copy-toast'
) as HTMLDivElement | null

// Event Listeners for Main "Create Ticket" Button
if (createTicketBtn && createModal) {
  createTicketBtn.addEventListener('click', () => {
    openModal()
  })
}

// Event Listeners for Modal Actions
if (cancelBtn && createModal) {
  cancelBtn.addEventListener('click', () => {
    closeModal()
  })
}

if (createModal) {
  // Close on click outside
  createModal.addEventListener('click', e => {
    if (e.target === createModal) {
      closeModal()
    }
  })
}

// Handle Form Submission
if (createForm) {
  createForm.addEventListener('submit', async e => {
    e.preventDefault()

    if (!ticketCodeInput || !ticketCreditsInput || !createError || !submitBtn)
      return

    const code = ticketCodeInput.value.trim().toUpperCase()
    const description = ticketDescriptionInput?.value.trim() || ''
    const credits = parseInt(ticketCreditsInput.value)

    if (!code || code.length < 10) {
      showError('El código debe tener al menos 10 caracteres')
      return
    }

    if (code.length > 24) {
      showError('El código no puede exceder 24 caracteres')
      return
    }

    if (!/^[a-zA-Z0-9]+$/.test(code)) {
      showError('El código solo puede contener letras y números')
      return
    }

    if (/^\d+$/.test(code)) {
      showError('El código no puede ser solo números')
      return
    }

    if (isNaN(credits) || credits < 1) {
      showError('La cantidad de créditos debe ser al menos 1')
      return
    }

    if (credits > 100) {
      showError('Los créditos no pueden exceder 100')
      return
    }

    // Reset UI
    createError.classList.add('hidden')
    createError.textContent = ''
    submitBtn.disabled = true
    submitBtn.textContent = 'Creando...'

    try {
      const response = await fetch('/api/management/tickets', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          code,
          description,
          credits,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Error al crear el ticket')
      }

      // Success!
      closeModal()
      window.location.reload()
    } catch (error: unknown) {
      console.error('Error:', error)
      showError(error instanceof Error ? error.message : 'Ocurrió un error inesperado')
    } finally {
      submitBtn.disabled = false
      submitBtn.textContent = 'Crear'
    }
  })
}

// Handle Table Actions (Delete & Copy Link)
document.addEventListener('click', async e => {
  const target = e.target as HTMLElement
  const button = target.closest('button')

  if (!button) return

  // Handle "Copy Link" button in table row
  if (button.dataset.action === 'copy-link') {
    const ticketCode = button.dataset.ticketCode
    if (ticketCode) {
      try {
        const ticketUrl = `${window.location.origin}/?ticket=${ticketCode}`
        await navigator.clipboard.writeText(ticketUrl)
        showCopyToast()
      } catch (error) {
        console.error('Error copying to clipboard:', error)
        alert('Error al copiar el link')
      }
    }
  }

  // Handle "Delete" button in table row
  if (button.dataset.action === 'delete-ticket') {
    const ticketId = button.dataset.ticketId
    if (ticketId) {
      if (
        confirm(
          '¿Estás seguro de que deseas eliminar este ticket? Esta acción no se puede deshacer.'
        )
      ) {
        try {
          const response = await fetch(`/api/management/tickets/${ticketId}`, {
            method: 'DELETE',
          })

          if (response.ok) {
            window.location.reload()
          } else {
            const data = await response.json()
            alert(data.error || 'Error al eliminar el ticket')
          }
        } catch (error) {
          console.error('Error deleting ticket:', error)
          alert('Error de conexión al eliminar el ticket')
        }
      }
    }
  }
})

// Helper Functions
function openModal() {
  if (!createModal || !ticketCodeInput || !ticketCreditsInput || !createError)
    return

  // Generate a random code suggestion
  const randomSuffix = Math.floor(Math.random() * 10000)
    .toString()
    .padStart(4, '0')
  ticketCodeInput.value = `TICKET${randomSuffix}`

  if (ticketDescriptionInput) ticketDescriptionInput.value = ''
  ticketCreditsInput.value = '1'

  createError.classList.add('hidden')
  createError.textContent = ''

  createModal.classList.remove('hidden')
  createModal.classList.add('flex')

  ticketCodeInput.focus()
}

function closeModal() {
  if (!createModal) return
  createModal.classList.add('hidden')
  createModal.classList.remove('flex')
}

function showError(message: string) {
  if (!createError) return
  createError.textContent = message
  createError.classList.remove('hidden')
}

function showCopyToast() {
  if (!copyToast) return

  copyToast.classList.remove('hidden')

  setTimeout(() => {
    copyToast.classList.add('hidden')
  }, 2000)
}
