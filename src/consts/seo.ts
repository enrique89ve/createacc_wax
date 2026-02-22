/**
 * SEO Constants - Centralized SEO configuration
 *
 * All brand-specific values are derived from branding.ts.
 * Edit branding.ts to rebrand the site.
 */

import { BRAND } from './branding'

/**
 * Default SEO values used across the site
 */
export const SEO_DEFAULTS = {
	SITE_TITLE: BRAND.NAME,
	SITE_DESCRIPTION: BRAND.TAGLINE,
	OG_IMAGE: `${BRAND.URL}/og.jpg`,
	SITE_URL: BRAND.URL,
} as const

/**
 * Page titles for different sections of the site
 * Use these constants to ensure consistent naming
 */
export const PAGE_TITLES = {
	// Public pages
	HOME: 'Crea una cuenta en la blockchain Hive',
	ACCOUNT_DETAILS: 'Detalles de Cuenta',
	ACCOUNT_SUCCESS: 'Cuenta Creada Exitosamente',

	// Management area
	MANAGEMENT_LOGIN: 'Acceso de Gestión',
	MANAGEMENT_CONSOLE: 'Console de Gestión',
	MANAGEMENT_TICKETS: 'Gestión de Tickets',
	MANAGEMENT_USERS: 'Gestión de Usuarios',
	MANAGEMENT_BUILDERS: 'Gestión de Builders',
	MANAGEMENT_ACTIVITY: 'Actividad del Sistema',
	MANAGEMENT_ACCOUNTS: 'Cuentas Creadas',
	MANAGEMENT_LOGS: 'Logs del Sistema',

	// Builders area
	BUILDERS_LOGIN: 'Acceso Builders',
	BUILDERS_DASHBOARD: 'Dashboard',
	BUILDERS_TICKETS: 'Mis Tickets',
	BUILDERS_ACCOUNTS: 'Mis Cuentas',
	BUILDERS_CREDITS: 'Mis Créditos',
} as const

/**
 * Title suffixes for different layout types
 * These are automatically appended by layouts
 */
export const TITLE_SUFFIXES = {
	PUBLIC: '', // No suffix for public pages
	MANAGEMENT: `${BRAND.NAME} Admin`,
	BUILDERS: `${BRAND.NAME} Builders`,
} as const

/**
 * Meta robots values for different page types
 */
export const ROBOTS_META = {
	// Standard noindex for private pages
	NOINDEX: 'noindex, nofollow',
	// Enhanced security for sensitive admin pages
	NOINDEX_SECURE: 'noindex, nofollow, noarchive, noimageindex',
	// Default for public pages (optional, usually omitted)
	INDEX: 'index, follow',
} as const
