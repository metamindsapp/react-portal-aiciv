import { create } from 'zustand'
import { fetchDocs } from '../api/docs'
import { fetchPresenceJobs } from '../api/presence'
import {
  addAicivProjectLink,
  createAicivProject,
  fetchAicivProjects,
  removeAicivProjectLink,
  updateAicivProject,
} from '../api/projects'
import type { Doc } from '../types/docs'
import type { PresenceJob } from '../types/presence'
import type {
  AicivProject,
  AicivProjectLinkKind,
  CreateAicivProjectRequest,
  UpdateAicivProjectRequest,
} from '../types/projects'

interface ProjectsState {
  projects: AicivProject[]
  selectedProjectId: string | null
  jobs: PresenceJob[]
  docs: Doc[]
  loading: boolean
  saving: boolean
  error: string | null
  refresh: () => Promise<void>
  selectProject: (projectId: string | null) => void
  createProject: (request: CreateAicivProjectRequest) => Promise<AicivProject | null>
  updateProject: (projectId: string, request: UpdateAicivProjectRequest) => Promise<boolean>
  linkObject: (
    projectId: string,
    kind: AicivProjectLinkKind,
    objectId: string,
    relation?: string,
  ) => Promise<boolean>
  unlinkObject: (projectId: string, kind: AicivProjectLinkKind, objectId: string) => Promise<boolean>
}

function upsertProject(projects: AicivProject[], project: AicivProject): AicivProject[] {
  const next = projects.filter(item => item.projectId !== project.projectId)
  next.push(project)
  return next.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export const useProjectsStore = create<ProjectsState>((set, get) => ({
  projects: [],
  selectedProjectId: null,
  jobs: [],
  docs: [],
  loading: true,
  saving: false,
  error: null,

  refresh: async () => {
    set({ loading: true, error: null })
    const [projectsResult, jobsResult, docsResult] = await Promise.allSettled([
      fetchAicivProjects(),
      fetchPresenceJobs(100),
      fetchDocs(),
    ])

    const failures: string[] = []
    let projects = get().projects
    let jobs = get().jobs
    let docs = get().docs

    if (projectsResult.status === 'fulfilled') projects = projectsResult.value.projects || []
    else failures.push('Projects')

    if (jobsResult.status === 'fulfilled') jobs = jobsResult.value.jobs || []
    else failures.push('durable jobs')

    if (docsResult.status === 'fulfilled') docs = Array.isArray(docsResult.value) ? docsResult.value : []
    else failures.push('Docs')

    const selectedProjectId = get().selectedProjectId
    const stillExists = selectedProjectId && projects.some(item => item.projectId === selectedProjectId)
    set({
      projects,
      jobs,
      docs,
      selectedProjectId: stillExists ? selectedProjectId : (projects[0]?.projectId ?? null),
      loading: false,
      error: failures.length ? `Some project sources are unavailable: ${failures.join(', ')}.` : null,
    })
  },

  selectProject: (projectId) => set({ selectedProjectId: projectId }),

  createProject: async (request) => {
    set({ saving: true, error: null })
    try {
      const response = await createAicivProject(request)
      set(state => ({
        projects: upsertProject(state.projects, response.project),
        selectedProjectId: response.project.projectId,
        saving: false,
      }))
      return response.project
    } catch {
      set({ saving: false, error: 'Could not create that project.' })
      return null
    }
  },

  updateProject: async (projectId, request) => {
    set({ saving: true, error: null })
    try {
      const response = await updateAicivProject(projectId, request)
      set(state => ({
        projects: upsertProject(state.projects, response.project),
        saving: false,
      }))
      return true
    } catch {
      set({ saving: false, error: 'Could not update that project.' })
      return false
    }
  },

  linkObject: async (projectId, kind, objectId, relation = 'related') => {
    set({ saving: true, error: null })
    try {
      const response = await addAicivProjectLink(projectId, { kind, objectId, relation })
      set(state => ({
        projects: upsertProject(state.projects, response.project),
        saving: false,
      }))
      return true
    } catch {
      set({ saving: false, error: 'Could not link that object to the project.' })
      return false
    }
  },

  unlinkObject: async (projectId, kind, objectId) => {
    set({ saving: true, error: null })
    try {
      const response = await removeAicivProjectLink(projectId, { kind, objectId })
      set(state => ({
        projects: upsertProject(state.projects, response.project),
        saving: false,
      }))
      return true
    } catch {
      set({ saving: false, error: 'Could not unlink that object from the project.' })
      return false
    }
  },
}))
