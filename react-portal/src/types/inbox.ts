export interface InboxDecisionResponse {
  optionId: string
  label?: string
  message?: string
  respondedAt: string
}

export interface InboxJobState {
  seenAt?: string
  archivedAt?: string
  decisionResponses?: Record<string, InboxDecisionResponse>
}

export interface AicivInboxState {
  version: number
  jobs: Record<string, InboxJobState>
}

export interface DecisionOption {
  id: string
  label: string
  description?: string
}

export interface AicivDecision {
  id: string
  question: string
  context?: string
  recommendation?: string
  risk?: string
  options: DecisionOption[]
  allowFreeform?: boolean
}
