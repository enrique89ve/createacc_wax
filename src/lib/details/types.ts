import type { DownloadFormat } from '@/utils/key-download-manager'
import type { PowSolution } from '@/utils/pow-solver'
import type { ClientKeySession } from './client-key-session'

export interface ExtendedWindow {
  showToast?: (
    type: 'success' | 'error' | 'warning',
    message: string,
    duration?: number
  ) => void
  closeDownloadModal?: () => void
  handleFormatSelection?: (format: DownloadFormat) => Promise<void>
}

export interface DOMElements {
  readonly chk1: HTMLInputElement | null
  readonly chk2: HTMLInputElement | null
  readonly submitBtn: HTMLButtonElement | null
  readonly copyBtn: HTMLButtonElement | null
  readonly downloadBtn: HTMLButtonElement | null
  readonly revealBtn: HTMLButtonElement | null
  readonly loadingEl: HTMLElement | null
  readonly keysContainer: HTMLElement | null
  readonly masterKeyDisplay: HTMLElement | null
  readonly masterKeyPlaceholder: HTMLElement | null
  readonly masterKeyCopyBtn: HTMLButtonElement | null
  readonly masterKeyFeedback: HTMLElement | null
  readonly form: HTMLFormElement | null
  readonly progressModal: HTMLElement | null
  readonly progressErrorActions: HTMLElement | null
  readonly closeProgressBtn: HTMLButtonElement | null
  readonly retryKeyConfirmationBtn: HTMLButtonElement | null
  readonly keyConfirmationStatus: HTMLElement | null
}

export interface PreSolvedBundle {
  readonly pow: PowSolution
  readonly timingTokenId: string | undefined
  readonly tokenFetchedAt: number
  readonly solvedAt: number
}

export interface AppState {
  keySession: ClientKeySession | null
  masterKeyRevealed: boolean
  copyFeedbackTimeout: number | undefined
  username: string
  keysConfirmedOnServer: boolean
  ticket?: string
  preSolvedBundle: Promise<PreSolvedBundle | null> | null
}

export const KEYS_SESSION_KEY = 'hh_keys_downloaded'
export const KEYSET_SEPARATOR = '_'
