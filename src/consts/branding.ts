/**
 * Centralized Brand Identity
 *
 * All brand-related constants live here. If you fork this project,
 * this is the ONLY file you need to edit for a complete rebrand
 * (along with visual assets like favicon.svg and logos in src/assets/).
 *
 * WARNING: APP_ID and CLAIM_APP_ID are written to the Hive blockchain.
 * Changing them after deployment will break verification of previously
 * created accounts and credit claims.
 */

export const BRAND = {
  /** Display name used in UI, titles, and footers */
  NAME: 'HolaHive',

  /** Site tagline / default meta description */
  TAGLINE: 'Crea una cuenta en Hive y comienza una camino innovador en Web3.',

  /** Canonical site URL (no trailing slash) */
  URL: 'https://join.holahive.com',

  /** Alt text for logo images */
  LOGO_ALT: 'HolaHive',

  /**
   * App identifier written into json_metadata on account creation.
   * Immutable once accounts have been created on-chain.
   */
  APP_ID: 'HolaHive/1.0.0',

  /**
   * Custom JSON app id used for credit claim operations.
   * Immutable once claims have been broadcast on-chain.
   */
  CLAIM_APP_ID: 'holahiveCreateAcc',
} as const
