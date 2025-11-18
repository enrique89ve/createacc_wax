/**
 * RateLimiter - Sistema de rate limiting client-side
 * Previene intentos excesivos de login/acciones con lockout temporal
 */

interface LoginAttempt {
	readonly count: number
	readonly firstAttempt: number
	readonly lockedUntil?: number
}

export interface RateLimitResult {
	readonly allowed: boolean
	readonly message?: string
	readonly remainingAttempts?: number
}

export class RateLimiter {
	constructor(
		private readonly storageKey: string,
		private readonly maxAttempts: number,
		private readonly attemptWindow: number,
		private readonly lockoutDuration: number
	) {}

	/**
	 * Verifica si la acción está permitida según el rate limit
	 */
	check(): RateLimitResult {
		const attempts = this.getAttempts()
		const now = Date.now()

		// Verificar si está bloqueado
		if (attempts.lockedUntil && now < attempts.lockedUntil) {
			const minutesLeft = Math.ceil((attempts.lockedUntil - now) / 60000)
			return {
				allowed: false,
				message: `Cuenta bloqueada. Intenta nuevamente en ${minutesLeft} minuto(s).`,
			}
		}

		// Si la ventana de intentos expiró, resetear
		if (now - attempts.firstAttempt > this.attemptWindow) {
			this.reset()
			return { allowed: true, remainingAttempts: this.maxAttempts }
		}

		// Verificar si excedió el límite
		if (attempts.count >= this.maxAttempts) {
			const lockUntil = now + this.lockoutDuration
			this.saveAttempts({ ...attempts, lockedUntil: lockUntil })
			const minutes = Math.ceil(this.lockoutDuration / 60000)
			return {
				allowed: false,
				message: `Demasiados intentos fallidos. Cuenta bloqueada por ${minutes} minutos.`,
			}
		}

		// Permitido
		const remaining = this.maxAttempts - attempts.count
		return { allowed: true, remainingAttempts: remaining }
	}

	/**
	 * Registra un intento fallido
	 */
	recordFailedAttempt(): void {
		const attempts = this.getAttempts()
		const now = Date.now()

		// Si la ventana expiró, iniciar nueva
		if (now - attempts.firstAttempt > this.attemptWindow) {
			this.saveAttempts({ count: 1, firstAttempt: now })
			return
		}

		// Incrementar contador
		this.saveAttempts({ ...attempts, count: attempts.count + 1 })
	}

	/**
	 * Resetea el contador de intentos
	 */
	reset(): void {
		localStorage.removeItem(this.storageKey)
	}

	/**
	 * Obtiene intentos restantes
	 */
	getRemainingAttempts(): number {
		const attempts = this.getAttempts()
		const now = Date.now()

		// Si la ventana expiró, tiene todos los intentos disponibles
		if (now - attempts.firstAttempt > this.attemptWindow) {
			return this.maxAttempts
		}

		return Math.max(0, this.maxAttempts - attempts.count)
	}

	/**
	 * Obtiene el estado actual de intentos desde localStorage
	 */
	private getAttempts(): LoginAttempt {
		const stored = localStorage.getItem(this.storageKey)
		if (!stored) {
			return { count: 0, firstAttempt: Date.now() }
		}
		return JSON.parse(stored) as LoginAttempt
	}

	/**
	 * Guarda el estado de intentos en localStorage
	 */
	private saveAttempts(attempts: LoginAttempt): void {
		localStorage.setItem(this.storageKey, JSON.stringify(attempts))
	}
}
