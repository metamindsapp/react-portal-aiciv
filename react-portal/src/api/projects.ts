import { apiGet, apiPatch, apiPost } from './client'
import type {
  AicivProject,
  AicivProjectLinkKind,
  AicivProjectStatus,
  CreateAicivProjectRequest,
  UpdateAicivProjectRequest,
} from '../types/projects'

export function fetchAicivProjects(status?: AicivProjectStatus): Promise<{ projects: AicivProject[]; count: number }> {
  const query = status ? `?status=${encodeURIComponent(status)}` : ''
  return apiGet<{ projects: AicivProject[]; count: number }>(`/api/aiciv/projects${query}`)
}

export function createAicivProject(body: CreateAicivProjectRequest): Promise<{ project: AicivProject }> {
  return apiPost<{ project: AicivProject }>('/api/aiciv/projects', body)
}

export function updateAicivProject(
  projectId: string,
  body: UpdateAicivProjectRequest,
): Promise<{ project: AicivProject }> {
  return apiPatch<{ project: AicivProject }>(`/api/aiciv/projects/${encodeURIComponent(projectId)}`, body)
}

export function addAicivProjectLink(
  projectId: string,
  body: { kind: AicivProjectLinkKind; objectId: string; relation?: string },
): Promise<{ project: AicivProject; created: boolean }> {
  return apiPost<{ project: AicivProject; created: boolean }>(
    `/api/aiciv/projects/${encodeURIComponent(projectId)}/links`,
    body,
  )
}

export function removeAicivProjectLink(
  projectId: string,
  body: { kind: AicivProjectLinkKind; objectId: string },
): Promise<{ project: AicivProject; removed: number }> {
  return apiPost<{ project: AicivProject; removed: number }>(
    `/api/aiciv/projects/${encodeURIComponent(projectId)}/links/remove`,
    body,
  )
}
