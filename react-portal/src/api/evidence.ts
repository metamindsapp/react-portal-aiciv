import { apiGet, apiPost } from './client'

export interface AicivEvidence {
  id: string
  kind: 'browser_screenshot'
  artifactUrl: string
  pageUrl: string
  title: string
  note: string
  createdAt: string
  semanticReceipt: 'evidence_saved_not_job_completion'
  jobId?: string
  projectId?: string
}

export interface CreateEvidenceRequest {
  artifactUrl: string
  pageUrl: string
  title?: string
  note?: string
  jobId?: string
  projectId?: string
}

export function fetchEvidence(limit = 100) {
  return apiGet<{ evidence: AicivEvidence[]; count: number }>(`/api/aiciv/evidence?limit=${limit}`)
}

export function createEvidence(request: CreateEvidenceRequest) {
  return apiPost<{ evidence: AicivEvidence }>('/api/aiciv/evidence', request)
}
