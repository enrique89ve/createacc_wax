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
	private readonly MAX_ENTRIES = 10_000

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
		this.cleanup()

		// Evict oldest entries if cache is full to prevent OOM
		if (this.cache.size >= this.MAX_ENTRIES) {
			const entriesToRemove = Math.floor(this.MAX_ENTRIES * 0.1)
			const iterator = this.cache.keys()
			for (let i = 0; i < entriesToRemove; i++) {
				const next = iterator.next()
				if (next.done) break
				this.cache.delete(next.value)
			}
		}

		// Almacenar en cache
		this.cache.set(hash, hashData)

		return hashData
	}

	/**
	 * Validar y consumir hash
	 */
	validateAndConsume(hash: string, username: string): ClaimHashData | null {
		// Limpiar expirados
		this.cleanup()

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
	 * Limpiar hashes expirados
	 */
	cleanup(): void {
		const now = Date.now()

		for (const [hash, data] of this.cache) {
			if (now > data.expiresAt) {
				this.cache.delete(hash)
			}
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
	claimHashCache.cleanup()
}, 5 * 60 * 1000)

export { claimHashCache }