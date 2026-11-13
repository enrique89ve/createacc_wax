/* eslint-disable no-console */

import { z } from 'astro/zod'
import { publicCopy } from '@/i18n'
import { readApiResponse } from '@/utils/api-client'

const AdminTicketCreateResponseSchema = z.looseObject({
  success: z.literal(true),
  ticketId: z.number().int().positive(),
  code: z.string().min(1),
  uses: z.number().int().positive(),
})

const copyToast = document.getElementById('copy-toast') as HTMLDivElement | null
const createTicketForm = document.getElementById(
  'admin-create-ticket-form'
) as HTMLFormElement | null
const createTicketFeedback = document.getElementById(
  'admin-ticket-feedback'
) as HTMLParagraphElement | null

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
  const vouchers = publicCopy().admin.vouchers
  showCreateTicketFeedback(vouchers.creating, false)

  try {
    const response = await fetch('/api/management/tickets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, uses, description }),
    })
    const result = await readApiResponse(
      response,
      AdminTicketCreateResponseSchema
    )

    if (!response.ok || !result.ok) {
      const error = !result.ok
        ? result.kind === 'problem'
          ? result.problem.detail
          : result.kind === 'legacy_problem'
            ? result.message
            : publicCopy().admin.vouchers.invalidResponse
        : publicCopy().admin.vouchers.createFailed
      showCreateTicketFeedback(error, true)
      return
    }

    showCreateTicketFeedback(publicCopy().admin.vouchers.created, false)
    window.setTimeout(() => window.location.reload(), 700)
  } catch (error) {
    console.error('Error creating management ticket:', error)
    showCreateTicketFeedback(publicCopy().admin.vouchers.connectionError, true)
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
    alert(publicCopy().admin.vouchers.connectionError)
  }
})

function showCopyToast(): void {
  if (!copyToast) return

  copyToast.classList.remove('hidden')
  window.setTimeout(() => copyToast.classList.add('hidden'), 2000)
}
