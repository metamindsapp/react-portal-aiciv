export type PresenceJobStatus =
  | 'queued'
  | 'accepted'
  | 'running'
  | 'waiting'
  | 'cancel_requested'
  | 'succeeded'
  | 'failed'
  | 'cancelled'

export type PresenceJobUrgency = 'background' | 'normal' | 'urgent'

export interface PresenceReceipt {
  kind: string
  label?: string
  uri?: string
  digest?: string
  metadata?: Record<string, unknown>
}

export interface PresenceJobEvent {
  eventId: string
  type: string
  createdAt: string
  message?: string
  result?: unknown
  receipts?: PresenceReceipt[]
  error?: string
}

export interface PresenceJob {
  jobId: string
  idempotencyKey?: string
  surface?: string
  conversationId?: string
  goal: string
  expectedReturn?: string
  urgency?: PresenceJobUrgency
  status: PresenceJobStatus
  createdAt: string
  updatedAt: string
  deliveryCorrelationId?: string
  result?: unknown
  receipts: PresenceReceipt[]
  error?: string
  events: PresenceJobEvent[]
}

export interface PresenceCapabilityStatus {
  configured: boolean
  surface: string
  civ: string
  voice: { available: boolean }
  jobs?: { available: boolean }
}
