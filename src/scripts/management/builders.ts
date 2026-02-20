/* eslint-disable no-console */
export {}

// DOM Elements - Assign Modal
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

// DOM Elements - Edit Modal
const editModal = document.getElementById('edit-modal') as HTMLDivElement | null
const editForm = document.getElementById('edit-form') as HTMLFormElement | null
const editUsernameInput = document.getElementById(
  'edit-username'
) as HTMLInputElement | null
const editUsernameDisplay = document.getElementById(
  'edit-username-display'
) as HTMLSpanElement | null
const editAvailableCreditsInput = document.getElementById(
  'edit-available-credits'
) as HTMLInputElement | null
const editPendingCreditsInput = document.getElementById(
  'edit-pending-credits'
) as HTMLInputElement | null
const editReasonInput = document.getElementById(
  'edit-reason'
) as HTMLInputElement | null
const editError = document.getElementById('edit-error') as HTMLDivElement | null
const editCancelBtn = document.getElementById(
  'edit-cancel-btn'
) as HTMLButtonElement | null
const editSubmitBtn = document.getElementById(
  'edit-submit-btn'
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

// Event Listeners for Edit Modal
if (editCancelBtn && editModal) {
  editCancelBtn.addEventListener('click', () => {
    closeEditModal()
  })
}

if (editModal) {
  editModal.addEventListener('click', e => {
    if (e.target === editModal) {
      closeEditModal()
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
      displayError(
        assignError,
        'El nombre de usuario debe tener al menos 3 caracteres'
      )
      return
    }

    if (isNaN(amount) || amount < 1 || amount > 100) {
      displayError(assignError, 'La cantidad debe estar entre 1 y 100')
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
    } catch (error: unknown) {
      console.error('Error:', error)
      displayError(assignError, error instanceof Error ? error.message : 'Ocurrió un error inesperado')
    } finally {
      submitBtn.disabled = false
      submitBtn.textContent = 'Asignar Créditos'
    }
  })
}

// Handle Table Actions (Assign, Ban, Reactivate, Edit)
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

  // Handle "Ban" button in table row (Soft Delete)
  if (button.dataset.action === 'ban-builder') {
    const builderId = button.dataset.builderId
    const username = button.dataset.username
    if (builderId) {
      if (
        confirm(
          `¿Estás seguro de que deseas BANEAR a @${username}?\n\nEsto desactivará su cuenta, pondrá sus créditos a 0 y desactivará todos sus tickets.\n\nEl historial se mantendrá y podrás reactivarlo después si es necesario.`
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
            alert(data.error || 'Error al banear el builder')
          }
        } catch (error) {
          console.error('Error banning builder:', error)
          alert('Error de conexión al banear el builder')
        }
      }
    }
  }

  // Handle "Reactivate" button in table row
  if (button.dataset.action === 'reactivate-builder') {
    const builderId = button.dataset.builderId
    const username = button.dataset.username
    if (builderId) {
      if (
        confirm(
          `¿Reactivar a @${username}?\n\nEl builder podrá volver a usar la plataforma. Necesitarás asignarle créditos nuevamente.`
        )
      ) {
        try {
          const response = await fetch(
            `/api/management/users/${builderId}/reactivate`,
            {
              method: 'POST',
            }
          )

          if (response.ok) {
            window.location.reload()
          } else {
            const data = await response.json()
            alert(data.error || 'Error al reactivar el builder')
          }
        } catch (error) {
          console.error('Error reactivating builder:', error)
          alert('Error de conexión al reactivar el builder')
        }
      }
    }
  }

  // Handle "Edit" button in table row
  if (button.dataset.action === 'edit-credits') {
    const username = button.dataset.username
    const available = button.dataset.available
    const pending = button.dataset.pending
    if (username) {
      openEditModal(username, Number(available) || 0, Number(pending) || 0)
    }
  }
})

// ===== Helper Functions =====

/**
 * Muestra un mensaje de error en un contenedor específico
 */
function displayError(container: HTMLElement | null, message: string): void {
  if (!container) return
  container.textContent = message
  container.classList.remove('hidden')
}

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

// ===== Edit Modal Functions =====

function openEditModal(username: string, available: number, pending: number) {
  if (
    !editModal ||
    !editUsernameInput ||
    !editUsernameDisplay ||
    !editAvailableCreditsInput ||
    !editPendingCreditsInput ||
    !editReasonInput ||
    !editError
  )
    return

  editUsernameInput.value = username
  editUsernameDisplay.textContent = username
  editAvailableCreditsInput.value = available.toString()
  editPendingCreditsInput.value = pending.toString()
  editReasonInput.value = ''
  editError.classList.add('hidden')
  editError.textContent = ''

  // Controlar visibilidad de créditos pendientes con data attribute
  const hasPending = pending > 0
  editModal.dataset.hasPending = hasPending.toString()

  // Ajustar required del input
  if (hasPending) {
    editPendingCreditsInput.setAttribute('required', '')
  } else {
    editPendingCreditsInput.removeAttribute('required')
  }

  editModal.classList.remove('hidden')
  editModal.classList.add('flex')
  editAvailableCreditsInput.focus()
}

function closeEditModal() {
  if (!editModal) return
  editModal.classList.add('hidden')
  editModal.classList.remove('flex')
}

// Handle Edit Form Submission
if (editForm) {
  editForm.addEventListener('submit', async e => {
    e.preventDefault()

    if (
      !editUsernameInput ||
      !editAvailableCreditsInput ||
      !editPendingCreditsInput ||
      !editReasonInput ||
      !editError ||
      !editSubmitBtn
    )
      return

    const username = editUsernameInput.value.trim().toLowerCase()
    const availableCredits = parseInt(editAvailableCreditsInput.value)
    const pendingCredits = parseInt(editPendingCreditsInput.value)
    const reason = editReasonInput.value.trim()

    // Validation
    if (isNaN(availableCredits) || availableCredits < 0) {
      displayError(editError, 'Créditos disponibles debe ser un número >= 0')
      return
    }

    if (isNaN(pendingCredits) || pendingCredits < 0) {
      displayError(editError, 'Créditos pendientes debe ser un número >= 0')
      return
    }

    if (availableCredits > 100000 || pendingCredits > 100000) {
      displayError(editError, 'El valor máximo permitido es 100000')
      return
    }

    // Reset UI
    editError.classList.add('hidden')
    editError.textContent = ''
    editSubmitBtn.disabled = true
    editSubmitBtn.textContent = 'Guardando...'

    try {
      const response = await fetch(
        `/api/management/users/${username}/credits`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            available_amount: availableCredits,
            pending_amount: pendingCredits,
            reason: reason || 'Ajuste manual desde panel admin',
          }),
        }
      )

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Error al actualizar créditos')
      }

      // Success - reload page to show updated values
      closeEditModal()
      window.location.reload()
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : 'Ocurrió un error inesperado'
      console.error('Error:', error)
      displayError(editError, errorMessage)
    } finally {
      editSubmitBtn.disabled = false
      editSubmitBtn.textContent = '💾 Guardar'
    }
  })
}
