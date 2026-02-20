/* eslint-disable no-console */

const form = document.getElementById('login-form') as HTMLFormElement
const errorMessage = document.getElementById('error-message')
const loginButton = document.getElementById('login-button') as HTMLButtonElement

if (form) {
  form.addEventListener('submit', async e => {
    e.preventDefault()

    // Reset error state
    if (errorMessage) {
      errorMessage.classList.add('hidden')
      errorMessage.textContent = ''
    }

    // Disable button
    if (loginButton) {
      loginButton.disabled = true
      loginButton.textContent = 'Iniciando sesión...'
    }

    const formData = new FormData(form)
    const username = formData.get('username') as string
    const password = formData.get('password') as string

    try {
      // Realizar login completo a través de nuestro endpoint proxy
      // Este endpoint valida credenciales Y crea la sesión en Auth.js
      const response = await fetch('/api/auth/management-login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username,
          password,
        }),
        credentials: 'include', // Importante para recibir las cookies de sesión
      })

      const data = await response.json()

      if (!response.ok || !data.success) {
        // Credenciales inválidas o error - mostrar mensaje y NO redirigir
        showError(data.error || 'Credenciales inválidas')
        resetButton()
        return
      }

      // Login exitoso - la sesión ya está creada (cookies seteadas)
      window.location.href = '/management/console'
    } catch (error) {
      console.error('Login error:', error)
      showError('Error de conexión')
      resetButton()
    }
  })
}

function showError(message: string) {
  if (errorMessage) {
    errorMessage.textContent = message
    errorMessage.classList.remove('hidden')
  }
}

function resetButton() {
  if (loginButton) {
    loginButton.disabled = false
    loginButton.textContent = 'Iniciar Sesión'
  }
}
