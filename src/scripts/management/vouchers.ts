/* eslint-disable no-console */

const copyToast = document.getElementById('copy-toast') as HTMLDivElement | null

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
    alert('Error al copiar el link')
  }
})

function showCopyToast(): void {
  if (!copyToast) return

  copyToast.classList.remove('hidden')
  window.setTimeout(() => copyToast.classList.add('hidden'), 2000)
}
