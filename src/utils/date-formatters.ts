/**
 * Utilities for formatting dates normalized to UTC-0.
 * SQLite stores timestamps without time zone, UTC is assumed.
 */

/** Ensures that a SQLite timestamp is interpreted as UTC */
function toUtcDate(dateStr: string): Date {
	const normalized = dateStr.endsWith('Z') ? dateStr : `${dateStr}Z`
	return new Date(normalized)
}

/** Short date: "10 feb 2026" */
export function formatDate(dateStr: string): string {
	return toUtcDate(dateStr).toLocaleDateString('es-ES', {
		day: 'numeric',
		month: 'short',
		year: 'numeric',
		timeZone: 'UTC',
	})
}

/** Date with time: "10 feb 2026, 04:09" */
export function formatDateTime(dateStr: string): string {
	return toUtcDate(dateStr).toLocaleDateString('es-ES', {
		day: 'numeric',
		month: 'short',
		year: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
		timeZone: 'UTC',
	})
}

/** Date with time and seconds: "10 feb 2026, 04:09:32" */
export function formatDateTimeFull(dateStr: string): string {
	return toUtcDate(dateStr).toLocaleDateString('es-ES', {
		day: 'numeric',
		month: 'short',
		year: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
		timeZone: 'UTC',
	})
}

/** Time only: "04:09" */
export function formatTime(dateStr: string): string {
	return toUtcDate(dateStr).toLocaleTimeString('es-ES', {
		hour: '2-digit',
		minute: '2-digit',
		timeZone: 'UTC',
	})
}

/** Relative date: "Today", "Yesterday", "3 days ago", or formatted date */
export function formatRelativeDate(dateStr: string): string {
	const date = toUtcDate(dateStr)
	const now = new Date()
	const diffMs = now.getTime() - date.getTime()
	const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

	if (diffDays <= 0) return 'Hoy'
	if (diffDays === 1) return 'Ayer'
	if (diffDays < 7) return `Hace ${diffDays} días`

	return formatDate(dateStr)
}

/** Short date for tables: "10 feb, 04:09" (without year) */
export function formatShortDateTime(dateStr: string): string {
	return toUtcDate(dateStr).toLocaleDateString('es-ES', {
		day: 'numeric',
		month: 'short',
		hour: '2-digit',
		minute: '2-digit',
		timeZone: 'UTC',
	})
}
