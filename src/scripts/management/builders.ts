declare global {
  interface Window {
    deleteBuilder?: (builderId: number) => Promise<void>
    assignMoreCredits?: (username: string) => void
  }
}

const assignBtn = document.getElementById('assign-credits-btn')
const assignModal = document.getElementById('assign-modal')
const assignForm = document.getElementById(
  'assign-form'
) as HTMLFormElement | null
const cancelBtn = document.getElementById('cancel-btn')
const assignError = document.getElementById('assign-error')
const successModal = document.getElementById('success-modal')
const successCloseBtn = document.getElementById('success-close-btn')

function refreshBuildersList(): void {
  window.location.reload()
}

function showAssignModal(prefillUsername?: string): void {
  assignModal?.classList.remove('hidden')
  assignModal?.classList.add('flex')

  if (prefillUsername) {
    const usernameInput = document.getElementById(
      'builder-username'
    ) as HTMLInputElement | null
    if (usernameInput) {
      usernameInput.value = prefillUsername
      usernameInput.readOnly = true
    }
    const creditsInput = document.getElementById(
      'credits-amount'
    ) as HTMLInputElement | null
    creditsInput?.focus()
  }
}

function hideAssignModal(): void {
  assignModal?.classList.add('hidden')
  assignModal?.classList.remove('flex')
  assignForm?.reset()
  assignError?.classList.add('hidden')

  const usernameInput = document.getElementById(
    'builder-username'
  ) as HTMLInputElement | null
  if (usernameInput) {
    usernameInput.readOnly = false
  }
}

function showSuccessModal(username: string, amount: number): void {
  const usernameEl = document.getElementById('success-username')
  const usernameRepeatEl = document.getElementById('success-username-repeat')
  const amountEl = document.getElementById('success-amount')

  if (usernameEl) {
    usernameEl.textContent = username
  }
  if (usernameRepeatEl) {
    usernameRepeatEl.textContent = username
  }
  if (amountEl) {
    amountEl.textContent = amount.toString()
  }

  successModal?.classList.remove('hidden')
  successModal?.classList.add('flex')
}

function hideSuccessModal(): void {
  successModal?.classList.add('hidden')
  successModal?.classList.remove('flex')
}

function showError(message: string): void {
  if (assignError) {
    assignError.textContent = message
    assignError.classList.remove('hidden')
  }
}

assignBtn?.addEventListener('click', () => showAssignModal())
cancelBtn?.addEventListener('click', hideAssignModal)
successCloseBtn?.addEventListener('click', () => {
  hideSuccessModal()
  refreshBuildersList()
})

assignModal?.addEventListener('click', event => {
  if (event.target === assignModal) {
    hideAssignModal()
  }
})

successModal?.addEventListener('click', event => {
  if (event.target === successModal) {
    hideSuccessModal()
    refreshBuildersList()
  }
})

assignForm?.addEventListener('submit', async event => {
  event.preventDefault()

  const usernameInput = document.getElementById(
    'builder-username'
  ) as HTMLInputElement | null
  const hiveUsername = usernameInput?.value.trim().toLowerCase() ?? ''

  const creditsInput = document.getElementById(
    'credits-amount'
  ) as HTMLInputElement | null
  const creditsAmount = parseInt(creditsInput?.value ?? '0', 10)

  if (!hiveUsername || hiveUsername.length < 3) {
    showError('El username debe tener al menos 3 caracteres')
    return
  }

  if (!creditsAmount || creditsAmount < 1 || creditsAmount > 100) {
    showError('La cantidad debe estar entre 1 y 100 créditos')
    return
  }

  try {
    const response = await fetch('/api/management/credits/assign', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        hive_username: hiveUsername,
        amount: creditsAmount,
      }),
    })

    const result = (await response.json()) as {
      success?: boolean
      error?: string
      username?: string
      amount?: number
    }

    if (response.ok && result.success) {
      hideAssignModal()
      showSuccessModal(
        result.username ?? hiveUsername,
        result.amount ?? creditsAmount
      )
      return
    }

    showError(result.error ?? 'Error al asignar créditos')
  } catch (_) {
    showError('Error de conexión')
  }
})

window.deleteBuilder = async (builderId: number) => {
  if (
    !window.confirm(
      '¿Estás seguro de que quieres eliminar este builder?\n\nEsta acción no se puede deshacer y el usuario perderá acceso a crear tickets.'
    )
  ) {
    return
  }

  try {
    const response = await fetch(`/api/management/users?id=${builderId}`, {
      method: 'DELETE',
    })

    const result = (await response.json()) as {
      success?: boolean
      error?: string
    }

    if (response.ok && result.success) {
      refreshBuildersList()
      return
    }

    window.alert(result.error ?? 'Error al eliminar builder')
  } catch (_) {
    window.alert('Error de conexión')
  }
}

window.assignMoreCredits = (username: string) => {
  showAssignModal(username)
}

export {}
