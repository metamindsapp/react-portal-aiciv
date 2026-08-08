import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useIdentityStore } from '../../stores/identityStore'
import { useNowStore, type AicivActivityItem } from '../../stores/nowStore'
import type { PresenceJob, PresenceJobStatus, PresenceReceipt } from '../../types/presence'
import { LoadingSpinner } from '../common/LoadingSpinner'
import './NowView.css'

const ACTIVE_JOB_STATUSES = new Set<PresenceJobStatus>([
  'queued',
  'accepted',
  'running',
  'waiting',
  'cancel_requested',
])

function relativeTime(ms: number): string {
  if (!ms) return ''
  const diff = Date.now() - ms
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return `${Math.floor(diff / 86_400_000)}d ago`
}

function resultText(value: unknown): string | null {
  if (value == null) return null
  if (typeof value === 'string') return value
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    for (const key of ['summary', 'answer', 'result', 'conclusion', 'message']) {
      if (typeof record[key] === 'string') return record[key]
    }
  }
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function statusLabel(status: PresenceJobStatus): string {
  switch (status) {
    case 'queued': return 'Queued'
    case 'accepted': return 'Accepted'
    case 'running': return 'Working'
    case 'waiting': return 'Waiting'
    case 'cancel_requested': return 'Stop requested'
    case 'succeeded': return 'Complete'
    case 'failed': return 'Failed'
    case 'cancelled': return 'Cancelled'
  }
}

function canCancel(status: PresenceJobStatus): boolean {
  return status === 'queued' || status === 'accepted' || status === 'running' || status === 'waiting'
}

function Receipt({ receipt }: { receipt: PresenceReceipt }) {
  const label = receipt.label || receipt.kind
  const isWeb = receipt.uri?.startsWith('https://') || receipt.uri?.startsWith('http://')

  return (
    <div className="now-receipt">
      <span className="now-receipt-kind">{receipt.kind}</span>
      {isWeb && receipt.uri ? (
        <a href={receipt.uri} target="_blank" rel="noopener noreferrer">{label}</a>
      ) : (
        <span className="now-receipt-label">{label}</span>
      )}
      {receipt.uri && !isWeb && <code className="now-receipt-uri">{receipt.uri}</code>}
    </div>
  )
}

function JobCard({
  job,
  cancelling,
  onCancel,
}: {
  job: PresenceJob
  cancelling: boolean
  onCancel: (jobId: string) => void
}) {
  const result = resultText(job.result)
  const lastEvent = [...(job.events || [])].sort(
    (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
  )[0]

  return (
    <article className={`now-job now-job-${job.status}`} id={job.jobId}>
      <div className="now-job-head">
        <div>
          <div className="now-job-kicker">
            <span className={`now-status-pill now-status-${job.status}`}>{statusLabel(job.status)}</span>
            {job.urgency === 'urgent' && <span className="now-urgency">Urgent</span>}
          </div>
          <h3 className="now-job-title">{job.goal}</h3>
        </div>
        <span className="now-job-time">{relativeTime(Date.parse(job.updatedAt || job.createdAt))}</span>
      </div>

      {lastEvent?.message && <p className="now-job-progress">{lastEvent.message}</p>}
      {job.error && <p className="now-job-error">{job.error}</p>}
      {result && job.status === 'succeeded' && <div className="now-job-result">{result}</div>}

      {job.receipts?.length > 0 && (
        <div className="now-receipts">
          <div className="now-receipts-title">Evidence & receipts</div>
          {job.receipts.slice(0, 6).map((receipt, index) => (
            <Receipt key={`${receipt.kind}-${receipt.uri ?? receipt.label ?? index}`} receipt={receipt} />
          ))}
        </div>
      )}

      <div className="now-job-footer">
        <span className="now-job-id" title={job.jobId}>{job.jobId}</span>
        {canCancel(job.status) && (
          <button
            type="button"
            className="now-cancel-btn"
            onClick={() => onCancel(job.jobId)}
            disabled={cancelling}
          >
            {cancelling ? 'Requesting…' : 'Request stop'}
          </button>
        )}
      </div>
    </article>
  )
}

function ActivityItem({ item }: { item: AicivActivityItem }) {
  const content = (
    <>
      <span className={`now-activity-dot now-activity-dot-${item.tone}`} />
      <span className="now-activity-copy">
        <strong>{item.title}</strong>
        {item.detail && <span>{item.detail}</span>}
      </span>
      <time>{relativeTime(item.timestamp)}</time>
    </>
  )

  return item.href ? (
    <Link className="now-activity-item" to={item.href}>{content}</Link>
  ) : (
    <div className="now-activity-item">{content}</div>
  )
}

export function NowView() {
  const civName = useIdentityStore(s => s.civName)
  const {
    status,
    jobs,
    panes,
    unreadMail,
    activity,
    loading,
    refreshing,
    presenceAvailable,
    sourceErrors,
    lastUpdated,
    refresh,
    cancelJob,
  } = useNowStore()
  const [cancellingJob, setCancellingJob] = useState<string | null>(null)

  useEffect(() => {
    void refresh()
    const interval = window.setInterval(() => void refresh(), 10_000)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [refresh])

  const activeJobs = useMemo(
    () => jobs.filter(job => ACTIVE_JOB_STATUSES.has(job.status)),
    [jobs],
  )
  const completedJobs = useMemo(
    () => jobs.filter(job => job.status === 'succeeded').slice(0, 8),
    [jobs],
  )
  const attentionJobs = useMemo(
    () => jobs.filter(job => job.status === 'failed' || job.status === 'waiting' || job.status === 'cancel_requested'),
    [jobs],
  )

  const primaryOnline = Boolean(status?.tmux_alive && status?.claude_running)
  const ctxPct = status?.ctx_pct ?? null

  const headline = useMemo(() => {
    if (!status) return 'Building the current picture…'
    if (!primaryOnline) return 'Primary AICIV needs attention'
    if (attentionJobs.length > 0) return `${attentionJobs.length} item${attentionJobs.length === 1 ? '' : 's'} need attention`
    if (activeJobs.length > 0) return `${civName || 'Your AICIV'} is working on ${activeJobs.length} durable job${activeJobs.length === 1 ? '' : 's'}`
    return `${civName || 'Your AICIV'} is online and ready`
  }, [activeJobs.length, attentionJobs.length, civName, primaryOnline, status])

  const handleCancel = async (jobId: string) => {
    setCancellingJob(jobId)
    await cancelJob(jobId)
    setCancellingJob(null)
  }

  if (loading && !lastUpdated) {
    return <div className="now-loading"><LoadingSpinner size={36} /></div>
  }

  return (
    <div className="now-view">
      <section className="now-hero">
        <div className="now-hero-copy">
          <div className="now-eyebrow">AICIV NOW</div>
          <h2>{headline}</h2>
          <p>
            One synthesized view of durable work, live runtime state, team activity, communication and returned results.
          </p>
        </div>
        <div className="now-hero-actions">
          <Link className="now-primary-action" to="/">Open conversation</Link>
          <button className="now-refresh-btn" onClick={() => void refresh()} disabled={refreshing} type="button">
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </section>

      {sourceErrors.length > 0 && (
        <div className="now-source-errors" role="status">
          {sourceErrors.map(error => <span key={error}>{error}</span>)}
        </div>
      )}

      <section className="now-metrics" aria-label="AICIV current state">
        <Link to="/status" className={`now-metric ${primaryOnline ? 'now-metric-good' : 'now-metric-bad'}`}>
          <span>Primary</span>
          <strong>{primaryOnline ? 'Online' : 'Attention'}</strong>
        </Link>
        <div className="now-metric">
          <span>Durable work</span>
          <strong>{presenceAvailable ? activeJobs.length : '—'}</strong>
        </div>
        <Link to="/mail" className="now-metric">
          <span>Unread mail</span>
          <strong>{unreadMail.length}</strong>
        </Link>
        <Link to="/teams" className="now-metric">
          <span>Active panes</span>
          <strong>{panes.length}</strong>
        </Link>
        <Link to="/context" className={`now-metric ${(ctxPct ?? 0) >= 75 ? 'now-metric-warn' : ''}`}>
          <span>Context</span>
          <strong>{ctxPct == null ? '—' : `${Math.round(ctxPct)}%`}</strong>
        </Link>
      </section>

      <div className="now-layout">
        <main className="now-main-column">
          <section className="now-section">
            <div className="now-section-heading">
              <div>
                <span className="now-section-kicker">WORKING NOW</span>
                <h2>Durable work</h2>
              </div>
              <span>{activeJobs.length}</span>
            </div>
            {activeJobs.length === 0 ? (
              <div className="now-empty-card">
                <strong>No durable jobs are active.</strong>
                <span>Substantial voice requests handed to the primary AICIV will appear here automatically.</span>
              </div>
            ) : (
              <div className="now-job-list">
                {activeJobs.map(job => (
                  <JobCard
                    key={job.jobId}
                    job={job}
                    cancelling={cancellingJob === job.jobId}
                    onCancel={handleCancel}
                  />
                ))}
              </div>
            )}
          </section>

          <section className="now-section">
            <div className="now-section-heading">
              <div>
                <span className="now-section-kicker">RESULT INBOX</span>
                <h2>Returned results</h2>
              </div>
              <span>{completedJobs.length}</span>
            </div>
            {completedJobs.length === 0 ? (
              <div className="now-empty-card">
                <strong>No returned results yet.</strong>
                <span>Completed Presence delegations with evidence will collect here instead of disappearing into old conversations.</span>
              </div>
            ) : (
              <div className="now-job-list">
                {completedJobs.map(job => (
                  <JobCard key={job.jobId} job={job} cancelling={false} onCancel={handleCancel} />
                ))}
              </div>
            )}
          </section>
        </main>

        <aside className="now-side-column">
          {attentionJobs.length > 0 && (
            <section className="now-panel now-attention-panel">
              <div className="now-panel-heading">
                <h3>Needs attention</h3>
                <span>{attentionJobs.length}</span>
              </div>
              {attentionJobs.slice(0, 5).map(job => (
                <a key={job.jobId} href={`#${job.jobId}`} className="now-attention-item">
                  <span className={`now-status-pill now-status-${job.status}`}>{statusLabel(job.status)}</span>
                  <strong>{job.goal}</strong>
                  {job.error && <span>{job.error}</span>}
                </a>
              ))}
            </section>
          )}

          <section className="now-panel">
            <div className="now-panel-heading">
              <h3>Live team</h3>
              <Link to="/teams">Open Teams</Link>
            </div>
            {panes.length === 0 ? (
              <div className="now-panel-empty">No active tmux panes.</div>
            ) : (
              <div className="now-pane-list">
                {panes.slice(0, 6).map(pane => (
                  <Link to="/teams" key={pane.id} className="now-pane-item">
                    <span className="now-pane-dot" />
                    <span>
                      <strong>{pane.title || pane.id}</strong>
                      <small>{pane.target}</small>
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </section>

          <section className="now-panel">
            <div className="now-panel-heading">
              <h3>Activity</h3>
              {lastUpdated && <small>Updated {relativeTime(lastUpdated)}</small>}
            </div>
            {activity.length === 0 ? (
              <div className="now-panel-empty">No recent activity to surface.</div>
            ) : (
              <div className="now-activity-list">
                {activity.slice(0, 14).map(item => <ActivityItem key={item.id} item={item} />)}
              </div>
            )}
          </section>
        </aside>
      </div>
    </div>
  )
}
