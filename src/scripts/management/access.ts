const form = document.querySelector<HTMLFormElement>('#login-form')!
const usernameInput = document.querySelector<HTMLInputElement>('#username')!
const passwordInput = document.querySelector<HTMLInputElement>('#password')!
const loginButton = document.querySelector<HTMLButtonElement>('#login-button')!
const errorMessage = document.querySelector<HTMLElement>('#error-message')!

const MAX_LOGIN_ATTEMPTS = 5
const LOCKOUT_DURATION = 15 * 60 * 1000
const ATTEMPT_WINDOW = 5 * 60 * 1000

interface LoginAttempt {
  readonly count: number
  readonly firstAttempt: number
  readonly lockedUntil?: number
}

function getAttempts(): LoginAttempt {
  const stored = localStorage.getItem('login_attempts')
  if (!stored) {
    return { count: 0, firstAttempt: Date.now() }
  }
  return JSON.parse(stored) as LoginAttempt
}

function saveAttempts(attempts: LoginAttempt): void {
  localStorage.setItem('login_attempts', JSON.stringify(attempts))
}

function resetAttempts(): void {
  localStorage.removeItem('login_attempts')
}

function showError(message: string): void {
  errorMessage.textContent = message
  errorMessage.classList.remove('hidden')
}

function hideError(): void {
  errorMessage.classList.add('hidden')
}

function checkRateLimit(): boolean {
  const attempts = getAttempts()
  const now = Date.now()

  if (attempts.lockedUntil && now < attempts.lockedUntil) {
    return false
  }

  if (now - attempts.firstAttempt > ATTEMPT_WINDOW) {
    resetAttempts()
    return true
  }

  if (attempts.count >= MAX_LOGIN_ATTEMPTS) {
    const lockUntil = now + LOCKOUT_DURATION
    saveAttempts({ ...attempts, lockedUntil: lockUntil })
    showError(
      'Demasiados intentos fallidos. Cuenta bloqueada temporalmente por 15 minutos.'
    )
    return false
  }

  return true
}

function recordFailedAttempt(): void {
  const attempts = getAttempts()
  const now = Date.now()

  if (now - attempts.firstAttempt > ATTEMPT_WINDOW) {
    saveAttempts({ count: 1, firstAttempt: now })
    return
  }

  saveAttempts({ ...attempts, count: attempts.count + 1 })
}

function setLoading(loading: boolean): void {
  if (loading) {
    loginButton.disabled = true
    loginButton.textContent = 'Iniciando sesión...'
    usernameInput.disabled = true
    passwordInput.disabled = true
    return
  }

  loginButton.disabled = false
  loginButton.textContent = 'Iniciar Sesión'
  usernameInput.disabled = false
  passwordInput.disabled = false
}

function validateUsername(username: string): boolean {
  const usernameRegex = /^[a-zA-Z0-9_-]{3,20}$/
  return usernameRegex.test(username)
}

function validatePassword(password: string): boolean {
  return password.length >= 8
}

form.addEventListener('submit', async event => {
  event.preventDefault()

  const username = usernameInput.value.trim()
  const password = passwordInput.value

  if (!username || !password) {
    showError('Por favor ingresa usuario y contraseña')
    return
  }

  if (!validateUsername(username)) {
    showError('Usuario inválido. Usa 3-20 caracteres alfanuméricos.')
    return
  }

  if (!validatePassword(password)) {
    showError('La contraseña debe tener al menos 8 caracteres')
    return
  }

  if (!checkRateLimit()) {
    return
  }

  hideError()
  setLoading(true)

  try {
    const csrfResponse = await fetch('/api/auth/csrf')
    const csrfData = (await csrfResponse.json()) as { csrfToken: string }
    const csrfToken = csrfData.csrfToken

    const response = await fetch('/api/auth/callback/management-credentials', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        username,
        password,
        csrfToken,
        callbackUrl: '/management/console',
      }),
    })

    const responseUrl = response.url
    const isRedirectToBuilders = responseUrl?.includes('/builders') ?? false

    if (response.ok && !isRedirectToBuilders) {
      resetAttempts()

      await new Promise(resolve => setTimeout(resolve, 100))

      window.location.href = '/management/console'
      return
    }

    recordFailedAttempt()

    const attempts = getAttempts()
    const remainingAttempts = MAX_LOGIN_ATTEMPTS - attempts.count

    if (remainingAttempts > 0 && remainingAttempts <= 2) {
      showError(
        `Credenciales inválidas. Te quedan ${remainingAttempts} intento(s).`
      )
      return
    }

    showError('Credenciales inválidas')
  } catch (_) {
    showError('Error de conexión. Inténtalo de nuevo.')
  } finally {
    setLoading(false)
  }
})

window.addEventListener('beforeunload', () => {
  passwordInput.value = ''
})

passwordInput.addEventListener('focus', () => {
  if (errorMessage.textContent?.includes('intento')) {
    hideError()
  }
})

usernameInput.focus()
