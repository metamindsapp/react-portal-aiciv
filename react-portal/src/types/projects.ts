export type AicivProjectStatus = 'active' | 'paused' | 'completed' | 'archived'
export type AicivProjectLinkKind =
  | 'job'
  | 'doc'
  | 'sheet'
  | 'thread'
  | 'agent'
  | 'calendar'
  | 'mail'
  | 'browser'
  | 'artifact'

export interface AicivProjectLink {
  kind: AicivProjectLinkKind
  objectId: string
  relation: string
  addedAt: string
}

export interface AicivProject {
  projectId: string
  title: string
  goal: string
  summary: string
  status: AicivProjectStatus
  tags: string[]
  links: AicivProjectLink[]
  createdAt: string
  updatedAt: string
}

export interface CreateAicivProjectRequest {
  title: string
  goal: string
  summary?: string
  tags?: string[]
}

export interface UpdateAicivProjectRequest {
  title?: string
  goal?: string
  summary?: string
  status?: AicivProjectStatus
  tags?: string[]
}
