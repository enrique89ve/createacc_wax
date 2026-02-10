/**
 * Utilidades de formateo de fechas normalizadas a UTC-0.
 * SQLite almacena timestamps sin zona horaria, se asume UTC.
 */

/** Asegura que un timestamp de SQLite sea interpretado como UTC */
function toUtcDate(dateStr: string): Date {
	const normalized = dateStr.endsWith('Z') ? dateStr : `${dateStr}Z`
	return new Date(normalized)
}

/** Fecha corta: "10 feb 2026" */
export function formatDate(dateStr: string): string {
	return toUtcDate(dateStr).toLocaleDateString('es-ES', {
		day: 'numeric',
		month: 'short',
		year: 'numeric',
		timeZone: 'UTC',
	})
}

/** Fecha con hora: "10 feb 2026, 04:09" */
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

/** Fecha con hora y segundos: "10 feb 2026, 04:09:32" */
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

/** Solo hora: "04:09" */
export function formatTime(dateStr: string): string {
	return toUtcDate(dateStr).toLocaleTimeString('es-ES', {
		hour: '2-digit',
		minute: '2-digit',
		timeZone: 'UTC',
	})
}

/** Fecha relativa: "Hoy", "Ayer", "Hace 3 días", o fecha formateada */
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

/** Fecha corta para tablas: "10 feb, 04:09" (sin año) */
export function formatShortDateTime(dateStr: string): string {
	return toUtcDate(dateStr).toLocaleDateString('es-ES', {
		day: 'numeric',
		month: 'short',
		hour: '2-digit',
		minute: '2-digit',
		timeZone: 'UTC',
	})
}
