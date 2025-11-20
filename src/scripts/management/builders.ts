export {}

// DOM Elements
const assignCreditsBtn = document.getElementById(
  'assign-credits-btn'
) as HTMLButtonElement | null
const assignModal = document.getElementById(
  'assign-modal'
) as HTMLDivElement | null
const assignForm = document.getElementById(
  'assign-form'
) as HTMLFormElement | null
const builderUsernameInput = document.getElementById(
  'builder-username'
) as HTMLInputElement | null
const creditsAmountInput = document.getElementById(
  'credits-amount'
) as HTMLInputElement | null
const assignError = document.getElementById(
  'assign-error'
) as HTMLDivElement | null
const cancelBtn = document.getElementById(
  'cancel-btn'
) as HTMLButtonElement | null
const submitBtn = document.getElementById(
  'submit-btn'
) as HTMLButtonElement | null

const successModal = document.getElementById(
  'success-modal'
) as HTMLDivElement | null
const successUsername = document.getElementById(
  'success-username'
) as HTMLSpanElement | null
const successAmount = document.getElementById(
  'success-amount'
) as HTMLSpanElement | null
const successUsernameRepeat = document.getElementById(
  'success-username-repeat'
) as HTMLSpanElement | null
const successCloseBtn = document.getElementById(
  'success-close-btn'
) as HTMLButtonElement | null

// Event Listeners for Main "Assign Credits" Button
if (assignCreditsBtn && assignModal) {
  assignCreditsBtn.addEventListener('click', () => {
    openModal()
  })
}

// Event Listeners for Modal Actions
if (cancelBtn && assignModal) {
  cancelBtn.addEventListener('click', () => {
    closeModal()
  })
}

if (assignModal) {
  // Close on click outside
  assignModal.addEventListener('click', e => {
    if (e.target === assignModal) {
      closeModal()
    }
  })
}

// Event Listeners for Success Modal
if (successCloseBtn && successModal) {
  successCloseBtn.addEventListener('click', () => {
    successModal.classList.add('hidden')
    window.location.reload()
  })
}

// Handle Form Submission
if (assignForm) {
  assignForm.addEventListener('submit', async e => {
    e.preventDefault()

    if (
      !builderUsernameInput ||
      !creditsAmountInput ||
      !assignError ||
      !submitBtn
    )
      return

    const username = builderUsernameInput.value.trim().toLowerCase()
    const amount = parseInt(creditsAmountInput.value)

    if (!username || username.length < 3) {
      showError('El nombre de usuario debe tener al menos 3 caracteres')
      return
    }

    if (isNaN(amount) || amount < 1 || amount > 100) {
      showError('La cantidad debe estar entre 1 y 100')
      return
    }

    // Reset UI
    assignError.classList.add('hidden')
    assignError.textContent = ''
    submitBtn.disabled = true
    submitBtn.textContent = 'Procesando...'

    try {
      // First try to assign credits (PATCH)
      let response = await fetch(`/api/management/users/${username}/credits`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ amount }),
      })

      // If user not found (404), try to create user (POST)
      if (response.status === 404) {
        console.log('User not found, creating new builder...')
        response = await fetch('/api/management/users', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            hive_username: username,
            amount: amount,
          }),
        })
      }

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Error al procesar la solicitud')
      }

      // Success!
      closeModal()
      showSuccessModal(username, amount)
    } catch (error: any) {
      console.error('Error:', error)
      showError(error.message || 'Ocurrió un error inesperado')
    } finally {
      submitBtn.disabled = false
      submitBtn.textContent = 'Asignar Créditos'
    }
  })
}

// Handle Table Actions (Assign & Delete)
document.addEventListener('click', async e => {
  const target = e.target as HTMLElement
  const button = target.closest('button')

  if (!button) return

  // Handle "Assign" button in table row
  if (button.dataset.action === 'assign-credits') {
    const username = button.dataset.username
    if (username) {
      openModal(username)
    }
  }

  // Handle "Delete" button in table row
  if (button.dataset.action === 'delete-builder') {
    const builderId = button.dataset.builderId
    if (builderId) {
      if (
        confirm(
          '¿Estás seguro de que deseas eliminar este builder? Esta acción no se puede deshacer.'
        )
      ) {
        try {
          const response = await fetch(
            `/api/management/users?id=${builderId}`,
            {
              method: 'DELETE',
            }
          )

          if (response.ok) {
            window.location.reload()
          } else {
            const data = await response.json()
            alert(data.error || 'Error al eliminar el builder')
          }
        } catch (error) {
          console.error('Error deleting builder:', error)
          alert('Error de conexión al eliminar el builder')
        }
      }
    }
  }
})

// Helper Functions
function openModal(username: string = '') {
  if (
    !assignModal ||
    !builderUsernameInput ||
    !creditsAmountInput ||
    !assignError
  )
    return

  builderUsernameInput.value = username
  creditsAmountInput.value = '10' // Default value
  assignError.classList.add('hidden')
  assignError.textContent = ''

  assignModal.classList.remove('hidden')
  assignModal.classList.add('flex') // Ensure flex display for centering

  if (username) {
    creditsAmountInput.focus()
  } else {
    builderUsernameInput.focus()
  }
}

function closeModal() {
  if (!assignModal) return
  assignModal.classList.add('hidden')
  assignModal.classList.remove('flex')
}

function showError(message: string) {
  if (!assignError) return
  assignError.textContent = message
  assignError.classList.remove('hidden')
}

function showSuccessModal(username: string, amount: number) {
  if (
    !successModal ||
    !successUsername ||
    !successAmount ||
    !successUsernameRepeat
  )
    return

  successUsername.textContent = username
  successAmount.textContent = amount.toString()
  successUsernameRepeat.textContent = username

  successModal.classList.remove('hidden')
  successModal.classList.add('flex')
}
