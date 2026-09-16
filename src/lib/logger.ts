/* eslint-disable no-console */

/**
 * Lightweight logger for server-side code.
 * Wraps console methods to satisfy ESLint no-console rule.
 */
export const logger = {
  error: (message: string, ...args: unknown[]) =>
    console.error(message, ...args),
  warn: (message: string, ...args: unknown[]) => console.warn(message, ...args),
  info: (message: string, ...args: unknown[]) => console.info(message, ...args),
} as const
