import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchDocs } from '../api/docs'
import { fetchPresenceJobs } from '../api/presence'
import {
  addAicivProjectLink,
  createAicivProject,
  fetchAicivProjects,
  removeAicivProjectLink,
  updateAicivProject,
} from '../api/projects'
import { useProjectsStore } from '../stores/projectsStore'
import type { AicivProject } from '../types/projects'
import type { PresenceJob } from '../types/presence'
import type { Doc } from '../types/docs'

vi.mock('../api/docs', () => ({ fetchDocs: vi.fn() }))
vi.mock('../api/presence', () => ({ fetchPresenceJobs: vi.fn() }))
vi.mock('../api/projects', () => ({
  fetchAicivProjects: vi.fn(),
  createAicivProject: vi.fn(),
  updateAicivProject: vi.fn(),
  addAicivProjectLink: vi.fn(),
  removeAicivProjectLink: vi.fn(),
}))

const project: AicivProject = {
  projectId: 'prj_0123456789abcdef01234567',
  title: 'Presence Product',
  goal: 'Ship product-level voice for the AICIV',
  summary: 'ElevenLabs media + durable cognition',
  status: 'active',
  tags: ['voice', 'product'],
  links: [
    {
      kind: 'job',
      objectId: 'job_0123456789abcdef01234567',
      relation: 'work',
      addedAt: '2026-08-08T12:00:00.000Z',
    },
    {
      kind: 'doc',
      objectId: 'doc_voice',
      relation: 'knowledge',
      addedAt: '2026-08-08T12:01:00.000Z',
    },
  ],
  createdAt: '2026-08-08T11:00:00.000Z',
  updatedAt: '2026-08-08T12:01:00.000Z',
}

const job: PresenceJob = {
  jobId: 'job_0123456789abcdef01234567',
  goal: 'Run the blind voice provider eval',
  status: 'running',
  urgency: 'normal',
  createdAt: '2026-08-08T11:30:00.000Z',
  updatedAt: '2026-08-08T12:02:00.000Z',
  receipts: [],
  events: [],
}

const doc: Doc = {
  id: 'doc_voice',
  title: 'Voice Architecture',
  content: 'Presence is separate from durable cognition.',
  visibility: 'private',
  tags: ['voice'],
}

beforeEach(() => {
  vi.resetAllMocks()
  useProjectsStore.setState({
    projects: [],
    selectedProjectId: null,
    jobs: [],
    docs: [],
    loading: true,
    saving: false,
    error: null,
  })
})

describe('ProjectsStore', () => {
  it('joins project references with authoritative Jobs and Docs without copying them into project state', async () => {
    vi.mocked(fetchAicivProjects).mockResolvedValue({ projects: [project], count: 1 })
    vi.mocked(fetchPresenceJobs).mockResolvedValue({ jobs: [job], count: 1 })
    vi.mocked(fetchDocs).mockResolvedValue([doc])

    await useProjectsStore.getState().refresh()
    const state = useProjectsStore.getState()

    expect(state.projects[0]?.links.map(link => [link.kind, link.objectId])).toEqual([
      ['job', job.jobId],
      ['doc', doc.id],
    ])
    expect(state.jobs[0]?.goal).toBe('Run the blind voice provider eval')
    expect(state.docs[0]?.content).toContain('durable cognition')
    expect(JSON.stringify(state.projects[0])).not.toContain('Run the blind voice provider eval')
    expect(JSON.stringify(state.projects[0])).not.toContain('Presence is separate from durable cognition')
    expect(state.selectedProjectId).toBe(project.projectId)
  })

  it('upserts a project after linking an authoritative object id', async () => {
    useProjectsStore.setState({ projects: [{ ...project, links: [] }], selectedProjectId: project.projectId })
    const linked: AicivProject = {
      ...project,
      links: [{
        kind: 'job',
        objectId: job.jobId,
        relation: 'work',
        addedAt: '2026-08-08T12:03:00.000Z',
      }],
      updatedAt: '2026-08-08T12:03:00.000Z',
    }
    vi.mocked(addAicivProjectLink).mockResolvedValue({ project: linked, created: true })

    const ok = await useProjectsStore.getState().linkObject(project.projectId, 'job', job.jobId, 'work')

    expect(ok).toBe(true)
    expect(addAicivProjectLink).toHaveBeenCalledWith(project.projectId, {
      kind: 'job',
      objectId: job.jobId,
      relation: 'work',
    })
    expect(useProjectsStore.getState().projects[0]?.links[0]?.objectId).toBe(job.jobId)
  })

  it('keeps partial source failures visible without discarding healthy project data', async () => {
    vi.mocked(fetchAicivProjects).mockResolvedValue({ projects: [project], count: 1 })
    vi.mocked(fetchPresenceJobs).mockRejectedValue(new Error('Presence offline'))
    vi.mocked(fetchDocs).mockResolvedValue([doc])

    await useProjectsStore.getState().refresh()

    expect(useProjectsStore.getState().projects).toHaveLength(1)
    expect(useProjectsStore.getState().docs).toHaveLength(1)
    expect(useProjectsStore.getState().error).toContain('durable jobs')
  })

  it('creates and updates projects through the shared server graph', async () => {
    vi.mocked(createAicivProject).mockResolvedValue({ project })
    vi.mocked(updateAicivProject).mockResolvedValue({ project: { ...project, status: 'paused' } })

    const created = await useProjectsStore.getState().createProject({
      title: project.title,
      goal: project.goal,
      summary: project.summary,
      tags: project.tags,
    })
    expect(created?.projectId).toBe(project.projectId)
    expect(useProjectsStore.getState().selectedProjectId).toBe(project.projectId)

    const updated = await useProjectsStore.getState().updateProject(project.projectId, { status: 'paused' })
    expect(updated).toBe(true)
    expect(useProjectsStore.getState().projects[0]?.status).toBe('paused')
  })

  it('removes only the requested reference edge', async () => {
    useProjectsStore.setState({ projects: [project] })
    const withoutJob = { ...project, links: project.links.filter(link => link.kind !== 'job') }
    vi.mocked(removeAicivProjectLink).mockResolvedValue({ project: withoutJob, removed: 1 })

    const ok = await useProjectsStore.getState().unlinkObject(project.projectId, 'job', job.jobId)

    expect(ok).toBe(true)
    expect(useProjectsStore.getState().projects[0]?.links).toHaveLength(1)
    expect(useProjectsStore.getState().projects[0]?.links[0]?.kind).toBe('doc')
  })
})
