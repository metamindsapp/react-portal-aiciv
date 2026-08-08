import { create } from 'zustand'
import { fetchStatus } from '../api/identity'
import { cancelPresenceJob, fetchPresenceJobs } from '../api/presence'
import { useMailStore } from './mailStore'
import { useTeamsStore, type TmuxPane } from './teamsStore'
import type { MailMessage } from '../types/agentmail'
import type { StatusResponse } from '../types/identity'
import type { PresenceJob, PresenceJobStatus } from '../types/presence'

export type ActivityKind = 'job' | 'mail' | 'system'
export type ActivityTone = 'neutral' | 'working' | 'success' | 'warning' | 'error'

export interface AicivActivityItem {
  id: string
  kind: ActivityKind
  tone: ActivityTone
  title: string
  detail?: string
  timestamp: number
  href?: string
  jobId?: string
}

interface NowState {
  status: StatusResponse | null
  jobs: PresenceJob[]
  panes: TmuxPane[]
  unreadMail: MailMessage[]
  activity: AicivActivityItem[]
  loading: boolean
  refreshing: boolean
  presenceAvailable: boolean
  sourceErrors: string[]
  lastUpdated: number | null
  refresh: () => Promise<void>
  cancelJob: (jobId: string) => Promise<boolean>
}

function epoch(value: string | number | undefined): number {
  if (typeof value === 'number') return value > 10_000_000_000 ? value : value * 1000
  if (!value) return 0
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function safePreview(value: unknown, max = 220): string | undefined {
  if (value == null) return undefined
  let text: string
  if (typeof value === 'string') {
    text = value
  } else {
    try {
      text = JSON.stringify(value)
    } catch {
      text = String(value)
    }
  }
  text = text.replace(/\s+/g, ' ').trim()
  if (!text) return undefined
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

function jobTone(status: PresenceJobStatus): ActivityTone {
  switch (status) {
    case 'succeeded': return 'success'
    case 'failed': return 'error'
    case 'waiting':
    case 'cancel_requested': return 'warning'
    case 'queued':
    case 'accepted':
    case 'running': return 'working'
    case 'cancelled': return 'neutral'
  }
}

function jobStatusLabel(status: PresenceJobStatus): string {
  switch (status) {
    case 'queued': return 'Queued'
    case 'accepted': return 'Accepted'
    case 'running': return 'Working'
    case 'waiting': return 'Waiting'
    case 'cancel_requested': return 'Stop requested'
    case 'succeeded': return 'Completed'
    case 'failed': return 'Failed'
    case 'cancelled': return 'Cancelled'
  }
}

function buildActivity(
  status: StatusResponse | null,
  jobs: PresenceJob[],
  unreadMail: MailMessage[],
): AicivActivityItem[] {
  const items: AicivActivityItem[] = []

  for (const job of jobs) {
    const latestEvent = [...(job.events || [])].sort((a, b) => epoch(b.createdAt) - epoch(a.createdAt))[0]
    const detail =
      latestEvent?.message ||
      job.error ||
      (job.status === 'succeeded' ? safePreview(job.result) : undefined)

    items.push({
      id: `job:${job.jobId}:${job.updatedAt}`,
      kind: 'job',
      tone: jobTone(job.status),
      title: `${jobStatusLabel(job.status)} · ${job.goal}`,
      detail,
      timestamp: epoch(job.updatedAt) || epoch(job.createdAt),
      href: `/now#${job.jobId}`,
      jobId: job.jobId,
    })
  }

  for (const message of unreadMail.slice(0, 8)) {
    items.push({
      id: `mail:${message.id}`,
      kind: 'mail',
      tone: 'neutral',
      title: `Unread mail · ${message.subject || '(no subject)'}`,
      detail: `From ${message.from_agent}`,
      timestamp: epoch(message.timestamp),
      href: '/mail',
    })
  }

  if (status) {
    const statusTime = epoch(status.timestamp)
    if (!status.tmux_alive || !status.claude_running) {
      items.push({
        id: `system:primary-offline:${status.timestamp}`,
        kind: 'system',
        tone: 'error',
        title: 'Primary AICIV needs attention',
        detail: !status.tmux_alive ? 'The primary tmux session is down.' : 'Claude is not running in the primary session.',
        timestamp: statusTime,
        href: '/status',
      })
    }
    if ((status.ctx_pct ?? 0) >= 75) {
      items.push({
        id: `system:context:${status.timestamp}`,
        kind: 'system',
        tone: (status.ctx_pct ?? 0) >= 90 ? 'error' : 'warning',
        title: `Context window at ${Math.round(status.ctx_pct ?? 0)}%`,
        detail: 'The primary session is approaching a context-management boundary.',
        timestamp: statusTime,
        href: '/context',
      })
    }
  }

  return items
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 30)
}

function replaceJob(jobs: PresenceJob[], updated: PresenceJob): PresenceJob[] {
  const next = jobs.filter(job => job.jobId !== updated.jobId)
  next.push(updated)
  return next.sort((a, b) => epoch(b.updatedAt) - epoch(a.updatedAt))
}

export const useNowStore = create<NowState>((set, get) => ({
  status: null,
  jobs: [],
  panes: [],
  unreadMail: [],
  activity: [],
  loading: true,
  refreshing: false,
  presenceAvailable: true,
  sourceErrors: [],
  lastUpdated: null,

  refresh: async () => {
    const firstLoad = get().lastUpdated == null
    set({ refreshing: true, ...(firstLoad ? { loading: true } : {}) })

    const mailPromise = useMailStore.getState().loadInbox()
    const panesPromise = useTeamsStore.getState().loadPanes()
    const [statusResult, jobsResult] = await Promise.allSettled([
      fetchStatus(),
      fetchPresenceJobs(50),
      mailPromise,
      panesPromise,
    ]).then(results => [results[0], results[1]] as const)

    const sourceErrors: string[] = []
    let status = get().status
    let jobs = get().jobs
    let presenceAvailable = true

    if (statusResult.status === 'fulfilled') {
      status = statusResult.value
    } else {
      sourceErrors.push('AICIV status is temporarily unavailable.')
    }

    if (jobsResult.status === 'fulfilled') {
      jobs = jobsResult.value.jobs || []
    } else {
      presenceAvailable = false
      sourceErrors.push('Durable Presence jobs are temporarily unavailable.')
    }

    const panes = useTeamsStore.getState().panes
    const unreadMail = useMailStore.getState().inbox.filter(message => !message.read)

    set({
      status,
      jobs,
      panes,
      unreadMail,
      activity: buildActivity(status, jobs, unreadMail),
      presenceAvailable,
      sourceErrors,
      loading: false,
      refreshing: false,
      lastUpdated: Date.now(),
    })
  },

  cancelJob: async (jobId) => {
    try {
      const response = await cancelPresenceJob(jobId)
      const jobs = replaceJob(get().jobs, response.job)
      set({
        jobs,
        activity: buildActivity(get().status, jobs, get().unreadMail),
      })
      return true
    } catch {
      set(state => ({
        sourceErrors: [...state.sourceErrors.filter(e => !e.startsWith('Could not request')), 'Could not request cancellation for that job.'],
      }))
      return false
    }
  },
}))
