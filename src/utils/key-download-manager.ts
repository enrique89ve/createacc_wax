import { PdfDocument } from '@/lib/pdf'
import { I18nManager } from './i18n'

export interface KeysData {
  readonly username: string
  readonly masterKey: string
  readonly privateKeys: {
    readonly owner: string
    readonly active: string
    readonly posting: string
    readonly memo: string
  }
  readonly publicKeys: {
    readonly owner: string
    readonly active: string
    readonly posting: string
    readonly memo: string
  }
  readonly keysetId: string
  readonly timestamp: string
}

export interface KeysContent {
  readonly title: string
  readonly keys: {
    readonly active: string
    readonly owner: string
    readonly posting: string
    readonly memo: string
  }
  readonly seed: {
    readonly master: string
  }
  readonly descriptions: {
    readonly posting: string
    readonly active: string
    readonly owner: string
    readonly memo: string
    readonly master: string
  }
}

export type DownloadFormat = 'txt' | 'pdf'

export class KeyDownloadManager {
  private static generateFilename(
    username: string,
    keysetId: string,
    format: DownloadFormat
  ): string {
    return `hive-keys-${username}-${keysetId}.${format}`
  }

  private static generateTxtContent(data: KeysData): string {
    const t = I18nManager.getTranslations()
    return `${t.keys.header.replace('{USERNAME}', data.username.toUpperCase())}
Generated: ${data.timestamp}
Keyset ID: ${data.keysetId}

${t.keys.keepSafe}

${t.keys.masterKey}:
${data.masterKey}

${t.keys.ownerKey}:
${data.privateKeys.owner}

${t.keys.activeKey}:
${data.privateKeys.active}

${t.keys.postingKey}:
${data.privateKeys.posting}

${t.keys.memoKey}:
${data.privateKeys.memo}

---
${t.keys.footer}
`
  }

  private static generateKeysContent(data: KeysData): KeysContent {
    const t = I18nManager.getTranslations()
    return {
      title: `Tu usuario: ${data.username}`,
      keys: {
        active: data.privateKeys.active,
        owner: data.privateKeys.owner,
        posting: data.privateKeys.posting,
        memo: data.privateKeys.memo,
      },
      seed: {
        master: data.masterKey,
      },
      descriptions: t.keys.descriptions,
    }
  }

  private static downloadBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.style.position = 'fixed'
    a.style.opacity = '0'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(url), 100)
  }

  private static generateAndDownloadPDF(
    content: KeysContent,
    filename: string
  ): void {
    const doc = new PdfDocument()
    let y = 10
    const margin = 20
    const pageWidth = doc.getPageWidth()
    const maxLineWidth = pageWidth - margin * 2

    // Title
    doc.setFontSize(16)
    doc.text(content.title, margin, y)
    y += 12

    // Keys
    doc.setFontSize(12)
    Object.entries(content.keys).forEach(([type, val]) => {
      doc.text(`${type.toUpperCase()}: ${val}`, margin, y)
      y += 6
    })

    y += 10

    // Master seed
    doc.setFontSize(14)
    doc.text('Master Password (Seed)', margin, y)
    y += 8
    doc.setFontSize(12)
    doc.text(content.seed.master, margin, y)
    y += 10

    // Descriptions
    doc.setFontSize(16)
    doc.text('Roles', margin, y)
    y += 8
    doc.setFontSize(12)
    Object.entries(content.descriptions).forEach(([role, desc]) => {
      const title =
        role.toUpperCase() + (role === 'master' ? ' Password:' : ' Key:')
      doc.text(title, margin, y)
      y += 6
      const lines = doc.splitTextToSize(desc, maxLineWidth)
      doc.setFontSize(10)
      doc.text(lines, margin, y)
      y += lines.length * 6 + 4
    })

    try {
      // Detectar entorno
      const isInSandbox = window !== window.parent
      const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)

      // Lógica de descarga según el entorno
      if (isMobile) {
        const blob = doc.toBlob()
        this.downloadBlob(blob, filename)
        return
      }

      if (isInSandbox) {
        const pdfData = doc.toDataUri()
        try {
          const newWindow = window.open('', '_blank')
          if (newWindow) {
            const html = newWindow.document.documentElement
            html.innerHTML = ''

            const head = newWindow.document.createElement('head')
            const title = newWindow.document.createElement('title')
            title.textContent = `Claves de ${content.title}`
            const viewport = newWindow.document.createElement('meta')
            viewport.name = 'viewport'
            viewport.content = 'width=device-width, initial-scale=1.0'
            head.appendChild(title)
            head.appendChild(viewport)

            const body = newWindow.document.createElement('body')
            body.style.margin = '0'
            body.style.padding = '0'
            body.style.height = '100vh'

            const embed = newWindow.document.createElement('embed')
            embed.width = '100%'
            embed.height = '100%'
            embed.src = pdfData
            embed.type = 'application/pdf'
            embed.style.border = 'none'

            body.appendChild(embed)
            html.appendChild(head)
            html.appendChild(body)

            return
          }
        } catch (err) {
          // Error abriendo ventana - manejado silenciosamente
        }
        // Si falla la ventana nueva, mostrar en la misma ventana
        window.location.href = pdfData
        return
      }

      // Otros dispositivos: método estándar de descarga
      const blob = doc.toBlob()
      this.downloadBlob(blob, filename)
    } catch (error) {
      // Fallback final: mostrar en la misma ventana
      const pdfData = doc.toDataUri()
      window.location.href = pdfData
    }
  }

  public static async downloadKeys(
    data: KeysData,
    format: DownloadFormat
  ): Promise<void> {
    const filename = this.generateFilename(data.username, data.keysetId, format)

    if (format === 'txt') {
      const content = this.generateTxtContent(data)
      const blob = new Blob([content], { type: 'text/plain' })
      this.downloadBlob(blob, filename)
    } else if (format === 'pdf') {
      const content = this.generateKeysContent(data)
      this.generateAndDownloadPDF(content, filename)
    } else {
      throw new Error(I18nManager.t('messages.unsupportedFormat', { format }))
    }
  }
}
