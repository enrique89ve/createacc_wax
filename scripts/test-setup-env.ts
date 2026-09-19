/**
 * Polyfill import.meta.env for non-Vite runtimes (tsx, Node).
 * Must be loaded before any module that reads import.meta.env.
 * Also loads .env.local / .env into process.env without overriding
 * values already present in the shell.
 */
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

if (typeof import.meta.env === 'undefined') {
  // @ts-expect-error — import.meta.env is read-only in Vite but writable in Node
  import.meta.env = { DEV: true, PROD: false, SSR: true, MODE: 'development' }
} else if (import.meta.env.SSR === undefined) {
  Object.assign(import.meta.env, { SSR: true })
}

function loadEnvFile(filename: string): void {
  const filePath = resolve(process.cwd(), filename)
  if (!existsSync(filePath)) return
  const text = readFileSync(filePath, 'utf8')
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const separator = line.indexOf('=')
    if (separator <= 0) continue
    const key = line.slice(0, separator).trim()
    let value = line.slice(separator + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (process.env[key] === undefined) process.env[key] = value
  }
}

loadEnvFile('.env.local')
loadEnvFile('.env')
