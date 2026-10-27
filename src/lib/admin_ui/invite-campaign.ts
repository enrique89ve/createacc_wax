import { z } from 'astro/zod'

const UpdateResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    settings: z.object({
      enabled: z.boolean(),
      totalLimit: z.number().int().nonnegative(),
      issuedCount: z.number().int().nonnegative(),
      revision: z.number().int().nonnegative(),
    }),
  }),
})

const ErrorResponseSchema = z.object({
  message: z.string().optional(),
  detail: z.string().optional(),
})

export function initializeInviteCampaignSettings(): void {
  const form = document.querySelector<HTMLFormElement>('#invite-campaign-form')
  if (!form || form.dataset.bound === 'true') return
  form.dataset.bound = 'true'

  const enabled = form.querySelector<HTMLInputElement>(
    '#invite-campaign-enabled'
  )
  const totalLimit = form.querySelector<HTMLInputElement>(
    '#invite-campaign-limit'
  )
  const reason = form.querySelector<HTMLInputElement>('#invite-campaign-reason')
  const button = form.querySelector<HTMLButtonElement>('button[type="submit"]')
  const feedback = form.querySelector<HTMLElement>('#invite-campaign-feedback')
  const count = form.querySelector<HTMLElement>('#invite-campaign-count')

  form.addEventListener('submit', async event => {
    event.preventDefault()
    if (!enabled || !totalLimit || !reason || !button || !feedback) return
    if (!form.reportValidity()) return

    const priorLabel = button.textContent ?? 'Guardar configuración'
    button.disabled = true
    button.setAttribute('aria-busy', 'true')
    feedback.textContent = 'Guardando…'

    try {
      const response = await fetch('/api/management/invites', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: enabled.checked,
          total_limit: Number(totalLimit.value),
          expected_revision: Number(form.dataset.revision),
          request_id: crypto.randomUUID(),
          reason: reason.value.trim(),
        }),
      })
      const payload: unknown = await response.json()
      if (!response.ok) {
        const error = ErrorResponseSchema.safeParse(payload)
        feedback.textContent = error.success
          ? (error.data.message ?? error.data.detail ?? 'No se pudo guardar.')
          : 'No se pudo guardar.'
        return
      }
      const parsed = UpdateResponseSchema.safeParse(payload)
      if (!parsed.success) {
        feedback.textContent = 'La respuesta del servidor no es válida.'
        return
      }

      const settings = parsed.data.data.settings
      form.dataset.revision = String(settings.revision)
      enabled.checked = settings.enabled
      totalLimit.value = String(settings.totalLimit)
      if (count) {
        count.textContent =
          settings.issuedCount +
          ' enlaces emitidos de ' +
          settings.totalLimit +
          '.'
      }
      feedback.textContent = 'Configuración guardada.'
      reason.value = ''
    } catch {
      feedback.textContent = 'No se pudo guardar. Inténtalo de nuevo.'
    } finally {
      button.disabled = false
      button.removeAttribute('aria-busy')
      button.textContent = priorLabel
    }
  })
}
