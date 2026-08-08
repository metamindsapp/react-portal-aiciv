import type { Doc } from '../types/docs'
import type { ChatMessage } from '../types/chat'
import type { PresenceJob } from '../types/presence'
import type { AicivProject } from '../types/projects'

export type CommandEntryKind = 'route' | 'project' | 'job' | 'doc' | 'message'

export interface CommandEntry {
  id: string
  kind: CommandEntryKind
  title: string
  subtitle: string
  keywords: string
  route?: string
  project?: AicivProject
  doc?: Doc
  messageId?: string
  job?: PresenceJob
}

const ROUTES: Array<{
  route: string
  title: string
  subtitle: string
  keywords: string
}> = [
  { route: '/now', title: 'AICIV Now', subtitle: 'Current work, health, results and activity', keywords: 'home current status work activity cockpit' },
  { route: '/inbox', title: 'AICIV Inbox', subtitle: 'Needs You, Results and Archive', keywords: 'decisions approvals results returned work needs you' },
  { route: '/', title: 'Conversation', subtitle: 'Chat with your primary AICIV', keywords: 'chat talk message conversation primary' },
  { route: '/projects', title: 'Projects', subtitle: 'Shared AICIV workstreams and object relationships', keywords: 'projects workstreams goals linked objects jobs docs context' },
  { route: '/teams', title: 'Teams', subtitle: 'Live agent/tmux panes', keywords: 'agents panes team workers tmux' },
  { route: '/calendar', title: 'Calendar', subtitle: 'Scheduled and recurring work', keywords: 'agentcal schedule tasks recurring events' },
  { route: '/mail', title: 'Mail', subtitle: 'AgentMail inbox, sent and threads', keywords: 'email messages inbox agentmail' },
  { route: '/orgchart', title: 'Org', subtitle: 'Agent organization and hierarchy', keywords: 'agents organization org chart hierarchy hire' },
  { route: '/tgim', title: 'TGIM', subtitle: 'Task & Goal Intelligence Manager', keywords: 'tasks goals projects command center' },
  { route: '/docs', title: 'Docs', subtitle: 'Shared AICIV knowledge base', keywords: 'documents knowledge markdown notes' },
  { route: '/sheets', title: 'Sheets', subtitle: 'Shared structured data', keywords: 'spreadsheets tables data workbook rows' },
  { route: '/hub', title: 'HUB', subtitle: 'Groups, rooms and threads', keywords: 'social collaboration rooms threads groups' },
  { route: '/bookmarks', title: 'Bookmarks', subtitle: 'Saved conversation references', keywords: 'saved messages references pins' },
  { route: '/points', title: 'Signals', subtitle: 'Collaboration reactions and sentiment', keywords: 'points reactions sentiment signals emojis' },
  { route: '/browser', title: 'Browser', subtitle: 'Human/AICIV shared browser control', keywords: 'web browser agent human control navigate' },
  { route: '/terminal', title: 'Terminal', subtitle: 'Direct tmux/terminal control', keywords: 'shell terminal console tmux cli' },
  { route: '/context', title: 'Context', subtitle: 'Claude context-window state', keywords: 'tokens context claude capacity session' },
  { route: '/status', title: 'Status', subtitle: 'Raw AICIV runtime health', keywords: 'health processes claude tmux boop auth runtime' },
  { route: '/settings', title: 'Settings', subtitle: 'Portal preferences and controls', keywords: 'preferences theme config logout settings' },
]

function oneLine(value: string, max: number): string {
  const clean = value.replace(/\s+/g, ' ').trim()
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean
}

export function routeCommandEntries(): CommandEntry[] {
  return ROUTES.map(item => ({
    id: `route:${item.route}`,
    kind: 'route',
    title: item.title,
    subtitle: item.subtitle,
    keywords: `${item.title} ${item.subtitle} ${item.keywords}`,
    route: item.route,
  }))
}

export function projectCommandEntries(projects: AicivProject[]): CommandEntry[] {
  return projects.map(project => ({
    id: `project:${project.projectId}`,
    kind: 'project',
    title: project.title,
    subtitle: `Project · ${project.status} · ${project.links.length} linked object${project.links.length === 1 ? '' : 's'}`,
    keywords: `${project.title} ${project.goal} ${project.summary} ${project.tags.join(' ')} ${project.status}`,
    project,
  }))
}

export function jobCommandEntries(jobs: PresenceJob[]): CommandEntry[] {
  return jobs.map(job => ({
    id: `job:${job.jobId}`,
    kind: 'job',
    title: job.goal,
    subtitle: `${job.status.replaceAll('_', ' ')} · ${job.surface || 'durable work'}`,
    keywords: `${job.goal} ${job.status} ${job.expectedReturn || ''} ${job.error || ''}`,
    job,
  }))
}

export function docCommandEntries(docs: Doc[]): CommandEntry[] {
  return docs.map(doc => ({
    id: `doc:${doc.id}`,
    kind: 'doc',
    title: doc.title,
    subtitle: `Doc · ${doc.tags?.slice(0, 3).join(', ') || doc.visibility || 'knowledge'}`,
    keywords: `${doc.title} ${(doc.tags || []).join(' ')} ${oneLine(doc.content || '', 700)}`,
    doc,
  }))
}

export function messageCommandEntries(messages: ChatMessage[]): CommandEntry[] {
  return messages
    .filter(message => message.text?.trim())
    .map(message => ({
      id: `message:${message.id}`,
      kind: 'message' as const,
      title: oneLine(message.text, 110),
      subtitle: `${message.role === 'user' ? 'You' : 'AICIV'} · conversation`,
      keywords: oneLine(message.text, 1000),
      messageId: message.id,
    }))
}

function scoreEntry(entry: CommandEntry, query: string): number {
  const q = query.toLowerCase().trim()
  if (!q) return entry.kind === 'route' ? 10 : 0

  const title = entry.title.toLowerCase()
  const subtitle = entry.subtitle.toLowerCase()
  const haystack = `${title} ${subtitle} ${entry.keywords.toLowerCase()}`
  const tokens = q.split(/\s+/).filter(Boolean)

  if (!tokens.every(token => haystack.includes(token))) return -1

  let score = 0
  if (title === q) score += 140
  if (title.startsWith(q)) score += 100
  else if (title.includes(q)) score += 70
  if (subtitle.includes(q)) score += 35
  if (haystack.includes(q)) score += 20

  for (const token of tokens) {
    if (title.startsWith(token)) score += 16
    else if (title.includes(token)) score += 10
    else if (subtitle.includes(token)) score += 5
    else score += 2
  }

  if (entry.kind === 'project') score += 7
  if (entry.kind === 'job') score += 5
  if (entry.kind === 'doc') score += 3
  if (entry.kind === 'route') score += 2
  return score
}

export function rankCommandEntries(
  entries: CommandEntry[],
  query: string,
  limit = 18,
): CommandEntry[] {
  return entries
    .map((entry, index) => ({ entry, score: scoreEntry(entry, query), index }))
    .filter(item => item.score >= 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map(item => item.entry)
}
