import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchStatus } from '../api/identity'
import { cancelPresenceJob, fetchPresenceJobs } from '../api/presence'
import { useMailStore } from '../stores/mailStore'
import { useTeamsStore } from '../stores/teamsStore'
import { useNowStore } from '../stores/nowStore'
import type { PresenceJob } from '../types/presence'

vi.mock('../api/identity', () => ({
  fetchStatus: vi.fn(),
}))

vi.mock('../api/presence', () => ({
  fetchPresenceJobs: vi.fn(),
  cancelPresenceJob: vi.fn(),
}))

const runningJob: PresenceJob = {
  jobId: 'job_0123456789abcdef01234567',
  goal: 'Compare voice provider latency',
  urgency: 'normal',
  status: 'running',
  createdAt: '2026-08-08T12:00:00.000Z',
  updatedAt: '2026-08-08T12:01:00.000Z',
  receipts: [],
  events: [
    {
      eventId: 'evt_running_001',
      type: 'running',
      createdAt: '2026-08-08T12:01:00.000Z',
      message: 'Running the blind latency suite',
    },
  ],
}

const completedJob: PresenceJob = {
  jobId: 'job_abcdef0123456789abcdef01',
  goal: 'Summarize the benchmark',
  urgency: 'normal',
  status: 'succeeded',
  createdAt: '2026-08-08T11:00:00.000Z',
  updatedAt: '2026-08-08T11:05:00.000Z',
  result: { summary: 'Provider B won on p50 and interruption quality.' },
  receipts: [{ kind: 'file', label: 'report', uri: 'file:///tmp/report.md' }],
  events: [],
}

beforeEach(() => {
  vi.resetAllMocks()
  useMailStore.setState({
    inbox: [
      {
        id: 7,
        from_agent: 'auditor',
        to_agent: 'primary',
        subject: 'Need approval',
        body: 'Please review',
        timestamp: '2026-08-08T12:02:00.000Z',
        read: false,
        archived: false,
        thread_id: null,
      },
    ],
    unreadCount: 1,
    loadInbox: vi.fn(async () => {}),
  })
  useTeamsStore.setState({
    panes: [{ id: '%1', title: 'researcher', target: 'civ:1.0', content: 'working' }],
    loadPanes: vi.fn(async () => {}),
  })
  useNowStore.setState({
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
  })
})

describe('NowStore', () => {
  it('synthesizes durable work, results, mail, panes, and system status', async () => {
    vi.mocked(fetchStatus).mockResolvedValue({
      civ: 'synth',
      uptime: 1200,
      tmux_session: 'civ',
      tmux_alive: true,
      claude_running: true,
      ctx_pct: 61,
      timestamp: Date.now() / 1000,
      version: '1.0.1',
    })
    vi.mocked(fetchPresenceJobs).mockResolvedValue({
      jobs: [runningJob, completedJob],
      count: 2,
    })

    await useNowStore.getState().refresh()
    const state = useNowStore.getState()

    expect(state.status?.claude_running).toBe(true)
    expect(state.jobs).toHaveLength(2)
    expect(state.panes).toHaveLength(1)
    expect(state.unreadMail).toHaveLength(1)
    expect(state.activity.some(item => item.title.includes('Working · Compare voice provider latency'))).toBe(true)
    expect(state.activity.some(item => item.title.includes('Completed · Summarize the benchmark'))).toBe(true)
    expect(state.activity.some(item => item.title.includes('Unread mail · Need approval'))).toBe(true)
    expect(state.sourceErrors).toEqual([])
  })

  it('keeps cancellation honest as cancel_requested until a receipt confirms stop', async () => {
    useNowStore.setState({ jobs: [runningJob] })
    vi.mocked(cancelPresenceJob).mockResolvedValue({
      job: { ...runningJob, status: 'cancel_requested', updatedAt: '2026-08-08T12:03:00.000Z' },
    })

    const ok = await useNowStore.getState().cancelJob(runningJob.jobId)

    expect(ok).toBe(true)
    expect(useNowStore.getState().jobs[0]?.status).toBe('cancel_requested')
    expect(useNowStore.getState().jobs[0]?.status).not.toBe('cancelled')
  })
})
