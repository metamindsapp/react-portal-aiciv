import { lazy, Suspense, useEffect } from 'react'
import { HashRouter, Routes, Route } from 'react-router-dom'
import { AuthGuard } from './components/auth/AuthGuard'
import { ClaudeAuthFlow } from './components/auth/ClaudeAuthFlow'
import { ErrorCenter } from './components/common/ErrorCenter'
import { FullPageSpinner } from './components/common/LoadingSpinner'
import { AppShell } from './components/layout/AppShell'
import { useBookmarkStore } from './stores/bookmarkStore'
import { useIdentityStore } from './stores/identityStore'
import { useSettingsStore } from './stores/settingsStore'

const ChatView = lazy(() => import('./components/chat/ChatView').then(m => ({ default: m.ChatView })))
const NowView = lazy(() => import('./components/now/NowView').then(m => ({ default: m.NowView })))
const InboxView = lazy(() => import('./components/inbox/InboxView').then(m => ({ default: m.InboxView })))
const ProjectsView = lazy(() => import('./components/projects/ProjectsView').then(m => ({ default: m.ProjectsView })))
const CalendarView = lazy(() => import('./components/calendar/CalendarView').then(m => ({ default: m.CalendarView })))
const MailView = lazy(() => import('./components/agentmail/MailView').then(m => ({ default: m.MailView })))
const SettingsView = lazy(() => import('./components/settings/SettingsView').then(m => ({ default: m.SettingsView })))
const TerminalView = lazy(() => import('./components/terminal/TerminalView').then(m => ({ default: m.TerminalView })))
const TeamsView = lazy(() => import('./components/teams/TeamsView').then(m => ({ default: m.TeamsView })))
const BookmarksView = lazy(() => import('./components/bookmarks/BookmarksView').then(m => ({ default: m.BookmarksView })))
const StatusView = lazy(() => import('./components/status/StatusView').then(m => ({ default: m.StatusView })))
const ContextView = lazy(() => import('./components/context/ContextView').then(m => ({ default: m.ContextView })))
const OrgChartView = lazy(() => import('./components/agents/OrgChartView'))
const DocsView = lazy(() => import('./components/docs/DocsView').then(m => ({ default: m.DocsView })))
const SheetsView = lazy(() => import('./components/sheets/SheetsView').then(m => ({ default: m.SheetsView })))
const HubView = lazy(() => import('./components/hub/HubView').then(m => ({ default: m.HubView })))
const PointsView = lazy(() => import('./components/points/PointsView').then(m => ({ default: m.PointsView })))
const BrowserView = lazy(() => import('./components/browser/BrowserView').then(m => ({ default: m.BrowserView })))
const TgimView = lazy(() => import('./components/tgim/TgimView').then(m => ({ default: m.TgimView })))

function AuthenticatedApp() {
  const fetchIdentity = useIdentityStore(s => s.fetchIdentity)
  const fetchStatusInfo = useIdentityStore(s => s.fetchStatusInfo)
  const loadSharedReferences = useBookmarkStore(s => s.load)

  useEffect(() => {
    void fetchIdentity()
    void fetchStatusInfo()
    void loadSharedReferences()
    const interval = window.setInterval(() => void fetchStatusInfo(), 30_000)
    return () => window.clearInterval(interval)
  }, [fetchIdentity, fetchStatusInfo, loadSharedReferences])

  return (
    <>
      <ClaudeAuthFlow />
      <Suspense fallback={<FullPageSpinner />}>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/" element={<ChatView />} />
            <Route path="/now" element={<NowView />} />
            <Route path="/inbox" element={<InboxView />} />
            <Route path="/projects" element={<ProjectsView />} />
            <Route path="/terminal" element={<TerminalView />} />
            <Route path="/teams" element={<TeamsView />} />
            <Route path="/orgchart" element={<OrgChartView />} />
            <Route path="/calendar" element={<CalendarView />} />
            <Route path="/mail" element={<MailView />} />
            <Route path="/bookmarks" element={<BookmarksView />} />
            <Route path="/context" element={<ContextView />} />
            <Route path="/points" element={<PointsView />} />
            <Route path="/docs" element={<DocsView />} />
            <Route path="/sheets" element={<SheetsView />} />
            <Route path="/hub" element={<HubView />} />
            <Route path="/browser" element={<BrowserView />} />
            <Route path="/tgim" element={<TgimView />} />
            <Route path="/status" element={<StatusView />} />
            <Route path="/settings" element={<SettingsView />} />
          </Route>
        </Routes>
      </Suspense>
    </>
  )
}

export default function App() {
  const loadFromStorage = useSettingsStore(s => s.loadFromStorage)

  useEffect(() => {
    loadFromStorage()
  }, [loadFromStorage])

  return (
    <HashRouter>
      <ErrorCenter />
      <AuthGuard>
        <AuthenticatedApp />
      </AuthGuard>
    </HashRouter>
  )
}
