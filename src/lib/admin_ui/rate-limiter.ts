/**
 * RateLimiter - Client-side rate limiting system
 * Prevents excessive login/action attempts with temporary lockout
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
   * Checks if the action is allowed according to the rate limit
   */
  check(): RateLimitResult {
    const attempts = this.getAttempts()
    const now = Date.now()

    // Check if locked
    if (attempts.lockedUntil && now < attempts.lockedUntil) {
      const minutesLeft = Math.ceil((attempts.lockedUntil - now) / 60000)
      return {
        allowed: false,
        message: `Account locked. Try again in ${minutesLeft} minute(s).`,
      }
    }

    // If attempt window expired, reset
    if (now - attempts.firstAttempt > this.attemptWindow) {
      this.reset()
      return { allowed: true, remainingAttempts: this.maxAttempts }
    }

    // Check if limit exceeded
    if (attempts.count >= this.maxAttempts) {
      const lockUntil = now + this.lockoutDuration
      this.saveAttempts({ ...attempts, lockedUntil: lockUntil })
      const minutes = Math.ceil(this.lockoutDuration / 60000)
      return {
        allowed: false,
        message: `Too many failed attempts. Account locked for ${minutes} minutes.`,
      }
    }

    // Allowed
    const remaining = this.maxAttempts - attempts.count
    return { allowed: true, remainingAttempts: remaining }
  }

  /**
   * Records a failed attempt
   */
  recordFailedAttempt(): void {
    const attempts = this.getAttempts()
    const now = Date.now()

    // If window expired, start a new one
    if (now - attempts.firstAttempt > this.attemptWindow) {
      this.saveAttempts({ count: 1, firstAttempt: now })
      return
    }

    // Increment counter
    this.saveAttempts({ ...attempts, count: attempts.count + 1 })
  }

  /**
   * Resets attempt counter
   */
  reset(): void {
    localStorage.removeItem(this.storageKey)
  }

  /**
   * Gets remaining attempts
   */
  getRemainingAttempts(): number {
    const attempts = this.getAttempts()
    const now = Date.now()

    // If window expired, all attempts are available
    if (now - attempts.firstAttempt > this.attemptWindow) {
      return this.maxAttempts
    }

    return Math.max(0, this.maxAttempts - attempts.count)
  }

  /**
   * Gets current attempt state from localStorage
   */
  private getAttempts(): LoginAttempt {
    const stored = localStorage.getItem(this.storageKey)
    if (!stored) {
      return { count: 0, firstAttempt: Date.now() }
    }
    return JSON.parse(stored) as LoginAttempt
  }

  /**
   * Saves attempt state to localStorage
   */
  private saveAttempts(attempts: LoginAttempt): void {
    localStorage.setItem(this.storageKey, JSON.stringify(attempts))
  }
}
