/**
 * Minimal PDF document generator (no external dependencies).
 *
 * Provides a jsPDF-compatible API surface for the subset of features
 * used by key-download-manager: text placement, font sizing,
 * word-wrapping, and output as Blob / data-URI.
 *
 * Coordinates use the same convention as jsPDF:
 *   - Units: millimetres
 *   - Origin: top-left corner of the page
 */

import { PAGE, measureText } from './pdf-constants'
import { escapePdfString, buildPdf } from './pdf-objects'

const LINE_HEIGHT_MULTIPLIER = 1.2

interface TextCommand {
	text: string
	xPt: number
	yPt: number
	fontSize: number
}

export class PdfDocument {
	private fontSize = 12
	private commands: TextCommand[] = []

	/** Set current font size in points (matches jsPDF behaviour). */
	setFontSize(size: number): void {
		this.fontSize = size
	}

	/**
	 * Place text on the page.
	 *
	 * @param content - A single string or array of strings (one per line).
	 * @param x - Horizontal position in mm from the left edge.
	 * @param y - Vertical position in mm from the top edge.
	 */
	text(content: string | string[], x: number, y: number): void {
		const lines = Array.isArray(content) ? content : [content]
		const lineHeightPt = this.fontSize * LINE_HEIGHT_MULTIPLIER
		const xPt = x * PAGE.MM_TO_PT
		let yPt = PAGE.HEIGHT_PT - y * PAGE.MM_TO_PT

		for (const line of lines) {
			this.commands.push({
				text: line,
				xPt,
				yPt,
				fontSize: this.fontSize,
			})
			yPt -= lineHeightPt
		}
	}

	/**
	 * Word-wrap text to fit within `maxWidth` mm.
	 * Returns an array of lines (same as jsPDF.splitTextToSize).
	 */
	splitTextToSize(text: string, maxWidth: number): string[] {
		const maxWidthPt = maxWidth * PAGE.MM_TO_PT
		if (maxWidthPt <= 0) return ['']

		const lines: string[] = []
		const paragraphs = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')

		for (const paragraph of paragraphs) {
			if (paragraph.trim().length === 0) {
				lines.push('')
				continue
			}

			const words = paragraph.trim().split(/\s+/)
			let currentLine = ''

			for (const word of words) {
				if (measureText(word, this.fontSize) > maxWidthPt) {
					if (currentLine) {
						lines.push(currentLine)
						currentLine = ''
					}

					const chunks = this.splitWordToSize(word, maxWidthPt)
					for (let i = 0; i < chunks.length - 1; i++) {
						lines.push(chunks[i])
					}
					currentLine = chunks[chunks.length - 1] ?? ''
					continue
				}

				const candidate = currentLine ? `${currentLine} ${word}` : word
				if (measureText(candidate, this.fontSize) <= maxWidthPt) {
					currentLine = candidate
				} else {
					lines.push(currentLine)
					currentLine = word
				}
			}

			if (currentLine) lines.push(currentLine)
		}

		return lines.length > 0 ? lines : ['']
	}

	/** Page width in mm (A4 = 210). Replaces `doc.internal.pageSize.getWidth()`. */
	getPageWidth(): number {
		return PAGE.WIDTH_PT / PAGE.MM_TO_PT
	}

	/** Build the PDF content stream from accumulated text commands. */
	private buildContentStream(): string {
		if (this.commands.length === 0) return ''

		const parts: string[] = ['BT']
		let prevFontSize = -1

		for (const cmd of this.commands) {
			if (cmd.fontSize !== prevFontSize) {
				parts.push(`/F1 ${cmd.fontSize} Tf`)
				prevFontSize = cmd.fontSize
			}
			const x = cmd.xPt.toFixed(2)
			const y = cmd.yPt.toFixed(2)
			parts.push(`1 0 0 1 ${x} ${y} Tm`)
			parts.push(`(${escapePdfString(cmd.text)}) Tj`)
		}

		parts.push('ET')
		return parts.join('\n')
	}

	private splitWordToSize(word: string, maxWidthPt: number): string[] {
		const chunks: string[] = []
		let currentChunk = ''

		for (const character of word) {
			const candidate = `${currentChunk}${character}`
			if (currentChunk && measureText(candidate, this.fontSize) > maxWidthPt) {
				chunks.push(currentChunk)
				currentChunk = character
			} else {
				currentChunk = candidate
			}
		}

		if (currentChunk) chunks.push(currentChunk)
		return chunks.length > 0 ? chunks : ['']
	}

	/** Generate the complete PDF as a Blob. Replaces `doc.output('blob')`. */
	toBlob(): Blob {
		const pdfString = buildPdf(this.buildContentStream())
		// Convert string to binary (Latin-1) — each char maps 1:1 to a byte
		const bytes = new Uint8Array(pdfString.length)
		for (let i = 0; i < pdfString.length; i++) {
			bytes[i] = pdfString.charCodeAt(i)
		}
		return new Blob([bytes], { type: 'application/pdf' })
	}

	/** Generate the PDF as a data-URI string. Replaces `doc.output('datauristring')`. */
	toDataUri(): string {
		const pdfString = buildPdf(this.buildContentStream())
		// btoa expects a binary string (each char ≤ 255)
		const base64 = btoa(pdfString)
		return `data:application/pdf;filename=generated.pdf;base64,${base64}`
	}
}
