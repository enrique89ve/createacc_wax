/* eslint-disable no-console */

import { z } from 'astro/zod'
import { readApiResponse } from '@/utils/api-client'

const ManagementLoginResponseSchema = z.looseObject({
  user: z.looseObject({
    username: z.string().min(1),
    role: z.string().min(1),
  }),
})

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
      loginButton.textContent = 'Logging in...'
    }

    const formData = new FormData(form)
    const username = formData.get('username') as string
    const password = formData.get('password') as string

    try {
      // Perform full login through our proxy endpoint
      // This endpoint validates credentials AND creates the session in Auth.js
      const response = await fetch('/api/auth/management-login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username,
          password,
        }),
        credentials: 'include', // Important to receive session cookies
      })

      const result = await readApiResponse(
        response,
        ManagementLoginResponseSchema
      )

      if (!response.ok || !result.ok) {
        // Invalid credentials or error - show message and DO NOT redirect
        const errorMessage = result.ok
          ? 'Invalid credentials'
          : result.kind === 'problem'
            ? result.problem.detail
            : result.kind === 'legacy_problem'
              ? result.message
              : 'Invalid response from the server'
        showError(errorMessage)
        resetButton()
        return
      }

      // Successful login - session is already created (cookies set)
      window.location.href = '/management/console'
    } catch (error) {
      console.error('Login error:', error)
      showError('Connection error')
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
    loginButton.textContent = 'Sign In'
  }
}
