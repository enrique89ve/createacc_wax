/**
 * 🔐 CLAIM HASH CACHE
 *
 * Sistema de cache en memoria para hashes de validación de claims
 * Reemplaza la tabla TempClaimHashes con una solución más simple y eficiente
 */

import { createHash, randomBytes } from 'crypto'

export interface ClaimHashData {
	username: string
	hash: string
	ticketCode: string
	creditsAvailable: number
	createdAt: number
	expiresAt: number
}

class ClaimHashCache {
	private cache = new Map<string, ClaimHashData>()
	private readonly TTL = 10 * 60 * 1000 // 10 minutos en millisegundos

	/**
	 * Generar y almacenar hash de validación
	 */
	generateHash(username: string, ticketCode: string, creditsAvailable: number): ClaimHashData {
		const now = Date.now()
		const randomBytesHex = randomBytes(16).toString('hex')
		const dataToHash = `${username}:${ticketCode}:${now}:${randomBytesHex}`
		const hash = createHash('sha256').update(dataToHash).digest('hex')

		const hashData: ClaimHashData = {
			username,
			hash,
			ticketCode,
			creditsAvailable,
			createdAt: now,
			expiresAt: now + this.TTL
		}

		// Limpiar hashes expirados antes de agregar nuevo
		this.cleanupExpired()

		// Almacenar en cache
		this.cache.set(hash, hashData)

		return hashData
	}

	/**
	 * Validar y consumir hash
	 */
	validateAndConsume(hash: string, username: string): ClaimHashData | null {
		// Limpiar expirados
		this.cleanupExpired()

		const hashData = this.cache.get(hash)

		if (!hashData) {
			return null
		}

		// Verificar que el username coincida
		if (hashData.username !== username) {
			return null
		}

		// Verificar que no haya expirado
		if (Date.now() > hashData.expiresAt) {
			this.cache.delete(hash)
			return null
		}

		// Consumir hash (eliminarlo del cache)
		this.cache.delete(hash)

		return hashData
	}

	/**
	 * Verificar si un hash existe sin consumirlo
	 */
	validateOnly(hash: string, username: string): ClaimHashData | null {
		this.cleanupExpired()

		const hashData = this.cache.get(hash)

		if (!hashData) {
			return null
		}

		if (hashData.username !== username) {
			return null
		}

		if (Date.now() > hashData.expiresAt) {
			this.cache.delete(hash)
			return null
		}

		return hashData
	}

	/**
	 * Limpiar hashes expirados
	 */
	private cleanupExpired(): void {
		const now = Date.now()
		const expiredHashes: string[] = []

		// Encontrar hashes expirados
		for (const [hash, data] of this.cache) {
			if (now > data.expiresAt) {
				expiredHashes.push(hash)
			}
		}

		// Eliminar hashes expirados
		expiredHashes.forEach(hash => {
			this.cache.delete(hash)
		})

		if (expiredHashes.length > 0) {
		}
	}

	/**
	 * Obtener estadísticas del cache
	 */
	getStats(): {
		totalHashes: number
		activeHashes: number
		expiredHashes: number
		memoryUsage: string
	} {
		this.cleanupExpired()

		const now = Date.now()
		let activeCount = 0
		let expiredCount = 0

		for (const [, data] of this.cache) {
			if (now <= data.expiresAt) {
				activeCount++
			} else {
				expiredCount++
			}
		}

		// Estimación aproximada de uso de memoria
		const avgHashSize = 200 // bytes aproximados por entrada
		const memoryBytes = this.cache.size * avgHashSize
		const memoryKB = Math.round(memoryBytes / 1024 * 100) / 100

		return {
			totalHashes: this.cache.size,
			activeHashes: activeCount,
			expiredHashes: expiredCount,
			memoryUsage: `${memoryKB} KB`
		}
	}

	/**
	 * Limpiar todo el cache (para testing)
	 */
	clear(): void {
		this.cache.clear()
	}
}

// Singleton instance
const claimHashCache = new ClaimHashCache()

// Limpieza automática cada 5 minutos
setInterval(() => {
	const stats = claimHashCache.getStats()
	if (stats.totalHashes > 0) {
	}
}, 5 * 60 * 1000)

export { claimHashCache }