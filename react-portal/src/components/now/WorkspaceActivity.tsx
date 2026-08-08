import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { fetchAicivActivity, type AicivActivityEvent } from '../../api/activity'
import { usePortalResource } from '../../hooks/usePortalResource'
import './WorkspaceActivity.css'

function relative(iso: string): string {
  const time = Date.parse(iso)
  if (!Number.isFinite(time)) return ''
  const seconds = Math.max(0, Math.floor((Date.now() - time) / 1000))
  if (seconds < 60) return 'now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

function routeFor(event: AicivActivityEvent): string | null {
  const kind = event.object.kind
  if (kind === 'project') return '/projects'
  if (kind === 'job' || kind === 'decision') return '/inbox'
  if (kind === 'message') return '/'
  if (kind === 'evidence') return '/browser'
  if (kind === 'doc') return '/docs'
  if (kind === 'sheet') return '/sheets'
  if (kind === 'mail') return '/mail'
  if (kind === 'hub') return '/hub'
  if (kind === 'calendar') return '/calendar'
  return null
}

function iconFor(kind: string): string {
  if (kind.startsWith('project.')) return '◫'
  if (kind.startsWith('decision.')) return '◆'
  if (kind.startsWith('evidence.')) return '◉'
  if (kind.startsWith('reference.')) return '⌑'
  if (kind.startsWith('reaction.')) return '✦'
  if (kind.startsWith('object.')) return '↔'
  if (kind.startsWith('inbox.')) return '▣'
  return '·'
}

export function WorkspaceActivity() {
  const resource = usePortalResource(
    'aiciv:activity',
    () => fetchAicivActivity(30),
    { ttlMs: 5000, refreshMs: 10_000 },
  )

  const events = useMemo(() => [...(resource.data?.events || [])].reverse().slice(0, 12), [resource.data])

  return (
    <section className="workspace-activity">
      <div className="workspace-activity-head">
        <div>
          <span className="workspace-activity-kicker">SHARED EVENT STREAM</span>
          <h3>Workspace Activity</h3>
        </div>
        <button type="button" onClick={() => void resource.refresh()} disabled={resource.refreshing}>
          {resource.refreshing ? '…' : 'Refresh'}
        </button>
      </div>

      {resource.loading ? (
        <div className="workspace-activity-empty">Loading shared activity…</div>
      ) : resource.error && events.length === 0 ? (
        <div className="workspace-activity-empty">Activity unavailable. The correlated error notice has diagnostics.</div>
      ) : events.length === 0 ? (
        <div className="workspace-activity-empty">Shared changes will appear here as projects, evidence, decisions and references evolve.</div>
      ) : (
        <div className="workspace-activity-list">
          {events.map(event => {
            const route = routeFor(event)
            const content = (
              <>
                <span className="workspace-activity-icon">{iconFor(event.kind)}</span>
                <span className="workspace-activity-body">
                  <strong>{event.summary}</strong>
                  <span>{event.kind} · {event.object.ref}</span>
                </span>
                <time dateTime={event.createdAt}>{relative(event.createdAt)}</time>
              </>
            )
            return route ? (
              <Link key={event.eventId} className="workspace-activity-item" to={route}>{content}</Link>
            ) : (
              <div key={event.eventId} className="workspace-activity-item">{content}</div>
            )
          })}
        </div>
      )}
    </section>
  )
}
