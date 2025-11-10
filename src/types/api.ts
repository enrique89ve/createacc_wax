/**
 * API response and request types for HolaHive
 */

// Base API response
export interface ApiResponse<T = unknown> {
  readonly success: boolean
  readonly error?: string
  readonly data?: T
}

// Keys Hash API
export interface KeysHashResponse extends ApiResponse {
  readonly publicKeysHash?: string
}

// Session API
export interface SessionResponse extends ApiResponse {
  readonly session?: {
    readonly username: string
    readonly ticket?: string
    readonly confirmedDownload?: boolean
  }
}

// Account Creation API
export interface CreateAccountRequest {
  readonly username: string
  readonly ownerPublicKey: string
  readonly activePublicKey: string
  readonly postingPublicKey: string
  readonly memoPublicKey: string
}

export interface CreateAccountResponse extends ApiResponse {
  readonly accountName?: string
  readonly transactionId?: string
}

// Error response with details
export interface ApiErrorResponse extends ApiResponse {
  readonly success: false
  readonly error: string
  readonly detail?: string
  readonly code?: string
}

// Generic API context type
export interface ApiContext {
  readonly request: Request
  readonly params: Record<string, string | undefined>
  readonly url: URL
}

export type ApiMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'

export interface ApiEndpoint {
  readonly method: ApiMethod
  readonly path: string
  readonly handler: (context: ApiContext) => Promise<Response>
}