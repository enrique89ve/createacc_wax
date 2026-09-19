import {
  validateAdminEnvironment,
  validatePublicCreationEnvironment,
} from '@/lib/env'

let publicValidated = false
let adminValidated = false

/** Validates env for public creation routes (once per process). */
export function ensurePublicCreationValidation(): void {
  if (publicValidated) return
  publicValidated = true
  validatePublicCreationEnvironment()
}

/** Validates env for admin/builder routes (includes AUTH_SECRET). */
export function ensureAdminValidation(): void {
  ensurePublicCreationValidation()
  if (adminValidated) return
  adminValidated = true
  validateAdminEnvironment()
}

/** @deprecated Use ensurePublicCreationValidation or ensureAdminValidation. */
export function ensureStartupValidation(): void {
  ensurePublicCreationValidation()
}
