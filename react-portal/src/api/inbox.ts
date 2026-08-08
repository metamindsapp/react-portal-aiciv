import { apiGet, apiPost } from './client'
import type { AicivInboxState, InboxDecisionResponse, InboxJobState } from '../types/inbox'

export function fetchAicivInboxState(): Promise<AicivInboxState> {
  return apiGet<AicivInboxState>('/api/aiciv/inbox/state')
}

export function markInboxJobSeen(jobId: string): Promise<{ jobId: string; state: InboxJobState }> {
  return apiPost<{ jobId: string; state: InboxJobState }>(
    `/api/aiciv/inbox/${encodeURIComponent(jobId)}/seen`,
  )
}

export function archiveInboxJob(jobId: string): Promise<{ jobId: string; state: InboxJobState }> {
  return apiPost<{ jobId: string; state: InboxJobState }>(
    `/api/aiciv/inbox/${encodeURIComponent(jobId)}/archive`,
  )
}

export function restoreInboxJob(jobId: string): Promise<{ jobId: string; state: InboxJobState }> {
  return apiPost<{ jobId: string; state: InboxJobState }>(
    `/api/aiciv/inbox/${encodeURIComponent(jobId)}/restore`,
  )
}

export function recordDecisionResponse(
  jobId: string,
  decisionId: string,
  body: { optionId: string; label?: string; message?: string },
): Promise<{
  jobId: string
  decisionId: string
  response: InboxDecisionResponse
  semanticReceipt: string
}> {
  return apiPost(
    `/api/aiciv/inbox/${encodeURIComponent(jobId)}/decisions/${encodeURIComponent(decisionId)}/respond`,
    body,
  )
}
