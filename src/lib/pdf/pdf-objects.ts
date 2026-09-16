/**
 * Low-level PDF object generators (ISO 32000-1 compliant).
 *
 * Each function returns the raw string for one indirect object.
 * Object numbering:
 *   1 = Catalog, 2 = Pages, 3 = Page, 4 = Font, 5 = Content stream
 */

import { PAGE } from './pdf-constants'

/**
 * Escape a string for use inside a PDF literal string `(...)`.
 *
 * - Escapes `\`, `(`, `)`
 * - Escapes common control chars (`\n`, `\r`, `\t`, `\b`, `\f`)
 * - Encodes remaining controls and Latin-1 chars (0-31, 127-255)
 *   as octal `\NNN` so the stream stays pure ASCII and byte-length
 *   calculations are trivial.
 * - Replaces chars outside Latin-1 (>255) with `?` since Helvetica/
 *   WinAnsiEncoding cannot render them.
 */
export function escapePdfString(text: string): string {
  let result = ''
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (code === 0x5c) {
      // backslash
      result += '\\\\'
    } else if (code === 0x28) {
      // (
      result += '\\('
    } else if (code === 0x29) {
      // )
      result += '\\)'
    } else if (code === 0x08) {
      // backspace
      result += '\\b'
    } else if (code === 0x09) {
      // tab
      result += '\\t'
    } else if (code === 0x0a) {
      // line feed
      result += '\\n'
    } else if (code === 0x0c) {
      // form feed
      result += '\\f'
    } else if (code === 0x0d) {
      // carriage return
      result += '\\r'
    } else if (code >= 32 && code <= 126) {
      result += text[i]
    } else if (
      (code >= 0 && code <= 31) ||
      code === 127 ||
      (code >= 128 && code <= 255)
    ) {
      result += '\\' + code.toString(8).padStart(3, '0')
    } else {
      result += '?'
    }
  }
  return result
}

/** 1 0 obj - Document Catalog */
export function catalogObject(): string {
  return '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n'
}

/** 2 0 obj - Pages tree (single page) */
export function pagesObject(): string {
  return '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n'
}

/** 3 0 obj - Page with A4 MediaBox */
export function pageObject(): string {
  const w = PAGE.WIDTH_PT.toFixed(2)
  const h = PAGE.HEIGHT_PT.toFixed(2)
  return [
    '3 0 obj',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}]`,
    '   /Contents 5 0 R',
    '   /Resources << /Font << /F1 4 0 R >> >> >>',
    'endobj',
    '',
  ].join('\n')
}

/** 4 0 obj - Helvetica font (PDF built-in, no embedding needed) */
export function fontObject(): string {
  return '4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n'
}

/** 5 0 obj - Content stream wrapping raw PDF drawing operators */
export function contentStreamObject(stream: string): string {
  // Stream is pure ASCII after escapePdfString, so string length = byte length
  const length = stream.length
  return [
    '5 0 obj',
    `<< /Length ${length} >>`,
    'stream',
    stream,
    'endstream',
    'endobj',
    '',
  ].join('\n')
}

/**
 * Build the complete PDF byte string from a content stream.
 * Returns the full PDF file as a string (Latin-1 safe).
 */
export function buildPdf(contentStream: string): string {
  const header = '%PDF-1.4\n'

  const objects = [
    catalogObject(),
    pagesObject(),
    pageObject(),
    fontObject(),
    contentStreamObject(contentStream),
  ]

  // Track byte offsets for xref table
  const offsets: number[] = []
  let body = ''
  for (const obj of objects) {
    offsets.push(header.length + body.length)
    body += obj
  }

  const xrefOffset = header.length + body.length
  const objectCount = objects.length + 1 // includes object 0

  let xref = 'xref\n'
  xref += `0 ${objectCount}\n`
  xref += '0000000000 65535 f \n'
  for (const offset of offsets) {
    xref += `${String(offset).padStart(10, '0')} 00000 n \n`
  }

  const trailer = [
    'trailer',
    `<< /Size ${objectCount} /Root 1 0 R >>`,
    'startxref',
    String(xrefOffset),
    '%%EOF',
    '',
  ].join('\n')

  return header + body + xref + trailer
}
