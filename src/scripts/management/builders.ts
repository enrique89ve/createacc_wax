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
const editRefreshBtn = document.getElementById(
  'edit-refresh-btn'
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

if (editRefreshBtn) {
  editRefreshBtn.addEventListener('click', () => window.location.reload())
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
    ) {
      return
    }

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
      const response = await fetch(
        `/api/management/users/${username}/credits`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ amount }),
        }
      )

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Error al procesar la solicitud')
      }

      // Success!
      closeModal()
      showSuccessModal(username, amount)
    } catch (error: unknown) {
      console.error('Error:', error)
      displayError(
        assignError,
        error instanceof Error ? error.message : 'Ocurrió un error inesperado'
      )
    } finally {
      submitBtn.disabled = false
      submitBtn.textContent = 'Asignar Créditos'
    }
  })
}

// Handle Table Actions (Assign, Edit)
document.addEventListener('click', async e => {
  const target = e.target as HTMLElement
  const button = target.closest('button')

  if (!button) return

  if (button.dataset.action === 'assign-credits') {
    const username = button.dataset.username
    if (username) {
      openModal(username)
    }
  }

  if (button.dataset.action === 'edit-credits') {
    const username = button.dataset.username
    const available = button.dataset.available
    const pending = button.dataset.pending
    const revision = Number(button.dataset.revision)
    if (username && Number.isSafeInteger(revision) && revision >= 0) {
      openEditModal(
        username,
        Number(available) || 0,
        Number(pending) || 0,
        revision
      )
    }
  }

  if (button.dataset.action === 'ban-builder') {
    const username = button.dataset.username
    if (!username) return
    if (
      !confirm(
        `¿Bloquear a @${username} por abuso?\n\nNo podrá iniciar sesión. Créditos, tickets e historial se conservan.`
      )
    ) {
      return
    }

    try {
      const response = await fetch(
        `/api/management/users?id=${encodeURIComponent(username)}`,
        { method: 'DELETE' }
      )
      if (response.ok) {
        window.location.reload()
        return
      }
      const data = await response.json()
      alert(data.error || 'Error al bloquear el username')
    } catch (error) {
      console.error('Error blocking hive username:', error)
      alert('Error de conexión al bloquear el username')
    }
  }

  if (button.dataset.action === 'reactivate-builder') {
    const username = button.dataset.username
    if (!username) return
    if (
      !confirm(
        `¿Reactivar a @${username}?\n\nPodrá volver a iniciar sesión con Keychain.`
      )
    ) {
      return
    }

    try {
      const response = await fetch(
        `/api/management/users/${encodeURIComponent(username)}/reactivate`,
        { method: 'POST' }
      )
      if (response.ok) {
        window.location.reload()
        return
      }
      const data = await response.json()
      alert(data.error || 'Error al reactivar el username')
    } catch (error) {
      console.error('Error unblocking hive username:', error)
      alert('Error de conexión al reactivar el username')
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
  ) {
    return
  }

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
  ) {
    return
  }

  successUsername.textContent = username
  successAmount.textContent = amount.toString()
  successUsernameRepeat.textContent = username

  successModal.classList.remove('hidden')
  successModal.classList.add('flex')
}

// ===== Edit Modal Functions =====

function openEditModal(
  username: string,
  available: number,
  pending: number,
  revision: number
) {
  if (
    !editModal ||
    !editUsernameInput ||
    !editUsernameDisplay ||
    !editAvailableCreditsInput ||
    !editPendingCreditsInput ||
    !editReasonInput ||
    !editError
  ) {
    return
  }

  editUsernameInput.value = username
  editUsernameDisplay.textContent = username
  editAvailableCreditsInput.value = available.toString()
  editPendingCreditsInput.value = pending.toString()
  editReasonInput.value = ''
  editModal.dataset.available = available.toString()
  editModal.dataset.pending = pending.toString()
  editModal.dataset.revision = revision.toString()
  if (editForm) {
    editForm.dataset.requestId = ''
    editForm.dataset.commandKey = ''
    editForm.dataset.stale = 'false'
  }
  if (editSubmitBtn) editSubmitBtn.disabled = false
  if (editRefreshBtn) editRefreshBtn.classList.add('hidden')
  editError.classList.add('hidden')
  editError.textContent = ''

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
      !editSubmitBtn ||
      !editModal
    ) {
      return
    }

    const username = editUsernameInput.value.trim().toLowerCase()
    const availableCredits = Number(editAvailableCreditsInput.value)
    const pendingCredits = Number(editPendingCreditsInput.value)
    const reason = editReasonInput.value.trim()
    const originalAvailable = Number(editModal.dataset.available)
    const originalPending = Number(editModal.dataset.pending)
    const expectedRevision = Number(editModal.dataset.revision)

    if (
      !Number.isSafeInteger(availableCredits) ||
      availableCredits < 0 ||
      availableCredits > 100000
    ) {
      displayError(
        editError,
        'Créditos disponibles debe ser un entero entre 0 y 100000'
      )
      return
    }
    if (
      !Number.isSafeInteger(pendingCredits) ||
      pendingCredits < 0 ||
      pendingCredits > 100000
    ) {
      displayError(
        editError,
        'Créditos pendientes debe ser un entero entre 0 y 100000'
      )
      return
    }
    if (reason.length === 0 || reason.length > 500) {
      displayError(editError, 'Escribe un motivo de hasta 500 caracteres')
      return
    }
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
      displayError(
        editError,
        'No se pudo verificar la versión actual del saldo'
      )
      return
    }

    const changes: {
      pending_amount?: number
      available_amount?: number
    } = {}
    if (pendingCredits !== originalPending) {
      changes.pending_amount = pendingCredits
    }
    if (availableCredits !== originalAvailable) {
      changes.available_amount = availableCredits
    }
    if (Object.keys(changes).length === 0) {
      displayError(
        editError,
        'Cambia al menos uno de los saldos antes de guardar'
      )
      return
    }

    editError.classList.add('hidden')
    editError.textContent = ''
    editSubmitBtn.disabled = true
    editSubmitBtn.textContent = 'Guardando...'

    const command = {
      ...changes,
      expected_revision: expectedRevision,
      reason,
    }
    const commandKey = JSON.stringify(command)
    let requestId = editForm.dataset.requestId
    if (!requestId || editForm.dataset.commandKey !== commandKey) {
      requestId = crypto.randomUUID()
      editForm.dataset.requestId = requestId
      editForm.dataset.commandKey = commandKey
    }

    try {
      const response = await fetch(
        `/api/management/users/${username}/credits`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ ...command, request_id: requestId }),
        }
      )

      const responseBodyValue: unknown = await response.json()
      const responseBody =
        typeof responseBodyValue === 'object' && responseBodyValue !== null
          ? (responseBodyValue as Record<string, unknown>)
          : {}
      const errorMessage =
        typeof responseBody.error === 'string'
          ? responseBody.error
          : 'Error al actualizar créditos'

      if (!response.ok) {
        if (response.status === 409) {
          editForm.dataset.stale = 'true'
          editSubmitBtn.disabled = true
          editRefreshBtn?.classList.remove('hidden')
          displayError(
            editError,
            `${errorMessage}. Recarga los saldos antes de preparar otro ajuste.`
          )
          return
        }
        throw new Error(errorMessage)
      }

      closeEditModal()
      window.location.reload()
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : 'Ocurrió un error inesperado'
      console.error('Error:', error)
      displayError(editError, errorMessage)
    } finally {
      if (editForm.dataset.stale !== 'true') {
        editSubmitBtn.disabled = false
      }
      editSubmitBtn.textContent = '💾 Guardar'
    }
  })
}
