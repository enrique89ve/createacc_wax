/**
 * Polyfill import.meta.env for non-Vite runtimes (tsx, Node).
 * Must be loaded before any module that reads import.meta.env.
 */
if (typeof import.meta.env === 'undefined') {
	// @ts-expect-error — import.meta.env is read-only in Vite but writable in Node
	import.meta.env = { DEV: true, PROD: false, SSR: true, MODE: 'development' }
}
