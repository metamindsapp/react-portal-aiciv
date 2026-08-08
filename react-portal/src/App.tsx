import { useEffect } from 'react'
import { HashRouter, Routes, Route } from 'react-router-dom'
import { AuthGuard } from './components/auth/AuthGuard'
import { ClaudeAuthFlow } from './components/auth/ClaudeAuthFlow'
import { AppShell } from './components/layout/AppShell'
import { ChatView } from './components/chat/ChatView'
import { NowView } from './components/now/NowView'
import { CalendarView } from './components/calendar/CalendarView'
import { MailView } from './components/agentmail/MailView'
import { SettingsView } from './components/settings/SettingsView'
import { TerminalView } from './components/terminal/TerminalView'
import { TeamsView } from './components/teams/TeamsView'
import { BookmarksView } from './components/bookmarks/BookmarksView'
import { StatusView } from './components/status/StatusView'
import { ContextView } from './components/context/ContextView'
import OrgChartView from './components/agents/OrgChartView'
import { DocsView } from './components/docs/DocsView'
import { SheetsView } from './components/sheets/SheetsView'
import { HubView } from './components/hub/HubView'
import { PointsView } from './components/points/PointsView'
import { BrowserView } from './components/browser/BrowserView'
import { TgimView } from './components/tgim/TgimView'
import { useIdentityStore } from './stores/identityStore'
import { useSettingsStore } from './stores/settingsStore'

/** Runs identity + status fetches only after auth succeeds */
function AuthenticatedApp() {
  const fetchIdentity = useIdentityStore(s => s.fetchIdentity)
  const fetchStatusInfo = useIdentityStore(s => s.fetchStatusInfo)

  useEffect(() => {
    fetchIdentity()
    fetchStatusInfo()
    const interval = setInterval(fetchStatusInfo, 30_000)
    return () => clearInterval(interval)
  }, [fetchIdentity, fetchStatusInfo])

  return (
    <>
      <ClaudeAuthFlow />
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<ChatView />} />
          <Route path="/now" element={<NowView />} />
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
      <AuthGuard>
        <AuthenticatedApp />
      </AuthGuard>
    </HashRouter>
  )
}
