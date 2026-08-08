import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { sendChatMessage } from '../../api/chat'
import { useDocsStore } from '../../stores/docsStore'
import { useProjectsStore } from '../../stores/projectsStore'
import type { Doc } from '../../types/docs'
import type { PresenceJob } from '../../types/presence'
import type { AicivProject, AicivProjectStatus } from '../../types/projects'
import { LoadingSpinner } from '../common/LoadingSpinner'
import { Modal } from '../common/Modal'
import './ProjectsView.css'

const TERMINAL_JOBS = new Set(['succeeded', 'failed', 'cancelled'])
const PROJECT_STATUSES: AicivProjectStatus[] = ['active', 'paused', 'completed', 'archived']

function relativeTime(iso: string): string {
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return ''
  const diff = Date.now() - ms
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return `${Math.floor(diff / 86_400_000)}d ago`
}

function ProjectListItem({
  project,
  selected,
  onSelect,
}: {
  project: AicivProject
  selected: boolean
  onSelect: () => void
}) {
  const jobCount = project.links.filter(link => link.kind === 'job').length
  const docCount = project.links.filter(link => link.kind === 'doc').length
  return (
    <button
      type="button"
      className={`project-list-item ${selected ? 'selected' : ''}`}
      onClick={onSelect}
    >
      <div className="project-list-item-top">
        <strong>{project.title}</strong>
        <span className={`project-status project-status-${project.status}`}>{project.status}</span>
      </div>
      <span className="project-list-goal">{project.goal}</span>
      <div className="project-list-meta">
        <span>{jobCount} job{jobCount === 1 ? '' : 's'}</span>
        <span>{docCount} doc{docCount === 1 ? '' : 's'}</span>
        <span>{relativeTime(project.updatedAt)}</span>
      </div>
    </button>
  )
}

function CreateProjectModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const createProject = useProjectsStore(state => state.createProject)
  const saving = useProjectsStore(state => state.saving)
  const [title, setTitle] = useState('')
  const [goal, setGoal] = useState('')
  const [summary, setSummary] = useState('')
  const [tags, setTags] = useState('')

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!title.trim() || !goal.trim()) return
    const created = await createProject({
      title: title.trim(),
      goal: goal.trim(),
      summary: summary.trim(),
      tags: tags.split(',').map(tag => tag.trim()).filter(Boolean),
    })
    if (created) {
      setTitle('')
      setGoal('')
      setSummary('')
      setTags('')
      onClose()
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="New AICIV Project" width="620px">
      <form className="project-form" onSubmit={submit}>
        <label>
          <span>Project name</span>
          <input value={title} onChange={event => setTitle(event.target.value)} placeholder="Presence Product" autoFocus />
        </label>
        <label>
          <span>Goal</span>
          <textarea
            value={goal}
            onChange={event => setGoal(event.target.value)}
            placeholder="What are the human and AICIV trying to make true?"
            rows={3}
          />
        </label>
        <label>
          <span>Current summary</span>
          <textarea
            value={summary}
            onChange={event => setSummary(event.target.value)}
            placeholder="Optional compact state / thesis"
            rows={3}
          />
        </label>
        <label>
          <span>Tags</span>
          <input value={tags} onChange={event => setTags(event.target.value)} placeholder="voice, product, reachy" />
        </label>
        <div className="project-form-actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="submit" className="primary" disabled={!title.trim() || !goal.trim() || saving}>
            {saving ? 'Creating…' : 'Create project'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

function JobLink({
  job,
  onOpen,
  onRemove,
}: {
  job: PresenceJob
  onOpen: () => void
  onRemove: () => void
}) {
  return (
    <div className="project-object-row">
      <button className="project-object-main" type="button" onClick={onOpen}>
        <span className={`project-object-dot project-object-dot-${job.status}`} />
        <span>
          <strong>{job.goal}</strong>
          <small>{job.status.replaceAll('_', ' ')} · {relativeTime(job.updatedAt)}</small>
        </span>
      </button>
      <button className="project-unlink" type="button" onClick={onRemove} title="Unlink job">×</button>
    </div>
  )
}

function DocLink({ doc, onOpen, onRemove }: { doc: Doc; onOpen: () => void; onRemove: () => void }) {
  return (
    <div className="project-object-row">
      <button className="project-object-main" type="button" onClick={onOpen}>
        <span className="project-object-doc-icon">▤</span>
        <span>
          <strong>{doc.title}</strong>
          <small>{doc.tags?.slice(0, 3).join(', ') || doc.visibility}</small>
        </span>
      </button>
      <button className="project-unlink" type="button" onClick={onRemove} title="Unlink Doc">×</button>
    </div>
  )
}

function ProjectDetail({ project }: { project: AicivProject }) {
  const navigate = useNavigate()
  const jobs = useProjectsStore(state => state.jobs)
  const docs = useProjectsStore(state => state.docs)
  const saving = useProjectsStore(state => state.saving)
  const updateProject = useProjectsStore(state => state.updateProject)
  const linkObject = useProjectsStore(state => state.linkObject)
  const unlinkObject = useProjectsStore(state => state.unlinkObject)
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(project.title)
  const [goal, setGoal] = useState(project.goal)
  const [summary, setSummary] = useState(project.summary)
  const [tags, setTags] = useState(project.tags.join(', '))
  const [linkSearch, setLinkSearch] = useState('')
  const [sendingContext, setSendingContext] = useState(false)
  const [deliveryError, setDeliveryError] = useState<string | null>(null)

  useEffect(() => {
    setTitle(project.title)
    setGoal(project.goal)
    setSummary(project.summary)
    setTags(project.tags.join(', '))
    setEditing(false)
    setDeliveryError(null)
  }, [project])

  const linkedJobIds = useMemo(
    () => new Set(project.links.filter(link => link.kind === 'job').map(link => link.objectId)),
    [project.links],
  )
  const linkedDocIds = useMemo(
    () => new Set(project.links.filter(link => link.kind === 'doc').map(link => link.objectId)),
    [project.links],
  )
  const linkedJobs = jobs.filter(job => linkedJobIds.has(job.jobId))
  const linkedDocs = docs.filter(doc => linkedDocIds.has(doc.id))
  const unresolved = project.links.filter(link =>
    (link.kind === 'job' && !jobs.some(job => job.jobId === link.objectId))
    || (link.kind === 'doc' && !docs.some(doc => doc.id === link.objectId))
    || (link.kind !== 'job' && link.kind !== 'doc')
  )

  const q = linkSearch.trim().toLowerCase()
  const availableJobs = jobs
    .filter(job => !linkedJobIds.has(job.jobId))
    .filter(job => !q || `${job.goal} ${job.status}`.toLowerCase().includes(q))
    .slice(0, 8)
  const availableDocs = docs
    .filter(doc => !linkedDocIds.has(doc.id))
    .filter(doc => !q || `${doc.title} ${(doc.tags || []).join(' ')} ${doc.content}`.toLowerCase().includes(q))
    .slice(0, 8)

  const save = async () => {
    const ok = await updateProject(project.projectId, {
      title: title.trim(),
      goal: goal.trim(),
      summary: summary.trim(),
      tags: tags.split(',').map(tag => tag.trim()).filter(Boolean),
    })
    if (ok) setEditing(false)
  }

  const openDoc = (doc: Doc) => {
    useDocsStore.getState().setSelectedDoc(doc)
    navigate('/docs')
  }

  const openJob = (job: PresenceJob) => {
    navigate(job.status === 'waiting' || TERMINAL_JOBS.has(job.status) ? '/inbox' : '/now')
  }

  const workWithAiciv = async () => {
    setSendingContext(true)
    setDeliveryError(null)
    const jobIds = project.links.filter(link => link.kind === 'job').map(link => link.objectId)
    const docIds = project.links.filter(link => link.kind === 'doc').map(link => link.objectId)
    const message = [
      `[AICIV PROJECT CONTEXT project=${project.projectId}]`,
      `Project: ${project.title}`,
      `Goal: ${project.goal}`,
      project.summary ? `Current summary: ${project.summary}` : '',
      project.tags.length ? `Tags: ${project.tags.join(', ')}` : '',
      jobIds.length ? `Linked durable jobs: ${jobIds.join(', ')}` : '',
      docIds.length ? `Linked Docs: ${docIds.join(', ')}` : '',
      '',
      'The human opened this project as the active work context. Treat these IDs as references to authoritative Portal/Presence objects, not copied truth. Help continue this workstream.',
    ].filter(Boolean).join('\n')

    try {
      const receipt = await sendChatMessage(message)
      if (!receipt.ok) {
        setDeliveryError('Portal did not accept the project context message.')
        return
      }
      navigate('/')
    } catch {
      setDeliveryError('Could not deliver project context to the primary AICIV.')
    } finally {
      setSendingContext(false)
    }
  }

  return (
    <div className="project-detail">
      <div className="project-detail-header">
        <div>
          <div className="project-detail-kicker">AICIV PROJECT · {project.projectId}</div>
          {editing ? (
            <input className="project-edit-title" value={title} onChange={event => setTitle(event.target.value)} />
          ) : (
            <h2>{project.title}</h2>
          )}
        </div>
        <div className="project-detail-actions">
          <button type="button" className="project-aiciv-action" onClick={() => void workWithAiciv()} disabled={sendingContext}>
            {sendingContext ? 'Sending…' : 'Work with AICIV'}
          </button>
          <button type="button" onClick={() => setEditing(value => !value)}>{editing ? 'Cancel edit' : 'Edit'}</button>
        </div>
      </div>

      {deliveryError && <div className="project-error">{deliveryError}</div>}

      <div className="project-status-row">
        {PROJECT_STATUSES.map(status => (
          <button
            type="button"
            key={status}
            className={project.status === status ? 'active' : ''}
            onClick={() => void updateProject(project.projectId, { status })}
            disabled={saving || project.status === status}
          >
            {status}
          </button>
        ))}
      </div>

      {editing ? (
        <div className="project-editor">
          <label><span>Goal</span><textarea rows={4} value={goal} onChange={event => setGoal(event.target.value)} /></label>
          <label><span>Summary</span><textarea rows={4} value={summary} onChange={event => setSummary(event.target.value)} /></label>
          <label><span>Tags</span><input value={tags} onChange={event => setTags(event.target.value)} /></label>
          <button type="button" className="primary" onClick={() => void save()} disabled={saving || !title.trim() || !goal.trim()}>
            {saving ? 'Saving…' : 'Save project'}
          </button>
        </div>
      ) : (
        <div className="project-narrative">
          <section><span>GOAL</span><p>{project.goal}</p></section>
          {project.summary && <section><span>CURRENT SUMMARY</span><p>{project.summary}</p></section>}
          {project.tags.length > 0 && <div className="project-tags">{project.tags.map(tag => <span key={tag}>{tag}</span>)}</div>}
        </div>
      )}

      <div className="project-object-grid">
        <section className="project-object-section">
          <div className="project-section-heading"><h3>Durable work</h3><span>{linkedJobs.length}</span></div>
          {linkedJobs.length === 0 ? <div className="project-empty">No durable jobs linked yet.</div> : linkedJobs.map(job => (
            <JobLink
              key={job.jobId}
              job={job}
              onOpen={() => openJob(job)}
              onRemove={() => void unlinkObject(project.projectId, 'job', job.jobId)}
            />
          ))}
        </section>

        <section className="project-object-section">
          <div className="project-section-heading"><h3>Knowledge</h3><span>{linkedDocs.length}</span></div>
          {linkedDocs.length === 0 ? <div className="project-empty">No Docs linked yet.</div> : linkedDocs.map(doc => (
            <DocLink
              key={doc.id}
              doc={doc}
              onOpen={() => openDoc(doc)}
              onRemove={() => void unlinkObject(project.projectId, 'doc', doc.id)}
            />
          ))}
        </section>
      </div>

      {unresolved.length > 0 && (
        <section className="project-other-links">
          <div className="project-section-heading"><h3>Other graph links</h3><span>{unresolved.length}</span></div>
          {unresolved.map((link, index) => (
            <div className="project-reference-row" key={`${link.kind}:${link.objectId}:${index}`}>
              <span>{link.kind}</span><code>{link.objectId}</code><small>{link.relation}</small>
              <button type="button" onClick={() => void unlinkObject(project.projectId, link.kind, link.objectId)}>×</button>
            </div>
          ))}
        </section>
      )}

      <section className="project-linker">
        <div className="project-section-heading"><h3>Link existing AICIV objects</h3><span>references only</span></div>
        <input
          className="project-link-search"
          value={linkSearch}
          onChange={event => setLinkSearch(event.target.value)}
          placeholder="Filter durable jobs and Docs…"
        />
        <div className="project-link-candidates">
          <div>
            <h4>Durable jobs</h4>
            {availableJobs.length === 0 ? <small>Nothing available.</small> : availableJobs.map(job => (
              <button key={job.jobId} type="button" onClick={() => void linkObject(project.projectId, 'job', job.jobId, 'work')}>
                <span>{job.goal}</span><small>{job.status.replaceAll('_', ' ')}</small>
              </button>
            ))}
          </div>
          <div>
            <h4>Docs</h4>
            {availableDocs.length === 0 ? <small>Nothing available.</small> : availableDocs.map(doc => (
              <button key={doc.id} type="button" onClick={() => void linkObject(project.projectId, 'doc', doc.id, 'knowledge')}>
                <span>{doc.title}</span><small>{doc.tags?.slice(0, 2).join(', ') || doc.visibility}</small>
              </button>
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}

export function ProjectsView() {
  const {
    projects,
    selectedProjectId,
    loading,
    error,
    refresh,
    selectProject,
  } = useProjectsStore()
  const [showCreate, setShowCreate] = useState(false)
  const [filter, setFilter] = useState('')

  useEffect(() => { void refresh() }, [refresh])

  const selected = projects.find(project => project.projectId === selectedProjectId) ?? null
  const filtered = projects.filter(project => {
    const q = filter.trim().toLowerCase()
    if (!q) return true
    return `${project.title} ${project.goal} ${project.summary} ${project.tags.join(' ')}`.toLowerCase().includes(q)
  })

  if (loading && projects.length === 0) {
    return <div className="projects-loading"><LoadingSpinner size={36} /></div>
  }

  return (
    <div className="projects-view">
      <aside className={`projects-list-pane ${selected ? 'has-selection' : ''}`}>
        <div className="projects-list-header">
          <div><span>AICIV WORKSTREAMS</span><h2>Projects</h2></div>
          <button type="button" onClick={() => setShowCreate(true)}>+ New</button>
        </div>
        <input className="projects-filter" value={filter} onChange={event => setFilter(event.target.value)} placeholder="Filter projects…" />
        {error && <div className="project-error">{error}</div>}
        <div className="projects-list">
          {filtered.length === 0 ? (
            <div className="project-empty-list">No projects yet. Create the first shared workstream.</div>
          ) : filtered.map(project => (
            <ProjectListItem
              key={project.projectId}
              project={project}
              selected={project.projectId === selectedProjectId}
              onSelect={() => selectProject(project.projectId)}
            />
          ))}
        </div>
      </aside>

      <main className={`projects-detail-pane ${selected ? 'visible' : ''}`}>
        {selected ? (
          <>
            <button className="projects-mobile-back" type="button" onClick={() => selectProject(null)}>← Projects</button>
            <ProjectDetail project={selected} />
          </>
        ) : (
          <div className="projects-empty-detail">
            <strong>Projects connect the pieces.</strong>
            <span>Create or select a workstream to link durable jobs, Docs and future AICIV objects without copying their truth into another silo.</span>
            <button type="button" onClick={() => setShowCreate(true)}>Create project</button>
          </div>
        )}
      </main>

      <CreateProjectModal open={showCreate} onClose={() => setShowCreate(false)} />
    </div>
  )
}
