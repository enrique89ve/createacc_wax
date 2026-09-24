export const CREATION_ATTEMPT_EVENT_TYPES = {
  RESERVED: 'reserved',
  PREPARED: 'prepared',
  BROADCAST_AUTHORIZED: 'broadcast_authorized',
  BROADCAST_RESULT: 'broadcast_result',
  COMPLETED: 'completed',
  ROLLED_BACK: 'rolled_back',
} as const

export type CreationAttemptEventType =
  (typeof CREATION_ATTEMPT_EVENT_TYPES)[keyof typeof CREATION_ATTEMPT_EVENT_TYPES]
