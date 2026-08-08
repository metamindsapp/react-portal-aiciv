import type { TmuxPane } from '../stores/teamsStore'

export type PaneSemanticState = 'working' | 'waiting' | 'error' | 'idle' | 'unknown'

export interface PaneSemanticView {
  state: PaneSemanticState
  label: string
  summary: string
  detail: string | null
}

const ANSI_RE = /\x1b\[[0-?]*[ -/]*[@-~]/g

export function stripTerminalNoise(value: string): string {
  return value
    .replace(ANSI_RE, '')
    .replace(/\r/g, '')
    .replace(/[\u2800-\u28ff]+/g, '')
}

function meaningfulLines(content: string): string[] {
  return stripTerminalNoise(content)
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !/^[-─━=]{3,}$/.test(line))
}

function bounded(value: string, max = 180): string {
  return value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`
}

export function describePane(pane: TmuxPane): PaneSemanticView {
  const lines = meaningfulLines(pane.content || '')
  const tail = lines.slice(-12)
  const joined = tail.join(' ').toLowerCase()
  const last = tail[tail.length - 1] || pane.title || pane.id

  if (/traceback|uncaught|fatal|\berror\b|\bfailed\b|permission denied|command not found/.test(joined)) {
    return {
      state: 'error',
      label: 'Needs attention',
      summary: bounded(last),
      detail: 'Recent terminal output contains an error/failure signal. Open raw output before assuming work stopped.',
    }
  }

  if (/waiting for|needs? (?:your|human) |approval|permission|confirm|choose an option|respond with|blocked on/.test(joined)) {
    return {
      state: 'waiting',
      label: 'Waiting',
      summary: bounded(last),
      detail: 'The pane appears to be waiting on input or an external dependency.',
    }
  }

  if (/esc to interrupt|running|working on|thinking|processing|building|testing|searching|fetching|installing|compiling|executing/.test(joined)) {
    return {
      state: 'working',
      label: 'Working',
      summary: bounded(last),
      detail: null,
    }
  }

  if (lines.length === 0) {
    return { state: 'unknown', label: 'Unknown', summary: 'No readable pane output', detail: null }
  }

  // Claude/tmux panes often settle on a prompt-like final line when they are
  // available for another instruction. Keep this heuristic deliberately weak;
  // raw terminal output remains accessible as the authoritative evidence.
  if (/^[>$#❯›]|\?$/.test(last) || /what would you like|ready|idle/.test(joined)) {
    return { state: 'idle', label: 'Ready', summary: bounded(last), detail: null }
  }

  return {
    state: 'unknown',
    label: 'Active',
    summary: bounded(last),
    detail: 'Semantic state is inferred from terminal output; expand raw output for exact context.',
  }
}
