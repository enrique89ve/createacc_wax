import { z } from 'astro/zod'
import { navigate } from 'astro:transitions/client'
import { publicCopy } from '@/i18n'

const OAuthResponse = z.object({ url: z.url() })
const IssueResponse = z.object({ kind: z.string(), url: z.string().optional() })

async function replaceInvite(): Promise<void> {
  try {
    await navigate('/invite', { history: 'replace' })
  } catch {
    window.location.replace('/invite')
  }
}

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

  function setLoading(active: boolean): void {
    const login = root?.querySelector<HTMLElement>('[data-invite-panel="login"]')
    const loading = root?.querySelector<HTMLElement>('[data-invite-panel="loading"]')
    const card = document.getElementById('invite-card')
    login?.classList.toggle('hidden', active)
    loading?.classList.toggle('hidden', !active)
    if (active) loading?.removeAttribute('aria-hidden')
    else loading?.setAttribute('aria-hidden', 'true')
    if (active) card?.setAttribute('aria-busy', 'true')
    else card?.removeAttribute('aria-busy')
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
        await replaceInvite()
        return
      }
      if (result.kind === 'processing' || result.kind === 'completed') {
        await replaceInvite()
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
      root?.querySelector('[data-invite-panel="loading"]')?.classList.add('hidden')
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
      setLoading(true)
      document.getElementById('invite-loading-title')?.focus({ preventScroll: true })
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
          item.disabled = previous[index] ?? false
        })
        button.setAttribute('aria-busy', 'false')
        setLoading(false)
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
      await replaceInvite()
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
