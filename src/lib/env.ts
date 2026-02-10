/**
 * Utilidades para manejo type-safe de variables de entorno
 * Variables de entorno cargadas desde .env.local (mismo archivo para dev y prod)
 */

/**
 * Obtiene una variable de entorno como string con validación
 * @param name - Clave de la variable de entorno
 * @returns Valor trimmed o string vacío si no existe
 */
export function getEnvString(name: keyof ImportMetaEnv): string {
	const value = import.meta.env[name]
	return typeof value === 'string' ? value.trim() : ''
}

/**
 * Obtiene una variable de entorno como string requerida
 * @param name - Clave de la variable de entorno
 * @throws Error si la variable no existe o está vacía
 */
export function getRequiredEnvString(name: keyof ImportMetaEnv): string {
	const value = getEnvString(name)
	if (!value) {
		throw new Error(`Required environment variable ${name} is missing or empty`)
	}
	return value
}

/**
 * Convierte una variable de entorno string a boolean
 * @param name - Clave de la variable de entorno
 * @returns true si el valor es "TRUE", false en caso contrario
 */
export function getBooleanEnv(name: keyof ImportMetaEnv): boolean {
	const value = import.meta.env[name]
	return typeof value === 'string' && value.toUpperCase() === 'TRUE'
}

/**
 * Evalúa si un valor de process.env es truthy (true/1/yes)
 * Útil para variables que no están en import.meta.env (e.g. runtime-only vars)
 */
export function isTruthyProcessEnv(name: string): boolean {
	const value = process.env[name]
	if (!value) return false
	const normalized = value.trim().toLowerCase()
	return normalized === 'true' || normalized === '1' || normalized === 'yes'
}

import { ENV_KEYS } from '@/consts/constants'

/**
 * Valida que todas las variables de entorno requeridas estén presentes
 * @throws Error si alguna variable requerida falta
 */

export function validateEnvironment(): void {
	const required: (keyof ImportMetaEnv)[] = [
		ENV_KEYS.HIVE_CREATOR_ACCOUNT as keyof ImportMetaEnv,
		ENV_KEYS.HIVE_CREATOR_ACTIVE_KEY as keyof ImportMetaEnv,
		ENV_KEYS.HIVE_DELEGATOR_ACCOUNT as keyof ImportMetaEnv,
		ENV_KEYS.HIVE_DELEGATOR_ACTIVE_KEY as keyof ImportMetaEnv,
		ENV_KEYS.SESSION_SECRET as keyof ImportMetaEnv,
	]

	for (const key of required) {
		getRequiredEnvString(key)
	}
}