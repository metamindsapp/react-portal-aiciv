import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { fetchPresenceJobs } from '../../api/presence'
import type { PresenceJob, PresenceJobStatus } from '../../types/presence'
import './ConversationWorkRail.css'

const ACTIVE = new Set<PresenceJobStatus>(['queued', 'accepted', 'running', 'waiting', 'cancel_requested'])

function preview(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    for (const key of ['summary', 'answer', 'conclusion', 'result', 'message']) {
      if (typeof record[key] === 'string') return record[key] as string
    }
  }
  return null
}

function statusText(status: PresenceJobStatus): string {
  switch (status) {
    case 'queued': return 'Queued'
    case 'accepted': return 'Accepted'
    case 'running': return 'Working'
    case 'waiting': return 'Needs input'
    case 'cancel_requested': return 'Stop requested'
    case 'succeeded': return 'Returned'
    case 'failed': return 'Failed'
    case 'cancelled': return 'Cancelled'
  }
}

export function ConversationWorkRail() {
  const [jobs, setJobs] = useState<PresenceJob[]>([])
  const [available, setAvailable] = useState(true)

  useEffect(() => {
    let active = true
    const refresh = async () => {
      try {
        const response = await fetchPresenceJobs(30)
        if (active) {
          setJobs(response.jobs || [])
          setAvailable(true)
        }
      } catch {
        if (active) setAvailable(false)
      }
    }
    void refresh()
    const interval = window.setInterval(() => void refresh(), 15_000)
    return () => {
      active = false
      window.clearInterval(interval)
    }
  }, [])

  const visible = useMemo(() => {
    const activeJobs = jobs.filter(job => ACTIVE.has(job.status))
    const returned = jobs.filter(job => job.status === 'succeeded' || job.status === 'failed')
    return [...activeJobs, ...returned].slice(0, 4)
  }, [jobs])

  if (!available || visible.length === 0) return null

  return (
    <section className="conversation-work-rail" aria-label="Durable AICIV work related to this collaboration">
      <div className="conversation-work-head">
        <div>
          <span className="conversation-work-kicker">DURABLE WORK</span>
          <strong>Working beyond this turn</strong>
        </div>
        <Link to="/now">Open Now</Link>
      </div>
      <div className="conversation-work-list">
        {visible.map(job => {
          const result = preview(job.result)
          return (
            <Link
              key={job.jobId}
              to={job.status === 'waiting' || job.status === 'succeeded' || job.status === 'failed' ? '/inbox' : '/now'}
              className={`conversation-work-card conversation-work-${job.status}`}
              title={job.jobId}
            >
              <span className={`conversation-work-status conversation-work-status-${job.status}`}>
                {statusText(job.status)}
              </span>
              <span className="conversation-work-goal">{job.goal}</span>
              {result && job.status === 'succeeded' && (
                <span className="conversation-work-result">{result.slice(0, 180)}</span>
              )}
              {job.error && <span className="conversation-work-error">{job.error.slice(0, 180)}</span>}
              {job.receipts?.length > 0 && (
                <span className="conversation-work-receipts">
                  {job.receipts.length} receipt{job.receipts.length === 1 ? '' : 's'}
                </span>
              )}
            </Link>
          )
        })}
      </div>
    </section>
  )
}
