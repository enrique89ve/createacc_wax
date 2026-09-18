import type { Locale } from './locales'
import type { Messages } from './types'

declare global {
  namespace App {
    interface Locals {
      locale: Locale
      messages: Messages
    }
  }
}

export {}
