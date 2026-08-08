import { apiGet, apiPost } from './client'
import type { PresenceCapabilityStatus, PresenceJob, PresenceJobStatus } from '../types/presence'

export function fetchPresenceStatus(): Promise<PresenceCapabilityStatus> {
  return apiGet<PresenceCapabilityStatus>('/api/presence/status')
}

export function fetchPresenceJobs(
  limit = 50,
  status?: PresenceJobStatus,
): Promise<{ jobs: PresenceJob[]; count: number }> {
  const params = new URLSearchParams({ limit: String(limit) })
  if (status) params.set('status', status)
  return apiGet<{ jobs: PresenceJob[]; count: number }>(`/api/presence/jobs?${params}`)
}

export function fetchPresenceJob(jobId: string): Promise<{ job: PresenceJob }> {
  return apiGet<{ job: PresenceJob }>(`/api/presence/jobs/${encodeURIComponent(jobId)}`)
}

export function cancelPresenceJob(jobId: string): Promise<{ job: PresenceJob }> {
  return apiPost<{ job: PresenceJob }>(`/api/presence/jobs/${encodeURIComponent(jobId)}/cancel`)
}
