import { z } from 'astro/zod'
import { interpolate } from '@/i18n/interpolate'
import {
  decideInviteCampaignChange,
  matchesConfirmationPhrase,
  type InviteCampaignAction,
} from '@/lib/admin_ui/invite-campaign-confirmation'

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

type ConfirmCopy = {
  readonly title: string
  readonly body: string
  readonly phrase: string
  readonly confirm: string
}

function readCopy(
  dialog: HTMLElement,
  action: InviteCampaignAction
): ConfirmCopy {
  const title = dialog.dataset[`title${capitalize(action)}`]
  const body = dialog.dataset[`body${capitalize(action)}`]
  const phrase = dialog.dataset[`phrase${capitalize(action)}`]
  const confirm = dialog.dataset[`confirm${capitalize(action)}`]
  if (!title || !body || !phrase || !confirm) {
    throw new Error('Invitation confirmation copy is incomplete')
  }
  return { title, body, phrase, confirm }
}

function capitalize(action: InviteCampaignAction): string {
  return action.charAt(0).toUpperCase() + action.slice(1)
}

function focusable(dialog: HTMLElement): HTMLElement[] {
  return [
    ...dialog.querySelectorAll<HTMLElement>(
      'button, input, [href], [tabindex]'
    ),
  ].filter(element => !element.hasAttribute('disabled'))
}

export function initializeInviteCampaignSettings(): void {
  const form = document.querySelector<HTMLFormElement>('#invite-campaign-form')
  const dialog = document.querySelector<HTMLElement>('#invite-confirm-dialog')
  const panel = dialog?.querySelector<HTMLElement>('[role="dialog"]')
  if (!form || !dialog || !panel || form.dataset.bound === 'true') return

  const enabled = form.querySelector<HTMLButtonElement>(
    '#invite-campaign-enabled'
  )
  const totalLimit = form.querySelector<HTMLInputElement>(
    '#invite-campaign-limit'
  )
  const review = form.querySelector<HTMLButtonElement>(
    '#invite-campaign-review'
  )
  const feedback = form.querySelector<HTMLElement>('#invite-campaign-feedback')
  const count = form.querySelector<HTMLElement>('#invite-campaign-count')
  const statusLabel = form.querySelector<HTMLElement>(
    '#invite-campaign-status-label'
  )
  const statusDot = form.querySelector<HTMLElement>(
    '#invite-campaign-status-dot'
  )
  const draftHint = form.querySelector<HTMLElement>('#invite-campaign-draft')
  const title = dialog.querySelector<HTMLElement>('#invite-confirm-title')
  const body = dialog.querySelector<HTMLElement>('#invite-confirm-body')
  const summary = dialog.querySelector<HTMLElement>('#invite-confirm-summary')
  const phraseLabel = dialog.querySelector<HTMLElement>(
    '#invite-confirm-phrase-label'
  )
  const phraseInput = dialog.querySelector<HTMLInputElement>(
    '#invite-confirm-phrase'
  )
  const reason = dialog.querySelector<HTMLInputElement>(
    '#invite-confirm-reason'
  )
  const cancel = dialog.querySelector<HTMLButtonElement>(
    '#invite-confirm-cancel'
  )
  const confirm = dialog.querySelector<HTMLButtonElement>(
    '#invite-confirm-submit'
  )
  const dialogFeedback = dialog.querySelector<HTMLElement>(
    '#invite-confirm-feedback'
  )
  if (
    !enabled ||
    !totalLimit ||
    !review ||
    !feedback ||
    !title ||
    !body ||
    !summary ||
    !phraseLabel ||
    !phraseInput ||
    !reason ||
    !cancel ||
    !confirm
  ) {
    return
  }
  form.dataset.bound = 'true'

  let activeAction: InviteCampaignAction | null = null
  let returnFocus: HTMLElement | null = null

  function savedEnabled(): boolean {
    return form?.dataset.savedEnabled === 'true'
  }

  function savedLimit(): number {
    return Number(form?.dataset.savedLimit)
  }

  function nextEnabled(): boolean {
    return enabled?.getAttribute('aria-checked') === 'true'
  }

  function providerReady(): boolean {
    return form?.dataset.providerReady === 'true'
  }

  function say(text: string): void {
    if (!feedback) return
    feedback.textContent = text
  }

  function paintSavedStatus(): void {
    const active = savedEnabled()
    statusLabel?.replaceChildren(
      document.createTextNode(
        active
          ? (form?.dataset.statusActive ?? '')
          : (form?.dataset.statusPaused ?? '')
      )
    )
    statusDot?.classList.toggle('bg-emerald-500', active)
    statusDot?.classList.toggle('bg-muted-foreground', !active)
  }

  function paintDraftHint(): void {
    if (!draftHint) return
    const dirty =
      nextEnabled() !== savedEnabled() ||
      Number(totalLimit?.value) !== savedLimit()
    draftHint.classList.toggle('hidden', !dirty)
  }

  function setSwitch(active: boolean): void {
    enabled?.setAttribute('aria-checked', active ? 'true' : 'false')
    paintDraftHint()
  }

  function closeDialog(): void {
    dialog?.classList.add('hidden')
    dialog?.classList.remove('flex')
    dialog?.setAttribute('aria-hidden', 'true')
    document.body.style.overflow = ''
    activeAction = null
    if (phraseInput) phraseInput.value = ''
    if (reason) reason.value = ''
    if (dialogFeedback) dialogFeedback.textContent = ''
    returnFocus?.focus()
    returnFocus = null
  }

  function refreshConfirm(): void {
    if (!confirm || !phraseInput || !reason || !activeAction || !dialog) return
    const copy = readCopy(dialog, activeAction)
    const reasonText = reason.value.trim()
    const ready =
      matchesConfirmationPhrase(phraseInput.value, copy.phrase) &&
      reasonText.length > 0 &&
      reasonText.length <= 500
    confirm.disabled = !ready
  }

  function openDialog(action: InviteCampaignAction): void {
    if (
      !dialog ||
      !title ||
      !body ||
      !phraseLabel ||
      !confirm ||
      !phraseInput
    ) {
      return
    }
    const copy = readCopy(dialog, action)
    activeAction = action
    title.textContent = copy.title
    body.textContent = copy.body
    phraseLabel.textContent = interpolate(
      dialog.dataset.typeToConfirm ?? '{phrase}',
      {
        phrase: copy.phrase,
      }
    )
    confirm.textContent = copy.confirm
    phraseInput.value = ''
    if (reason) reason.value = ''
    if (dialogFeedback) dialogFeedback.textContent = ''
    paintSummary()
    refreshConfirm()
    returnFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : review
    dialog.classList.remove('hidden')
    dialog.classList.add('flex')
    dialog.removeAttribute('aria-hidden')
    document.body.style.overflow = 'hidden'
    phraseInput.focus()
  }

  function paintSummary(): void {
    if (!summary || !totalLimit) return
    summary.replaceChildren()
    const rows: ReadonlyArray<readonly [string, string]> = [
      ...(nextEnabled() === savedEnabled()
        ? []
        : [
            [
              dialog?.dataset.summaryStatus ?? '',
              `${savedEnabled() ? form?.dataset.statusActive : form?.dataset.statusPaused} → ${nextEnabled() ? form?.dataset.statusActive : form?.dataset.statusPaused}`,
            ] as const,
          ]),
      ...(Number(totalLimit.value) === savedLimit()
        ? []
        : [
            [
              dialog?.dataset.summaryLimit ?? '',
              `${savedLimit()} → ${Number(totalLimit.value)}`,
            ] as const,
          ]),
    ]
    for (const [label, value] of rows) {
      const row = document.createElement('div')
      row.className = 'flex items-baseline justify-between gap-4'
      const term = document.createElement('dt')
      term.className = 'text-muted-foreground'
      term.textContent = label
      const detail = document.createElement('dd')
      detail.className = 'text-foreground font-medium'
      detail.textContent = value
      row.append(term, detail)
      summary.append(row)
    }
  }

  async function save(): Promise<void> {
    if (
      !form ||
      !enabled ||
      !totalLimit ||
      !reason ||
      !confirm ||
      !feedback ||
      !activeAction
    ) {
      return
    }
    const copy = readCopy(dialog as HTMLElement, activeAction)
    const reasonText = reason.value.trim()
    if (
      !matchesConfirmationPhrase(phraseInput?.value ?? '', copy.phrase) ||
      reasonText.length === 0
    ) {
      return
    }

    const priorLabel = confirm.textContent ?? copy.confirm
    confirm.disabled = true
    cancel?.setAttribute('disabled', 'true')
    confirm.setAttribute('aria-busy', 'true')
    confirm.textContent = form.dataset.saving ?? priorLabel
    if (dialogFeedback) dialogFeedback.textContent = ''

    try {
      const response = await fetch('/api/management/invites', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: nextEnabled(),
          total_limit: Number(totalLimit.value),
          expected_revision: Number(form.dataset.revision),
          request_id: crypto.randomUUID(),
          reason: reasonText,
        }),
      })
      const payload: unknown = await response.json()
      if (!response.ok) {
        const error = ErrorResponseSchema.safeParse(payload)
        const message = error.success
          ? (error.data.message ??
            error.data.detail ??
            form.dataset.saveError ??
            '')
          : (form.dataset.saveError ?? '')
        if (dialogFeedback) dialogFeedback.textContent = message
        say(message)
        return
      }
      const parsed = UpdateResponseSchema.safeParse(payload)
      if (!parsed.success) {
        const message = form.dataset.invalidResponse ?? ''
        if (dialogFeedback) dialogFeedback.textContent = message
        say(message)
        return
      }

      const settings = parsed.data.data.settings
      form.dataset.revision = String(settings.revision)
      form.dataset.savedEnabled = settings.enabled ? 'true' : 'false'
      form.dataset.savedLimit = String(settings.totalLimit)
      setSwitch(settings.enabled)
      totalLimit.value = String(settings.totalLimit)
      paintSavedStatus()
      paintDraftHint()
      if (count) {
        count.textContent = interpolate(count.dataset.template ?? '', {
          issued: String(settings.issuedCount),
          total: String(settings.totalLimit),
        })
      }
      closeDialog()
      say(form.dataset.saved ?? '')
    } catch {
      const message = form.dataset.saveRetry ?? ''
      if (dialogFeedback) dialogFeedback.textContent = message
      say(message)
    } finally {
      confirm.removeAttribute('aria-busy')
      confirm.textContent = priorLabel
      cancel?.removeAttribute('disabled')
      refreshConfirm()
    }
  }

  enabled.addEventListener('click', () => {
    const turningOn = enabled.getAttribute('aria-checked') !== 'true'
    if (turningOn && !providerReady()) {
      say(form.dataset.providersRequired ?? '')
      return
    }
    setSwitch(turningOn)
    say('')
  })

  totalLimit.addEventListener('input', () => {
    paintDraftHint()
  })

  form.addEventListener('submit', event => {
    event.preventDefault()
    review.click()
  })

  review.addEventListener('click', () => {
    if (!form.reportValidity()) return
    const decision = decideInviteCampaignChange({
      savedEnabled: savedEnabled(),
      nextEnabled: nextEnabled(),
      savedLimit: savedLimit(),
      nextLimit: Number(totalLimit.value),
      providerReady: providerReady(),
    })
    if (decision.kind === 'unchanged') {
      say(form.dataset.noChanges ?? '')
      return
    }
    if (decision.kind === 'invalid_limit') {
      say(form.dataset.limitRequired ?? '')
      return
    }
    if (decision.kind === 'providers_required') {
      say(form.dataset.providersRequired ?? '')
      return
    }
    say('')
    openDialog(decision.action)
  })

  phraseInput.addEventListener('input', refreshConfirm)
  reason.addEventListener('input', refreshConfirm)
  cancel.addEventListener('click', closeDialog)
  confirm.addEventListener('click', () => {
    save().catch(() => {
      say(form.dataset.saveRetry ?? '')
    })
  })

  dialog.addEventListener('click', event => {
    if (event.target === dialog) closeDialog()
  })
  dialog.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault()
      closeDialog()
      return
    }
    if (
      event.key === 'Enter' &&
      event.target === phraseInput &&
      !confirm.disabled
    ) {
      event.preventDefault()
      save().catch(() => {
        say(form.dataset.saveRetry ?? '')
      })
      return
    }
    if (event.key !== 'Tab') return
    const items = focusable(panel)
    const first = items[0]
    const last = items[items.length - 1]
    if (!first || !last) return
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  })

  paintSavedStatus()
  paintDraftHint()
}
