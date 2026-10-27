import { z } from 'astro/zod'
import { publicCopy } from '@/i18n'

const OAuthResponse = z.object({ url: z.url() })
const IssueResponse = z.object({ kind: z.string(), url: z.string().optional() })

export function initializeInvitePage(): void {
  const root = document.getElementById('invite-page')
  if (!root || root.dataset.bound) return
  root.dataset.bound = 'true'
  const copy = publicCopy().invite
  const feedback = root.querySelector<HTMLElement>('#invite-feedback')
  const retry = root.querySelector<HTMLButtonElement>('#invite-retry')
  const buttons = [...root.querySelectorAll<HTMLButtonElement>('button')]

  function message(text: string): void {
    if (feedback) {
      feedback.textContent = text
      feedback.classList.remove('hidden')
    }
  }

  async function issue(): Promise<void> {
    if (retry) retry.disabled = true
    try {
      const response = await fetch('/api/invite/issue', { method: 'POST' })
      const result = IssueResponse.parse(await response.json())
      if (
        result.kind === 'available' &&
        result.url?.match(/^\/invite\/[a-f0-9]{64}$/)
      ) {
        window.location.replace('/invite')
        return
      }
      if (result.kind === 'processing' || result.kind === 'completed') {
        window.location.reload()
        return
      }
      message(
        result.kind === 'quota_exhausted'
          ? copy.quota
          : result.kind === 'campaign_disabled'
            ? copy.paused
            : result.kind === 'login_required'
              ? copy.loginAgain
              : copy.error
      )
      root?.querySelector('#invite-preparing')?.classList.add('hidden')
      if (
        retry &&
        result.kind !== 'quota_exhausted' &&
        result.kind !== 'campaign_disabled'
      ) {
        retry.classList.remove('hidden')
      }
    } catch {
      message(copy.error)
      retry?.classList.remove('hidden')
    } finally {
      if (retry) retry.disabled = false
    }
  }

  for (const button of root.querySelectorAll<HTMLButtonElement>(
    '[data-invite-provider]'
  )) {
    button.addEventListener('click', async () => {
      const previous = buttons.map(item => item.disabled)
      buttons.forEach(item => {
        item.disabled = true
      })
      button.setAttribute('aria-busy', 'true')
      message(copy.connecting)
      try {
        const response = await fetch('/api/invite/auth/sign-in/social', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ provider: button.dataset.inviteProvider }),
        })
        if (!response.ok) throw new Error('Social sign-in failed')
        const result = OAuthResponse.parse(await response.json())
        const destination = new URL(result.url)
        const expectedHost =
          button.dataset.inviteProvider === 'github' ? 'github.com' : 'x.com'
        if (
          destination.protocol !== 'https:' ||
          destination.hostname !== expectedHost
        ) {
          throw new Error('Unexpected provider')
        }
        window.location.assign(destination.href)
      } catch {
        message(copy.error)
        buttons.forEach((item, index) => {
          item.disabled = previous[index]
        })
        button.setAttribute('aria-busy', 'false')
      }
    })
  }
  for (const button of root.querySelectorAll<HTMLButtonElement>(
    '[data-copy-value]'
  )) {
    button.addEventListener('click', async () => {
      const value = button.dataset.copyValue
      if (!value) return
      let copied = false
      try {
        await navigator.clipboard.writeText(value)
        copied = true
      } catch {
        copied = false
      }
      message(
        copied ? (button.dataset.copySuccess ?? copy.copied) : copy.copyError
      )
    })
  }
  root.querySelector('#invite-signout')?.addEventListener('click', async () => {
    try {
      const response = await fetch('/api/invite/auth/sign-out', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
      if (!response.ok) throw new Error('Sign-out failed')
      window.location.replace('/invite')
    } catch {
      message(copy.error)
    }
  })
  retry?.addEventListener('click', issue)
  if (root.dataset.autoIssue === 'true') {
    issue().catch(() => message(copy.error))
  }
  if (new URL(window.location.href).searchParams.has('error')) {
    message(copy.error)
  }
}
