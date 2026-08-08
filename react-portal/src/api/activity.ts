import { apiGet } from './client'

export interface AicivObjectRef {
  kind: string
  id: string
  ref: string
}

export interface AicivActivityEvent {
  eventId: string
  kind: string
  object: AicivObjectRef
  summary: string
  actor: string
  createdAt: string
  metadata?: Record<string, string | number | boolean | null>
}

export interface ActivityResponse {
  events: AicivActivityEvent[]
  count: number
  nextCursor: string | null
  reset: boolean
}

export function fetchAicivActivity(limit = 40): Promise<ActivityResponse> {
  return apiGet<ActivityResponse>(`/api/aiciv/activity?limit=${limit}`)
}
