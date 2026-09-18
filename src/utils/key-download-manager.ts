import { PdfDocument } from '@/lib/pdf'
import { interpolate, publicCopy } from '@/i18n'

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

type KeyRole = keyof KeysData['privateKeys']

export interface KeysContent {
  readonly username: string
  readonly title: string
  readonly keys: KeysData['privateKeys']
  readonly seed: {
    readonly master: string
  }
  readonly descriptions: ReturnType<typeof publicCopy>['keys']['descriptions']
  readonly roleNames: ReturnType<typeof publicCopy>['keys']['roleNames']
  readonly pdfMasterPasswordLabel: string
  readonly pdfRolesHeading: string
  readonly pdfRoleKeyTitle: string
  readonly pdfWindowTitle: string
}

export type DownloadFormat = 'txt' | 'pdf'

export class KeyDownloadManager {
  private static generateFilename(
    username: string,
    format: DownloadFormat
  ): string {
    return `hive_${username}.${format}`
  }

  private static roleLabel(
    roleNames: KeysContent['roleNames'],
    role: KeyRole | 'master'
  ): string {
    return roleNames[role as keyof typeof roleNames]
  }

  private static generateTxtContent(data: KeysData): string {
    const copy = publicCopy()
    const k = copy.keys

    return `${interpolate(k.header, { USERNAME: data.username.toUpperCase() })}
${k.generatedAtLabel} ${data.timestamp}
${k.keysetIdLabel} ${data.keysetId}

${k.keepSafe}

${k.masterKey}:
${data.masterKey}

${k.ownerKey}:
${data.privateKeys.owner}

${k.activeKey}:
${data.privateKeys.active}

${k.postingKey}:
${data.privateKeys.posting}

${k.memoKey}:
${data.privateKeys.memo}

---
${k.footer}
`
  }

  private static generateKeysContent(data: KeysData): KeysContent {
    const copy = publicCopy()
    const k = copy.keys

    return {
      username: data.username,
      title: interpolate(k.pdfTitle, { username: data.username }),
      keys: data.privateKeys,
      seed: {
        master: data.masterKey,
      },
      descriptions: k.descriptions,
      roleNames: k.roleNames,
      pdfMasterPasswordLabel: k.pdfMasterPasswordLabel,
      pdfRolesHeading: k.pdfRolesHeading,
      pdfRoleKeyTitle: k.pdfRoleKeyTitle,
      pdfWindowTitle: interpolate(k.pdfWindowTitle, {
        username: data.username,
      }),
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

    doc.setFontSize(16)
    doc.text(content.title, margin, y)
    y += 12

    doc.setFontSize(12)
    ;(Object.keys(content.keys) as KeyRole[]).forEach(role => {
      const label = KeyDownloadManager.roleLabel(content.roleNames, role)
      doc.text(`${label}: ${content.keys[role]}`, margin, y)
      y += 6
    })

    y += 10

    doc.setFontSize(14)
    doc.text(content.pdfMasterPasswordLabel, margin, y)
    y += 8
    doc.setFontSize(12)
    doc.text(content.seed.master, margin, y)
    y += 10

    doc.setFontSize(16)
    doc.text(content.pdfRolesHeading, margin, y)
    y += 8

    ;(Object.keys(content.descriptions) as Array<keyof typeof content.descriptions>).forEach(
      role => {
        doc.setFontSize(12)
        const roleLabel = KeyDownloadManager.roleLabel(content.roleNames, role)
        const title = interpolate(content.pdfRoleKeyTitle, { role: roleLabel })
        doc.text(title, margin, y)
        y += 6
        const desc = content.descriptions[role]
        const lines = doc.splitTextToSize(desc, maxLineWidth)
        doc.setFontSize(10)
        doc.text(lines, margin, y)
        y += lines.length * 6 + 4
      }
    )

    try {
      const isInSandbox = window !== window.parent
      const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)

      if (isMobile) {
        const blob = doc.toBlob()
        this.downloadBlob(blob, filename)
        return
      }

      if (isInSandbox) {
        const blob = doc.toBlob()
        const blobUrl = URL.createObjectURL(blob)
        try {
          const newWindow = window.open('', '_blank')
          if (newWindow) {
            const html = newWindow.document.documentElement
            html.innerHTML = ''

            const head = newWindow.document.createElement('head')
            const title = newWindow.document.createElement('title')
            title.textContent = content.pdfWindowTitle
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
            embed.src = blobUrl
            embed.type = 'application/pdf'
            embed.style.border = 'none'

            body.appendChild(embed)
            html.appendChild(head)
            html.appendChild(body)

            return
          }
        } catch (_error) {
          // Error opening window - handled silently
        }
        this.downloadBlob(blob, filename)
        URL.revokeObjectURL(blobUrl)
        return
      }

      const blob = doc.toBlob()
      this.downloadBlob(blob, filename)
    } catch (_error) {
      const blob = doc.toBlob()
      this.downloadBlob(blob, filename)
    }
  }

  public static async downloadKeys(
    data: KeysData,
    format: DownloadFormat
  ): Promise<void> {
    const filename = this.generateFilename(data.username, format)

    if (format === 'txt') {
      const content = this.generateTxtContent(data)
      const blob = new Blob([content], { type: 'text/plain' })
      this.downloadBlob(blob, filename)
    } else if (format === 'pdf') {
      const content = this.generateKeysContent(data)
      this.generateAndDownloadPDF(content, filename)
    } else {
      throw new Error(
        interpolate(publicCopy().messages.unsupportedFormat, { format })
      )
    }
  }
}
